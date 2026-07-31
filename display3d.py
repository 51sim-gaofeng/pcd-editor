import cv2
import math
import os
import numpy as np
import lidartoolkit as ltk

SegmentationColorTable = np.array([
    [0, 0, 0], [107, 142, 35], [70, 70, 70], [128, 64, 128], [220, 20, 60],
    [153, 153, 153], [0, 0, 142], [0, 0, 0], [119, 11, 32], [190, 153, 153],
    [70, 130, 180], [244, 35, 232], [240, 240, 240], [220, 220, 0], [102, 102, 156],
    [250, 170, 30], [152, 251, 152], [255, 0, 0], [0, 0, 70], [0, 60, 100],
    [0, 80, 100], [0, 0, 230], [111, 74, 0], [180, 165, 180], [81, 0, 81],
    [150, 100, 100], [220, 220, 0], [169, 11, 32], [250, 170, 160], [230, 150, 140],
    [150, 120, 90], [151, 124, 0], [70, 120, 120], [70, 12, 120], [70, 120, 12],
    [0, 120, 120], [200, 120, 120], [70, 200, 120], [70, 120, 200], [100, 0, 0],
    [250, 120, 120], [70, 0, 250], [140, 100, 100], [160, 160, 160], [170, 10, 10],
    [130, 100, 10], [170, 100, 10], [170, 10, 100], [170, 170, 170], [100, 20, 10]
])

def read_pcd_file(file_path):
    with open(file_path, 'rb') as f:
        lines = f.readlines()

        # 找到点数据的开始
        
        data_start_line = None
        for i, line in enumerate(lines):
            if line.startswith(b'DATA binary'):
                data_start_line = i + 1
                break
        else:
            raise ValueError('无效的PCD文件：未找到二进制点数据。')

        # 读取二进制数据
        data = b''.join(lines[data_start_line:])
        
        # 定义数据类型
        dtype = np.dtype([
            ('x', np.float32),
            ('y', np.float32),
            ('z', np.float32),
            ('rgb', np.uint32),
            ('intensity', np.uint8),
            ('segmentation', np.uint8),
            ('ring', np.uint8),
            ('angle', np.uint8)
        ])
        
        # 将二进制数据转换为结构化数组
        point_cloud = np.frombuffer(data, dtype=dtype)
        
        return point_cloud

def intensity_to_rgb(intensity):
    intensity = intensity
    if intensity <= 33:
        r = 0
        g = int(7.727 * intensity)
        b = 255
    elif 33 < intensity <= 66:
        r = 0
        g = 255
        b = int(255 - 7.727 * (intensity - 34))
    elif 66 < intensity <= 100:
        r = int(7.727 * (intensity - 67))
        g = 255
        b = 0
    elif 100 < intensity <= 255:
        r = 255
        g = int(255 - 7.727 * (intensity - 100) / 4.697)
        b = 0
    else:
        r, g, b = 255, 255, 255  # 默认值

    return r,g,b,255  # 返回 RGB 颜色以及 alpha 通道的值


def drawPcdtoImage(img, points, intensitys, segmentations, type=0):
    points = np.array(points, dtype=int)
    intensitys = np.array(intensitys, dtype=np.uint32)
    segmentations = np.array(segmentations, dtype=np.uint32)

    valid_mask = (points[:, 0] >= 0) & (points[:, 0] < img.shape[1]) & \
                 (points[:, 1] >= 0) & (points[:, 1] < img.shape[0])
    points = points[valid_mask]
    intensitys = intensitys[valid_mask]
    segmentations = segmentations[valid_mask]

    if type == 0:
        colors = np.array([intensity_to_rgb(intensity) for intensity in intensitys])
    elif type == 1:
        colors = SegmentationColorTable[segmentations]

    for (x, y), (red,green,blue, *_) in zip(points, colors):
        cv2.circle(img, (x, y), 1, (int(blue), int(green), int(red)), thickness=-1, lineType=cv2.LINE_AA)

def is_in_fov(points, camera_matrix):
    fx = camera_matrix[0, 0]
    cx = camera_matrix[0, 2]
    x, y, z = points[:, 0], points[:, 1], points[:, 2]
    condition1 = z > 0
    test = np.arctan(cx / fx)
    condition2 = np.arctan(-abs(x) / z) < np.arctan(cx / fx)
    return condition1 & condition2

if __name__ == "__main__":
    cv2.namedWindow("show", cv2.WINDOW_NORMAL)
    for index in range(1000, 100000, 100):
        strIndex = str(index)
        strIndex_lidar = str(index)
        current_path = os.getcwd()
        img1path = os.path.join(current_path, "output", "camera0", f"frame_{strIndex}.jpg")
        lidar_path = os.path.join(current_path, "output", "lidar", f"frame_{strIndex_lidar}.pcd")

        if not (os.path.isfile(img1path) and os.path.isfile(lidar_path)):
            print(f"跳过帧 {strIndex}: 文件不完整")
            continue

        img_rgb = cv2.imread(img1path)
        if img_rgb is None:
            print("无法读取图像。请检查路径是否正确。")
            continue

        # img_rgb = cv2.resize(img_rgb, (3840, 2160), interpolation=cv2.INTER_LINEAR)

        height, width, _ = img_rgb.shape

        #相机在车体的安装位置，x超前，y朝左，z朝上
        # pos_camera = [2.1096, -0.097, 1.5825]
        # rot_camera = [0.096,-0.77,-0.18]
        pos_camera = [1.0, 0, 1.8]
        rot_camera = [0.0,0.0,0.0]
        rot_camera = [math.radians(x) for x in rot_camera]
        t_camera = np.array([-pos_camera[1], -pos_camera[2], pos_camera[0],0,0], np.float32)
        
        R_z = np.array([0, 0, rot_camera[0]], np.float32)
        R_y = np.array([0, -rot_camera[2], 0], np.float32)
        R_x = np.array([-rot_camera[1], 0, 0], np.float32)
        
        R_rz = cv2.Rodrigues(R_z)[0]
        R_ry = cv2.Rodrigues(R_y)[0]
        R_rx = cv2.Rodrigues(R_x)[0]

        fx, fy = 1663.0, 1663.0
        cx, cy = 960.0, 540.0
        camera_matrix = np.array([
            [fx, 0, cx],
            [0, fy, cy],
            [0, 0, 1]
        ], dtype=np.float32)
        # distCoeffs = np.array([-0.028593, -0.008198, 0, 0, 0.000847, 0.000869, 0, 0], np.float32)
        distCoeffs = np.array([0, 0, 0, 0, 0.0, 0.0, 0.0, 0], np.float32)

        T0 = np.array([0, 0, 0], np.float32)
        R0 = np.array([0, 0, 0], np.float32)

        rot_lidar = [0.0,0.0,0.0]
        t_lidar = np.array([1.0, 0, 1.8], np.float32)
        
        # t_lidar = np.array([1.8989,0.0219,1.71], np.float32)
        
        try:
            point_cloud = np.copy(read_pcd_file(lidar_path))
        except Exception as e:
            print(f"跳过帧 {strIndex}: 点云读取失败: {e}")
            continue

        save_lidar_path = lidar_path.replace(".pcd", ".bin")
        point_cloud.tofile(save_lidar_path)
        lidar = ltk.load_lidar(save_lidar_path, 3)
        cube = np.array(lidar[:, :5])
        
        R_z_lidar = np.array([0, 0, rot_lidar[2]], np.float32)
        R_y_lidar = np.array([0, rot_lidar[1], 0], np.float32)
        R_x_lidar = np.array([rot_lidar[0], 0, 0], np.float32)
        
        R_rz_lidar = cv2.Rodrigues(R_z_lidar)[0]
        R_ry_lidar = cv2.Rodrigues(R_y_lidar)[0]
        R_rx_lidar = cv2.Rodrigues(R_x_lidar)[0]
        
        cube[:, 0:3] = cube[:, 0:3]@R_rx_lidar.T@R_ry_lidar.T@R_rz_lidar.T
        cube[:, 0:3]= cube[:, 0:3]+t_lidar
        
        tmp = cube.copy()
        cube[:, 0] = -tmp[:, 1]
        cube[:, 1] = -tmp[:, 2]
        cube[:, 2] = tmp[:, 0]
        cube = cube - t_camera
        tmp = cube[:, 0:3] @ R_ry @ R_rx @ R_rz
        cube[:, 0] = tmp[:, 0]
        cube[:, 1] = tmp[:, 1]
        cube[:, 2] = tmp[:, 2]

        dtype = np.dtype([
            ('x', np.float32),
            ('y', np.float32),
            ('z', np.float32),
            ('rgb', np.uint32),
            ('intensity', np.uint8),
            ('segmentation', np.uint8),
            ('ring', np.uint8),
            ('angle', np.uint8)
        ])

        point_cloud_array = np.empty(len(point_cloud), dtype=dtype)
        point_cloud_array['x'] = point_cloud['x'].astype(np.float32)
        point_cloud_array['y'] = point_cloud['y'].astype(np.float32)
        point_cloud_array['z'] = point_cloud['z'].astype(np.float32)
        point_cloud_array['rgb'] = point_cloud['rgb'].astype(np.uint32)
        point_cloud_array['intensity'] = point_cloud['intensity'].astype(np.uint8)
        point_cloud_array['segmentation'] = point_cloud['segmentation'].astype(np.uint8)
        point_cloud_array['ring'] = point_cloud['ring'].astype(np.uint8)
        point_cloud_array['angle'] = point_cloud['angle'].astype(np.uint8)

        cube[:, 3] = point_cloud_array['intensity'].astype(np.float32)
        cube[:, 4] = point_cloud_array['segmentation'].astype(np.float32)

        fov_mask = is_in_fov(cube[:, :3], camera_matrix)
        fov_points = cube[fov_mask]

        if fov_points.size == 0:
            print("没有点在视野范围内。")
            continue

        posofpoint = fov_points[:, :3].astype(np.float32)
        result, _ = cv2.projectPoints(posofpoint, R0, T0, camera_matrix, distCoeffs)
        result = result.reshape([-1, 2])
        intensitys = fov_points[:, 3]
        segmentations = fov_points[:, 4]

        drawPcdtoImage(img_rgb, result, intensitys, segmentations)

        cv2.imshow("show", img_rgb)
        key = cv2.waitKey(0)

    cv2.destroyAllWindows()
