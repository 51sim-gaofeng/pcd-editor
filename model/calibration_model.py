"""Offline camera intrinsic calibration and local camera image capture."""
from __future__ import annotations

import json
import os
import queue
import re
import threading
import time
from pathlib import Path

import cv2
import numpy as np

_IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff'}
_capture_dir = ''
_capture_index = 0
_capture_host = '127.0.0.1'
_capture_port = 13956
_capture_lock = threading.Lock()
_auto_capture_stop = threading.Event()
_auto_capture_thread: threading.Thread | None = None
_auto_capture_error = ''
_auto_capture_saved = 0
_AUTO_CAPTURE_QUEUE_SIZE = 32
_auto_capture_queue: queue.Queue = queue.Queue(maxsize=_AUTO_CAPTURE_QUEUE_SIZE)

_PREVIEW_IMAGE_RE = re.compile(
    r'^calibration_preview_d(?P<distance_mm>\d+(?:\.\d+)?)mm'
    r'\.(?:jpe?g|png|bmp|tiff?)$', re.IGNORECASE)


def list_images(folder: str) -> list[str]:
    folder = os.path.realpath(folder or '')
    if not os.path.isdir(folder):
        raise ValueError('Image folder does not exist')
    return [str(p) for p in sorted(Path(folder).iterdir())
            if p.is_file() and p.suffix.lower() in _IMAGE_EXTS
            # Never feed previews produced by an earlier calibration back into
            # the next solve. They duplicate a view and one is already warped.
            and not p.name.lower().startswith('camera_calibration_')]


def _preview_image_info(valid_files: list[str]) -> tuple[int, float | None]:
    """Return the named preview image index and its encoded distance."""
    for index, filename in enumerate(valid_files):
        match = _PREVIEW_IMAGE_RE.fullmatch(os.path.basename(filename))
        if match:
            return index, float(match.group('distance_mm'))
    return 0, None


def _find_corners(image, pattern):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    # The classic detector can return false positives on checkerboards heavily
    # warped near a fisheye image boundary. Prefer the sector-based detector;
    # EXHAUSTIVE is slower but calibration is offline and reliability matters.
    if hasattr(cv2, 'findChessboardCornersSB'):
        ok, corners = cv2.findChessboardCornersSB(
            gray, pattern,
            cv2.CALIB_CB_NORMALIZE_IMAGE | cv2.CALIB_CB_EXHAUSTIVE)
    else:
        flags = cv2.CALIB_CB_ADAPTIVE_THRESH | cv2.CALIB_CB_NORMALIZE_IMAGE
        ok, corners = cv2.findChessboardCorners(gray, pattern, flags)
    # SB already returns sub-pixel coordinates. cornerSubPix remains useful
    # only for the legacy fallback detector.
    if ok and not hasattr(cv2, 'findChessboardCornersSB'):
        corners = cv2.cornerSubPix(
            gray, np.asarray(corners, np.float32), (5, 5), (-1, -1),
            (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, .001))
    return ok, corners


def _fisheye_fit(obj_points, img_points, image_size, initial_k, flags,
                 initial_d=None):
    fish_obj = [np.asarray(x, np.float64).reshape(1, -1, 3) for x in obj_points]
    fish_img = [np.asarray(x, np.float64).reshape(1, -1, 2) for x in img_points]
    return cv2.fisheye.calibrate(
        fish_obj, fish_img, image_size, initial_k.copy(),
        (np.zeros((4, 1), dtype=np.float64) if initial_d is None
         else np.asarray(initial_d, np.float64).copy()), None, None, flags,
        (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_COUNT, 100, 1e-7))


def _fisheye_view_errors(obj_points, img_points, k, d, rvecs, tvecs):
    errors = []
    for obj, observed, rvec, tvec in zip(
            obj_points, img_points, rvecs, tvecs):
        projected, _ = cv2.fisheye.projectPoints(
            np.asarray(obj, np.float64).reshape(1, -1, 3),
            rvec, tvec, k, d)
        delta = (np.asarray(projected).reshape(-1, 2)
                 - np.asarray(observed).reshape(-1, 2))
        errors.append(float(np.sqrt(np.mean(np.sum(delta * delta, axis=1)))))
    return errors


def _analyze_fisheye_views(img_points, image_size):
    """Count edge-covering and near-duplicate fisheye views."""
    center = np.asarray(image_size, np.float64) / 2.0
    max_radius = min(image_size) * 0.50
    signatures = []
    diagonal = float(np.hypot(*image_size))
    edge_views = 0
    duplicate_views = 0
    for image_points in img_points:
        points = np.asarray(image_points, np.float64).reshape(-1, 2)
        radius = float(np.linalg.norm(points - center, axis=1).max())
        if radius > max_radius:
            edge_views += 1
        signature = points / diagonal
        if any(float(np.sqrt(np.mean(np.sum((signature - old) ** 2, axis=1)))) < .005
               for old in signatures):
            duplicate_views += 1
        signatures.append(signature)
    return edge_views, duplicate_views


def _fisheye_initial_fit(obj_points, img_points, image_size, base_flags,
                         use_guess):
    """Try native and equidistant seeds, returning the lower-RMS solution."""
    candidates = []
    try:
        native = _fisheye_fit(
            obj_points, img_points, image_size,
            np.zeros((3, 3), dtype=np.float64), base_flags)
        if np.isfinite(float(native[0])):
            candidates.append(native)
    except cv2.error:
        pass

    width, height = image_size
    # For a circular ~180 degree fisheye image the horizontal diameter is the
    # useful field of view, so width/pi is the stable equidistant seed.
    focal = width / np.pi
    equidistant_k = np.array(
        [[focal, 0.0, width / 2.0],
         [0.0, focal, height / 2.0],
         [0.0, 0.0, 1.0]], dtype=np.float64)
    try:
        equidistant = _fisheye_fit(
            obj_points, img_points, image_size, equidistant_k,
            base_flags | use_guess)
        if np.isfinite(float(equidistant[0])):
            candidates.append(equidistant)
    except cv2.error:
        pass

    if not candidates:
        raise cv2.error('No fisheye initialization candidate converged')
    return min(candidates, key=lambda fit: float(fit[0]))


def _record_rejection(rejected: list, filename: str, reason: str) -> None:
    """Record an invalid calibration input without modifying the source file."""
    rejected.append({'file': os.path.basename(filename), 'reason': reason})


def calibrate(folder: str, rows: int, cols: int, square_mm: float,
              model: str = 'normal5', min_images: int = 5,
              output_dir: str | None = None) -> dict:
    rows, cols = int(rows), int(cols)
    square_mm = float(square_mm)
    if rows < 3 or cols < 3 or square_mm <= 0:
        raise ValueError('Checkerboard rows and columns must be at least 3, and square size must be greater than 0')
    files = list_images(folder)
    if not files:
        raise ValueError('No readable images were found in the folder')
    # UI values describe the visible checker squares (e.g. a 20 x 15 board).
    # OpenCV expects internal corner counts, which are one fewer per axis.
    corner_rows, corner_cols = rows - 1, cols - 1
    pattern = (corner_cols, corner_rows)
    obj = np.zeros((corner_rows * corner_cols, 1, 3), np.float32)
    obj[:, 0, :2] = np.mgrid[0:corner_cols, 0:corner_rows].T.reshape(-1, 2) * square_mm
    obj_points, img_points, valid_files, rejected = [], [], [], []
    image_size = None
    for filename in files:
        image = cv2.imread(filename, cv2.IMREAD_COLOR)
        if image is None:
            _record_rejection(rejected, filename, 'Unreadable image')
            continue
        size = image.shape[1], image.shape[0]
        if image_size is not None and size != image_size:
            _record_rejection(rejected, filename, 'Image size mismatch')
            continue
        ok, corners = _find_corners(image, pattern)
        if not ok:
            _record_rejection(rejected, filename, 'Complete checkerboard not detected')
            continue
        image_size = size
        obj_points.append(obj.copy())
        img_points.append(corners.reshape(-1, 1, 2).astype(np.float32))
        valid_files.append(filename)
    if len(valid_files) < int(min_images):
        raise ValueError(
            f'{len(files)} images were read, but only {len(valid_files)} contained a complete checkerboard; '
            f'the current {cols}×{rows} square layout expects {corner_cols}×{corner_rows} internal corners; '
            f'at least {int(min_images)} valid images are required')

    fisheye = model == 'fisheye'
    diagnostics = {'warnings': []}
    if fisheye:
        edge_views, duplicate_views = _analyze_fisheye_views(img_points, image_size)
        diagnostics['edge_view_count'] = edge_views
        diagnostics['near_duplicate_view_count'] = duplicate_views
        fish_ns = cv2.fisheye
        use_guess = getattr(fish_ns, 'CALIB_USE_INTRINSIC_GUESS',
                            getattr(cv2, 'CALIB_USE_INTRINSIC_GUESS', 1))
        recompute = getattr(fish_ns, 'CALIB_RECOMPUTE_EXTRINSIC',
                            getattr(cv2, 'CALIB_RECOMPUTE_EXTRINSIC', 2))
        fix_skew = getattr(fish_ns, 'CALIB_FIX_SKEW',
                           getattr(cv2, 'CALIB_FIX_SKEW', 8))
        initial_flags = recompute | fix_skew
        refine_flags = initial_flags | use_guess
        # OpenCV 5 expects an empty/zero intrinsic matrix when no intrinsic
        # guess flag is present; an identity matrix can trigger InitExtrinsics.
        try:
            # Match CameraCalibration's stable two-stage strategy: first let
            # the fisheye model initialize itself, then refine using that result.
            initial_fit = _fisheye_initial_fit(
                obj_points, img_points, image_size, initial_flags, use_guess)
            _initial_rms, initial_k, initial_d, _ir, _it = initial_fit
            rms, k, d, rvecs, tvecs = _fisheye_fit(
                obj_points, img_points, image_size, initial_k, refine_flags, initial_d)
            diagnostics['initial_fisheye_rms'] = float(_initial_rms)
        except cv2.error as original_error:
            # OpenCV 5's fisheye InitExtrinsics aborts the entire solve when a
            # single detected view is geometrically degenerate. Locate that
            # view with leave-one-out fits and retain the best valid solution.
            candidates = []
            if len(valid_files) - 1 >= int(min_images):
                for bad_index in range(len(valid_files)):
                    keep = [i for i in range(len(valid_files)) if i != bad_index]
                    try:
                        fit = _fisheye_initial_fit(
                            [obj_points[i] for i in keep],
                            [img_points[i] for i in keep], image_size,
                            initial_flags, use_guess)
                        if np.isfinite(float(fit[0])):
                            candidates.append((float(fit[0]), bad_index, keep, fit))
                    except cv2.error:
                        continue
            if not candidates:
                message = str(original_error).splitlines()[-1]
                raise ValueError(
                    'Fisheye calibration initialization failed because of degenerate views, and they cannot be '
                    'removed while retaining the minimum image count. Verify the checkerboard dimensions and '
                    'remove blurred, duplicate, nearly frontal, or very small checkerboard images.'
                    f' OpenCV: {message}') from original_error
            _score, bad_index, keep, fit = min(candidates, key=lambda item: item[0])
            bad_file = valid_files[bad_index]
            rejected.append({'file': os.path.basename(bad_file),
                             'reason': 'Degenerate fisheye extrinsic initialization'})
            diagnostics['warnings'].append(
                f'Removed degenerate image automatically: {os.path.basename(bad_file)}')
            obj_points = [obj_points[i] for i in keep]
            img_points = [img_points[i] for i in keep]
            valid_files = [valid_files[i] for i in keep]
            first_rms, first_k, first_d, _first_r, _first_t = fit
            rms, k, d, rvecs, tvecs = _fisheye_fit(
                obj_points, img_points, image_size, first_k, refine_flags, first_d)
            diagnostics['initial_fisheye_rms'] = float(first_rms)

        # A fisheye solve can technically succeed while assigning a completely
        # wrong pose to one view. Reject only unmistakable per-view outliers and
        # solve again; otherwise one 200+ px view can poison an excellent fit.
        initial_view_errors = _fisheye_view_errors(
            obj_points, img_points, k, d, rvecs, tvecs)
        median_error = float(np.median(initial_view_errors))
        outlier_limit = max(2.0, median_error * 5.0)
        keep = [i for i, error in enumerate(initial_view_errors)
                if error <= outlier_limit]
        if len(keep) < len(valid_files) and len(keep) >= int(min_images):
            bad_indices = [i for i in range(len(valid_files)) if i not in keep]
            bad_names = [os.path.basename(valid_files[i]) for i in bad_indices]
            for i in bad_indices:
                rejected.append({
                    'file': os.path.basename(valid_files[i]),
                    'reason': (f'Abnormal fisheye single-image reprojection error: '
                               f'{initial_view_errors[i]:.3f}px'),
                    })
            obj_points = [obj_points[i] for i in keep]
            img_points = [img_points[i] for i in keep]
            valid_files = [valid_files[i] for i in keep]
            rms, k, d, rvecs, tvecs = _fisheye_fit(
                obj_points, img_points, image_size, k, refine_flags, d)
            diagnostics['warnings'].append(
                'Removed images with abnormal reprojection errors automatically: ' + ', '.join(bad_names))
            diagnostics['reprojection_outlier_threshold_px'] = outlier_limit
        # Rebuild arrays after possible rejection for the diagnostic solve.
        fish_obj = [np.asarray(x, np.float64).reshape(1, -1, 3) for x in obj_points]
        fish_img = [np.asarray(x, np.float64).reshape(1, -1, 2) for x in img_points]
        # Compare against a reduced K1-only solve only as an observability
        # diagnostic. The delivered result above still estimates all K1..K4.
        fix_k2 = getattr(fish_ns, 'CALIB_FIX_K2', getattr(cv2, 'CALIB_FIX_K2', 0))
        fix_k3 = getattr(fish_ns, 'CALIB_FIX_K3', getattr(cv2, 'CALIB_FIX_K3', 0))
        fix_k4 = getattr(fish_ns, 'CALIB_FIX_K4', getattr(cv2, 'CALIB_FIX_K4', 0))
        try:
            reduced_rms, *_ = cv2.fisheye.calibrate(
                fish_obj, fish_img, image_size, np.zeros((3, 3)), np.zeros((4, 1)), None, None,
                initial_flags | fix_k2 | fix_k3 | fix_k4,
                (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_COUNT, 100, 1e-7))
            improvement = (float(reduced_rms) - float(rms)) / max(float(reduced_rms), 1e-12)
            diagnostics['reduced_k1_rms'] = float(reduced_rms)
            diagnostics['full_model_improvement_ratio'] = improvement
            if improvement < .01:
                diagnostics['warnings'].append(
                    'K2-K4 improve reprojection error by less than 1%; the current images weakly constrain '
                    'higher-order fisheye parameters. Add views near the image edges and corners.')
        except cv2.error:
            pass
    else:
        flags = cv2.CALIB_RATIONAL_MODEL if model == 'normal8' else 0
        rms, k, d, rvecs, tvecs = cv2.calibrateCamera(
            obj_points, img_points, image_size, None, None, flags=flags,
            criteria=(cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_COUNT, 100, 1e-7))
        d = d.reshape(-1)[:8 if model == 'normal8' else 5].reshape(-1, 1)

    errors = []
    max_errors = []
    total_squared_error = 0.0
    total_points = 0
    for i, points in enumerate(img_points):
        if fisheye:
            projected, _ = cv2.fisheye.projectPoints(
                np.asarray(obj_points[i], np.float64).reshape(1, -1, 3),
                rvecs[i], tvecs[i], k, d)
        else:
            projected, _ = cv2.projectPoints(obj_points[i], rvecs[i], tvecs[i], k, d)
        p0 = np.asarray(points, np.float64).reshape(-1, 1, 2)
        p1 = np.asarray(projected, np.float64).reshape(-1, 1, 2)
        distances = np.linalg.norm((p0 - p1).reshape(-1, 2), axis=1)
        squared = float(np.sum(distances ** 2))
        errors.append(float(np.sqrt(squared / len(distances))))
        max_errors.append(float(np.max(distances)))
        total_squared_error += squared
        total_points += len(distances)

    point_rms = float(np.sqrt(total_squared_error / max(total_points, 1)))
    diagnostics['point_rms_px'] = point_rms
    diagnostics['max_point_error_px'] = float(max(max_errors, default=0.0))
    diagnostics['worst_image'] = (os.path.basename(valid_files[int(np.argmax(errors))])
                                  if errors else None)
    preview_index, preview_distance_mm = _preview_image_info(valid_files)
    preview_file = valid_files[preview_index]
    if fisheye:
        estimated_preview_projected, _ = cv2.fisheye.projectPoints(
            np.asarray(obj_points[preview_index], np.float64).reshape(1, -1, 3),
            rvecs[preview_index], tvecs[preview_index], k, d)
    else:
        estimated_preview_projected, _ = cv2.projectPoints(
            obj_points[preview_index], rvecs[preview_index],
            tvecs[preview_index], k, d)
    display_projected_points = estimated_preview_projected
    estimated_preview_delta = (
        np.asarray(estimated_preview_projected, np.float64).reshape(-1, 2)
        - np.asarray(img_points[preview_index], np.float64).reshape(-1, 2))
    estimated_preview_distances = np.linalg.norm(
        estimated_preview_delta, axis=1)
    preview_r, _ = cv2.Rodrigues(rvecs[preview_index])
    board_center = np.array(
        [[(corner_cols - 1) * square_mm / 2.0],
         [(corner_rows - 1) * square_mm / 2.0],
         [0.0]], dtype=np.float64)
    center_camera = preview_r @ board_center + np.asarray(
        tvecs[preview_index], np.float64).reshape(3, 1)
    estimated_distance_mm = float(np.linalg.norm(center_camera))
    board_normal = preview_r[:, 2]
    perpendicular_error_deg = float(np.degrees(np.arccos(np.clip(
        abs(float(board_normal[2])) / max(float(np.linalg.norm(board_normal)), 1e-12),
        -1.0, 1.0))))
    preview_measurement = {
        'file': os.path.basename(preview_file),
        'reprojection_rms_px': errors[preview_index],
        'estimated_pose_reprojection_rms_px': errors[preview_index],
        'estimated_board_center_camera_mm': center_camera.reshape(-1).tolist(),
        'estimated_distance_mm': estimated_distance_mm,
        'perpendicular_error_deg': perpendicular_error_deg,
    }
    if preview_distance_mm is not None:
        distance_error_mm = estimated_distance_mm - preview_distance_mm
        preview_measurement.update({
            'reference_distance_mm': preview_distance_mm,
            'distance_error_mm': distance_error_mm,
            'distance_absolute_error_mm': abs(distance_error_mm),
            'distance_relative_error_percent': (
                abs(distance_error_mm) / preview_distance_mm * 100.0
                if preview_distance_mm > 0 else None),
        })
        # The named validation view is defined as centered and perpendicular:
        # its board center lies on the optical axis at the encoded distance,
        # and its board axes are parallel to the camera x/y axes. Since our
        # object origin is the first internal corner rather than board center,
        # translate that origin by the negative internal-corner center.
        reference_rvec = np.zeros((3, 1), dtype=np.float64)
        reference_tvec = np.array(
            [[-board_center[0, 0]], [-board_center[1, 0]],
             [preview_distance_mm]], dtype=np.float64)
        if fisheye:
            reference_projected, _ = cv2.fisheye.projectPoints(
                np.asarray(obj_points[preview_index], np.float64).reshape(1, -1, 3),
                reference_rvec, reference_tvec, k, d)
        else:
            reference_projected, _ = cv2.projectPoints(
                obj_points[preview_index], reference_rvec, reference_tvec, k, d)
        reference_delta = (
            np.asarray(reference_projected, np.float64).reshape(-1, 2)
            - np.asarray(img_points[preview_index], np.float64).reshape(-1, 2))
        reference_distances = np.linalg.norm(reference_delta, axis=1)
        display_projected_points = reference_projected
        preview_measurement.update({
            'reference_pose_assumption': (
                'board center on optical axis; board plane perpendicular to optical axis'),
            'reference_pose_rvec': reference_rvec.reshape(-1).tolist(),
            'reference_pose_tvec_mm': reference_tvec.reshape(-1).tolist(),
            'reference_pose_reprojection_rms_px': float(np.sqrt(np.mean(
                reference_distances ** 2))),
            'reference_pose_reprojection_mean_px': float(np.mean(
                reference_distances)),
            'reference_pose_reprojection_max_px': float(np.max(
                reference_distances)),
            'reference_pose_mean_signed_offset_px': reference_delta.mean(
                axis=0).tolist(),
        })
        display_reprojection = {
            'value_px': preview_measurement['reference_pose_reprojection_rms_px'],
            'mean_pixel_error_px': preview_measurement['reference_pose_reprojection_mean_px'],
            'reference_distance_mm': preview_distance_mm,
            'estimated_distance_mm': estimated_distance_mm,
            'distance_error_mm': distance_error_mm,
            'distance_absolute_error_mm': abs(distance_error_mm),
            'distance_relative_error_percent': preview_measurement[
                'distance_relative_error_percent'],
            'source': 'reference_pose',
            'label': 'Single-Image Reprojection RMS (Reference Pose)',
            'file': os.path.basename(preview_file),
            'note': ('Uses the distance encoded in the filename and assumes the board is centered and '
                     'perpendicular to the optical axis'),
        }
    else:
        display_reprojection = {
            'value_px': errors[preview_index],
            'mean_pixel_error_px': float(np.mean(estimated_preview_distances)),
            'estimated_distance_mm': estimated_distance_mm,
            'source': 'estimated_pose',
            'label': 'Single-Image Reprojection RMS (Estimated Extrinsics)',
            'file': os.path.basename(preview_file),
            'note': (
                'No valid calibration_preview_d<distance>mm image was found; uses the first valid image '
                'and its estimated extrinsics'),
        }
    diagnostics['preview_measurement'] = preview_measurement
    focal_ratio_error = abs(float(k[0, 0]) / max(float(k[1, 1]), 1e-12) - 1.0)
    diagnostics['fx_fy_difference_ratio'] = focal_ratio_error
    if focal_ratio_error > .05:
        diagnostics['warnings'].append('Fx and Fy differ by more than 5%; view coverage may be insufficient or the solution may be a local minimum.')
    if fisheye and np.max(np.abs(np.asarray(d).reshape(-1)[1:])) > .5:
        diagnostics['warnings'].append('A higher-order fisheye distortion coefficient exceeds 0.5 in magnitude; parameters may be diverging.')
    if point_rms > 2.0:
        raise ValueError(
            f'Calibration failed quality checks: point RMS is {point_rms:.3f}px, exceeding 2px; '
            f'the worst image is {diagnostics["worst_image"]}. Verify checkerboard dimensions and camera '
            'model, and remove blurred images or images with incorrect corner detections.')

    out = os.path.realpath(output_dir or folder)
    os.makedirs(out, exist_ok=True)
    stamp = time.strftime('%Y%m%d_%H%M%S')
    stem = f'camera_calibration_{model}_{stamp}'
    np.save(os.path.join(out, stem + '_K.npy'), k)
    np.save(os.path.join(out, stem + '_D.npy'), d)
    coeff_values = d.reshape(-1).tolist()
    coeff_names = (['k1', 'k2', 'k3', 'k4'] if fisheye else
                   ['k1', 'k2', 'p1', 'p2', 'k3', 'k4', 'k5', 'k6'][:len(coeff_values)])
    result = {
        'model': model, 'image_size': list(image_size), 'camera_matrix': k.tolist(),
        'focal_length': {'fx': float(k[0, 0]), 'fy': float(k[1, 1])},
        'principal_point': {'cx': float(k[0, 2]), 'cy': float(k[1, 2])},
        'principal_point_offset': {'cx': float(k[0, 2] - image_size[0] / 2),
                                   'cy': float(k[1, 2] - image_size[1] / 2)},
        'diagnostics': diagnostics,
        'distortion_coefficients': coeff_values,
        'distortion_parameters': dict(zip(coeff_names, coeff_values)),
        'rms': float(rms),
        'display_reprojection': display_reprojection,
        'mean_reprojection_error': point_rms, 'per_image_error': errors,
        'per_image_max_error': max_errors,
        'valid_images': [os.path.basename(x) for x in valid_files], 'rejected_images': rejected,
        'board': {'square_rows': rows, 'square_cols': cols,
                  'corner_rows': corner_rows, 'corner_cols': corner_cols,
                  'square_mm': square_mm},
    }
    json_path = os.path.join(out, stem + '.json')
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    if valid_files:
        preview = cv2.imread(preview_file)
        cv2.drawChessboardCorners(
            preview, pattern, img_points[preview_index], True)
        cv2.imwrite(os.path.join(out, stem + '_corners.jpg'), preview)
        src = cv2.imread(preview_file)
        reprojection = src.copy()
        circle_radius = max(3, int(round(min(image_size) * 0.004)))
        circle_thickness = 2
        cross_radius = max(3, int(round(circle_radius * 0.75)))
        detected_points = np.asarray(
            img_points[preview_index], np.float64).reshape(-1, 2)
        for point in detected_points:
            if np.all(np.isfinite(point)):
                x, y = int(round(point[0])), int(round(point[1]))
                cross_segments = (
                    ((x - cross_radius, y - cross_radius),
                     (x + cross_radius, y + cross_radius)),
                    ((x - cross_radius, y + cross_radius),
                     (x + cross_radius, y - cross_radius)),
                )
                # A dark outline keeps the detected-corner cross visible over
                # both white and black checkerboard squares.
                for start, end in cross_segments:
                    cv2.line(
                        reprojection, start, end, (0, 0, 0),
                        2, lineType=cv2.LINE_AA)
                for start, end in cross_segments:
                    cv2.line(
                        reprojection, start, end, (0, 255, 255),
                        1, lineType=cv2.LINE_AA)
        circle_overlay = reprojection.copy()
        for point in np.asarray(display_projected_points).reshape(-1, 2):
            if np.all(np.isfinite(point)):
                cv2.circle(
                    circle_overlay,
                    (int(round(point[0])), int(round(point[1]))),
                    circle_radius, (0, 0, 190), circle_thickness,
                    lineType=cv2.LINE_AA)
        # OpenCV accepts integer line widths only. Blend a 2 px circle with
        # the source to produce the visual weight of roughly 1.5 px.
        reprojection = cv2.addWeighted(
            circle_overlay, 0.75, reprojection, 0.25, 0.0)
        cv2.imwrite(os.path.join(out, stem + '_reprojected.jpg'), reprojection)
        if fisheye:
            new_k = cv2.fisheye.estimateNewCameraMatrixForUndistortRectify(k, d, image_size, np.eye(3), balance=.2)
            undist = cv2.fisheye.undistortImage(src, k, d, Knew=new_k, new_size=image_size)
        else:
            new_k, _ = cv2.getOptimalNewCameraMatrix(k, d, image_size, .2, image_size)
            undist = cv2.undistort(src, k, d, None, new_k)
        cv2.imwrite(os.path.join(out, stem + '_undistorted.jpg'), undist)
    result['output_dir'] = out
    result['json_file'] = json_path
    result['preview_url'] = '/api/calibration_preview?file=' + stem + '_corners.jpg&dir=' + out
    result['reprojection_file'] = os.path.join(out, stem + '_reprojected.jpg')
    result['reprojection_url'] = '/api/calibration_preview?file=' + stem + '_reprojected.jpg&dir=' + out
    result['undistorted_url'] = '/api/calibration_preview?file=' + stem + '_undistorted.jpg&dir=' + out
    return result


def start_capture(folder: str = '', host: str = '127.0.0.1', port: int = 13956) -> dict:
    """Start/restart the existing GVSP/JPEG UDP receiver."""
    global _capture_dir, _capture_index, _capture_host, _capture_port
    from model.camera_model import rebind
    stop_auto_capture()
    if folder:
        _capture_dir = os.path.realpath(folder)
    _capture_host, _capture_port = str(host), int(port)
    _capture_index = len(list_images(_capture_dir)) if os.path.isdir(_capture_dir) else 0
    rebind(_capture_host, _capture_port)
    return capture_status()


def stop_capture() -> dict:
    from model.camera_model import stop_udp_listener
    stop_auto_capture()
    stop_udp_listener()
    return capture_status()


def capture_status() -> dict:
    from model.camera_model import get_status
    status = get_status()
    auto_running = _auto_capture_thread is not None and _auto_capture_thread.is_alive()
    return {'running': status.get('running', False), 'folder': _capture_dir,
            'host': status.get('host', _capture_host), 'port': status.get('port', _capture_port),
            'count': _capture_index, 'has_frame': status.get('frame_id', -1) >= 0,
            'recv_count': status.get('recv_count', 0), 'age_ms': status.get('age_ms', -1),
            'auto_capture': auto_running, 'auto_saved': _auto_capture_saved,
            'auto_error': _auto_capture_error}


def capture_jpeg() -> bytes | None:
    from model.camera_model import get_latest_frame_blocking
    _fid, _source_fid, jpeg = get_latest_frame_blocking(-2, timeout=0)
    return jpeg


def save_capture(folder: str = '') -> dict:
    global _capture_index, _capture_dir
    if folder:
        _capture_dir = os.path.realpath(folder)
    jpeg = capture_jpeg()
    if not _capture_dir:
        raise ValueError('Select a capture folder first')
    if not os.path.isdir(_capture_dir):
        raise ValueError('Capture folder does not exist')
    if not jpeg:
        raise ValueError('No UDP camera image has been received')
    filename = _write_capture(jpeg)
    return {'ok': True, 'file': filename, 'count': _capture_index}


def _write_capture(jpeg: bytes) -> str:
    """Write one JPEG with a unique sequence number across manual and auto capture."""
    global _capture_index
    with _capture_lock:
        while True:
            filename = os.path.join(_capture_dir, f'calibration_{_capture_index:04d}.jpg')
            _capture_index += 1
            if not os.path.exists(filename):
                break
        with open(filename, 'wb') as f:
            f.write(jpeg)
    return filename


def _auto_capture_loop() -> None:
    global _auto_capture_error, _auto_capture_saved
    while not _auto_capture_stop.is_set():
        try:
            jpeg = _auto_capture_queue.get(timeout=0.5)
        except queue.Empty:
            continue
        if jpeg is None or _auto_capture_stop.is_set():
            continue
        try:
            _write_capture(jpeg)
            _auto_capture_saved += 1
        except Exception as exc:
            _auto_capture_error = str(exc)
            break


def _enqueue_auto_capture(_frame_id: int, _source_id: int, jpeg: bytes) -> None:
    if not _auto_capture_stop.is_set():
        try:
            _auto_capture_queue.put_nowait(jpeg)
        except queue.Full:
            # Keep the receiver responsive when disk writes fall behind.
            try:
                _auto_capture_queue.get_nowait()
            except queue.Empty:
                pass
            try:
                _auto_capture_queue.put_nowait(jpeg)
            except queue.Full:
                pass


def start_auto_capture(folder: str = '') -> dict:
    """Save every newly completed camera frame until explicitly stopped."""
    global _capture_dir, _capture_index, _auto_capture_thread
    global _auto_capture_error, _auto_capture_saved, _auto_capture_queue
    if folder:
        _capture_dir = os.path.realpath(folder)
    if not _capture_dir or not os.path.isdir(_capture_dir):
        raise ValueError('Capture folder does not exist')
    status = capture_status()
    if not status['running']:
        raise ValueError('Start the UDP camera receiver first')
    if status['auto_capture']:
        return status
    _capture_index = len(list_images(_capture_dir))
    _auto_capture_error = ''
    _auto_capture_saved = 0
    _auto_capture_queue = queue.Queue(maxsize=_AUTO_CAPTURE_QUEUE_SIZE)
    _auto_capture_stop.clear()
    from model.camera_model import add_frame_listener
    add_frame_listener(_enqueue_auto_capture)
    _auto_capture_thread = threading.Thread(
        target=_auto_capture_loop, name='calib-auto-capture', daemon=True)
    _auto_capture_thread.start()
    return capture_status()


def stop_auto_capture() -> dict:
    global _auto_capture_thread
    from model.camera_model import remove_frame_listener
    remove_frame_listener(_enqueue_auto_capture)
    thread = _auto_capture_thread
    _auto_capture_stop.set()
    try:
        _auto_capture_queue.put_nowait(None)
    except queue.Full:
        try:
            _auto_capture_queue.get_nowait()
            _auto_capture_queue.put_nowait(None)
        except (queue.Empty, queue.Full):
            pass
    if thread is not None and thread is not threading.current_thread():
        thread.join(timeout=1.0)
    _auto_capture_thread = None
    return capture_status()
