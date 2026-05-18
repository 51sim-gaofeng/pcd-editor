/**
 * gaussian_view.js 鈥?Orchestrator for 3DGS file loading, parsing, and rendering.
 *
 * Responsibilities:
 *   - Fetch PLY binary from server
 *   - Stream to ply_parser_worker (parse + covariance 鈫?chunks)
 *   - Feed each chunk to SplatRenderer (progressive display)
 *   - Expose tick() for the shared animate loop to trigger sorted rendering
 *   - Auto-fit camera after first chunk arrives
 *
 * Usage:
 *   import { GaussianView } from './gaussian_view.js';
 *   const gv = new GaussianView(renderer, camera, scene, controls);
 *   await gv.loadFile('/api/ply?file=...', 'filename.ply');
 *   // call gv.tick(now) inside the existing animate() loop each frame
 */

import * as THREE from 'three';
import { SplatRenderer } from './splat_renderer.js';

export class GaussianView {
    constructor(renderer, camera, scene, controls) {
        this.renderer  = renderer;
        this.camera    = camera;
        this.scene     = scene;
        this.controls  = controls;   // OrbitControls (may be null)

        this._splat      = null;     // SplatRenderer
        this._worker     = null;     // ply_parser_worker
        this._filename   = '';

        // Stats
        this._totalSplats  = 0;
        this._loadedSplats = 0;
        this._parseMs      = 0;
        this._fetchMs      = 0;
        this._totalMs      = 0;
        this._shDegree     = 0;
        this._maxSplats    = 20000000;

        // Sort throttle: adapt interval to last measured sort time
        this._sortInterval   = 450;   // ms 鈥?updated dynamically
        this._lastSortAt     = 0;
        this._lastSortCamPos = new THREE.Vector3(Infinity, Infinity, Infinity);
        this._lastSortCamDir  = new THREE.Vector3(0, 0, -1);
        this._forceSortOnce  = false;        this._tmpCamDir      = new THREE.Vector3();   // reused per-frame, no GC
        // FPS counter
        this._fpsCnt = 0;
        this._fpsT0  = 0;
        this._fps    = 0;

        // Bounding-box (for camera auto-fit)
        this._bb = new THREE.Box3();
        this._firstChunkFit = false;
    }

    /* 鈹€鈹€ public API 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */

    /**
     * Load and render a PLY file from the given URL.
     * Returns a Promise that resolves when parsing is complete.
     */
    loadFile(url, filename, options = {}) {
        this._filename = filename || url;
        this._dispose();

        this._maxSplats = Math.max(100000, Math.min(20000000, options.maxSplats || 20000000));
        this._shDegree  = Math.max(0, Math.min(3, options.shDegree || 0));

        this._splat = new SplatRenderer(this.renderer, this.camera, this.scene);
        this._splat.setShDegree(this._shDegree);
        this._totalSplats  = 0;
        this._loadedSplats = 0;
        this._parseMs      = 0;
        this._fetchMs      = 0;
        this._totalMs      = 0;
        this._firstChunkFit = false;
        this._bb.makeEmpty();
        this._fpsT0  = performance.now();
        this._fpsCnt = 0;
        this._lastSortCamPos.set(Infinity, Infinity, Infinity);
        this._lastSortCamDir.set(0, 0, -1);
        this._forceSortOnce = false;

        return this._fetchAndParse(url);
    }

    /**
     * Call from the shared animate() loop every frame.
     * Triggers sort when camera moves and enough time has passed.
     */
    tick(now) {
        if (!this._splat) return;
        const camPos = this.camera.position;
        const camDir = this._tmpCamDir;
        this.camera.getWorldDirection(camDir);
        const moved = camPos.distanceTo(this._lastSortCamPos) > 0.04 || camDir.dot(this._lastSortCamDir) < 0.9997;

        // Detect sort completion: when a pending sort just finished,
        // reset the timer so the next tick can immediately re-sort if camera moved.
        const sortPendingNow = this._splat._sortPending;
        if (this._sortWasPending && !sortPendingNow && moved) {
            this._lastSortAt = 0;  // allow immediate re-sort
        }
        this._sortWasPending = sortPendingNow;

        const shouldSort = this._forceSortOnce || (moved && now - this._lastSortAt > this._sortInterval);
        if (shouldSort) {
            const wasPending = this._splat._sortPending;
            this._splat.requestSort();
            const issuedSort = (!wasPending && this._splat._sortPending) || this._splat._lastSortMs > 0;
            if (issuedSort) {
                this._lastSortAt = now;
                this._lastSortCamPos.copy(camPos);
                this._lastSortCamDir.copy(camDir);
                this._forceSortOnce = false;
                // Adapt sort interval: 1.5x last sort time (was 3.0x), min 100ms
                if (this._splat._lastSortMs > 0) {
                    this._sortInterval = Math.max(100, this._splat._lastSortMs * 1.5);
                }
            }
        }
        // FPS
        this._fpsCnt++;
        this._splat.updateFrameUniforms();
        const dt = now - this._fpsT0;
        if (dt >= 1000) {
            this._fps    = (this._fpsCnt * 1000 / dt) | 0;
            this._fpsCnt = 0;
            this._fpsT0  = now;
        }
    }

    /** Notify renderer of canvas resize. */
    onResize(w, h) { this._splat?.onResize(w, h); }

    setSplatScale(s) { this._splat?.setSplatScale(s); }

    getTotalSplats()  { return this._totalSplats; }
    getLoadedSplats() { return this._loadedSplats; }
    getFilename()     { return this._filename; }
    getFps()          { return this._fps; }
    getLoadMetrics()  { return { fetchMs: this._fetchMs, parseMs: this._parseMs, totalMs: this._totalMs }; }
    isLoading()       { return this._worker !== null; }

    setShDegree(level) {
        this._shDegree = Math.max(0, Math.min(3, level|0));
        this._splat?.setShDegree(this._shDegree);
    }

    setColorAdjust(key, val) { this._splat?.setColorAdjust(key, val); }
    resetColorAdjust() { this._splat?.resetColorAdjust(); }
    getColorDefaults() { return this._splat?.getColorDefaults() || { brightness: 0, contrast: 1, saturation: 1, temperature: 0, hueShift: 0 }; }

    dispose() { this._dispose(); }

    /* 鈹€鈹€ internal 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */

    _fetchAndParse(url) {
        return new Promise(async (resolve, reject) => {
            const tAll0 = performance.now();
            let buffer;
            try {
                const t0 = performance.now();
                const resp = await fetch(url);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
                buffer = await resp.arrayBuffer();
                this._fetchMs = performance.now() - t0;
            } catch (err) {
                reject(err); return;
            }

            const workerUrl = new URL('./ply_parser_worker.js', import.meta.url).href;
            this._worker = new Worker(workerUrl);

            this._worker.onmessage = (e) => {
                const msg = e.data;

                if (msg.type === 'chunk') {
                    this._totalSplats  = msg.totalCount;
                    this._loadedSplats = msg.offset + msg.count;
                    this._splat.appendChunk(
                        msg.texData,
                        msg.centers,
                        msg.count,
                        msg.offset,
                        msg.shData,
                        msg.shCoeffCount || 0,
                        msg.radii
                    );

                    // Auto-fit camera to first chunk
                    if (!this._firstChunkFit && msg.count > 0 && msg.centers) {
                        this._firstChunkFit = true;
                        this._autoFit(new Float32Array(msg.centers));
                    }

                } else if (msg.type === 'done') {
                    this._totalSplats = msg.totalCount;
                    this._parseMs     = msg.parseMs;
                    this._totalMs     = performance.now() - tAll0;
                    this._worker.terminate();
                    this._worker = null;
                    // Final sort with correct camera position
                    this._splat._sortNeeded = true;
                    this._forceSortOnce = true;
                    this._lastSortAt = -1e9;
                    resolve({ totalCount: msg.totalCount, fetchMs: this._fetchMs, parseMs: this._parseMs, totalMs: this._totalMs });

                } else if (msg.type === 'error') {
                    this._worker.terminate();
                    this._worker = null;
                    reject(new Error(msg.message));
                }
            };

            this._worker.onerror = (err) => {
                this._worker = null;
                reject(err);
            };

            this._worker.postMessage({ type: 'parse', buffer, options: { maxSplats: this._maxSplats, shDegree: this._shDegree } }, [buffer]);
        });
    }

    /**
     * Fit camera to bounding box estimated from the first chunk's positions.
     */
    _autoFit(centers) {
        const N = (centers.length / 3) | 0;
        if (N === 0) return;

        // Sample up to 4000 points for speed
        const step  = Math.max(1, (N / 4000) | 0);
        const bb    = new THREE.Box3();
        const v     = new THREE.Vector3();

        for (let i = 0; i < N; i += step) {
            v.set(centers[i*3], centers[i*3+1], centers[i*3+2]);
            bb.expandByPoint(v);
        }
        if (bb.isEmpty()) return;

        const center = new THREE.Vector3();
        bb.getCenter(center);
        const size   = bb.getSize(new THREE.Vector3());
        const radius = Math.max(size.x, size.y, size.z) * 0.6;

        const cam = this.camera;
        cam.position.set(center.x, center.y - radius * 1.8, center.z + radius * 0.5);
        if (this.controls) {
            this.controls.target.copy(center);
            this.controls.update();
        } else {
            cam.lookAt(center);
        }
    }

    _dispose() {
        if (this._worker) { this._worker.terminate(); this._worker = null; }
        if (this._splat)  { this._splat.dispose();   this._splat  = null; }
    }
}


