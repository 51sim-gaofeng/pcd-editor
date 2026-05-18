/**
 * splat_sort_worker.js — Web Worker: cull + sort Gaussian splats back-to-front.
 *
 * Performs visibility culling AND 4-pass 8-bit radix sort entirely off main thread.
 * Sort key: negated view-space depth → ascending sort = back-to-front.
 *
 * Message in:
 *   { type:'sort', centers:ArrayBuffer(Float32, N×3), radii:ArrayBuffer|null,
 *     totalCount:N, camPos:[x,y,z], camFwd:[fx,fy,fz],
 *     focal:number, maxVisible:number, minPx:number, farCull:number }
 * Message out:
 *   { type:'sorted', indices:ArrayBuffer(Float32, M), sortTime:ms, cullTime:ms, visibleCount:number }
 */

'use strict';

/* ---------- 4-pass 8-bit counting/radix sort on Uint32Array ---------- */

function radixSort(keys, indices, N) {
    const cnt = new Int32Array(256);
    const keysTmp    = new Uint32Array(N);
    const indicesTmp = new Uint32Array(N);

    for (let pass = 0; pass < 4; pass++) {
        const shift = pass * 8;

        // count
        cnt.fill(0);
        for (let i = 0; i < N; i++) {
            cnt[(keys[i] >>> shift) & 0xff]++;
        }
        // exclusive prefix sum
        let acc = 0;
        for (let b = 0; b < 256; b++) {
            const c = cnt[b];
            cnt[b] = acc;
            acc += c;
        }
        // scatter
        for (let i = 0; i < N; i++) {
            const bucket = (keys[i] >>> shift) & 0xff;
            const pos    = cnt[bucket]++;
            keysTmp[pos]    = keys[i];
            indicesTmp[pos] = indices[i];
        }
        // swap buffers
        keys.set(keysTmp);
        indices.set(indicesTmp);
    }
}

/* ---------- float32 → sortable uint32 (preserves numeric order) ---------- */

const _ab  = new ArrayBuffer(4);
const _f32 = new Float32Array(_ab);
const _u32 = new Uint32Array(_ab);

function floatToSortKey(f) {
    _f32[0] = f;
    const bits = _u32[0];
    return (bits & 0x80000000) ? (~bits >>> 0) : (bits ^ 0x80000000);
}

/* ---------- main message handler ---------- */

self.onmessage = function (e) {
    const msg = e.data;
    if (msg.type !== 'sort') return;

    const { totalCount: N, camPos, camFwd, focal, maxVisible, minPx, farCull } = msg;
    const centers = new Float32Array(msg.centers);
    const radii = msg.radii ? new Float32Array(msg.radii) : null;

    const cpx = camPos[0], cpy = camPos[1], cpz = camPos[2];
    const cfx = camFwd[0], cfy = camFwd[1], cfz = camFwd[2];

    /* ── Phase 1: Visibility culling (moved from main thread) ── */
    const tCull0 = performance.now();

    // Pre-allocate to avoid dynamic push() GC pressure
    const visibleBuf = new Uint32Array(Math.min(N, maxVisible + 1024));
    let visCount = 0;

    for (let i = 0; i < N; i++) {
        const bx = centers[i*3]   - cpx;
        const by = centers[i*3+1] - cpy;
        const bz = centers[i*3+2] - cpz;
        const depth = bx*cfx + by*cfy + bz*cfz;
        // Use radius margin: a splat whose center is slightly behind the camera
        // but whose physical extent crosses the view plane should still be included.
        const radius = radii ? radii[i] : 1.0;
        if (depth + radius <= 0.0 || depth > farCull) continue;
        const pxRadius = focal * radius / Math.max(depth, 0.1);
        if (pxRadius < minPx) continue;
        if (visCount < visibleBuf.length) {
            visibleBuf[visCount] = i;
        }
        visCount++;
    }

    const cullTime = performance.now() - tCull0;

    /* ── Phase 1b: Apply maxVisible cap ── */
    let activeIndices;
    let activeCount;

    if (visCount === 0) {
        // Safety fallback: never blank the scene
        if (N > maxVisible) {
            activeIndices = new Uint32Array(maxVisible);
            const step = N / maxVisible;
            for (let i = 0; i < maxVisible; i++) activeIndices[i] = Math.floor(i * step);
            activeCount = maxVisible;
        } else {
            activeIndices = new Uint32Array(N);
            for (let i = 0; i < N; i++) activeIndices[i] = i;
            activeCount = N;
        }
    } else if (visCount > maxVisible) {
        const actualVis = Math.min(visCount, visibleBuf.length);
        const step = Math.ceil(actualVis / maxVisible);
        activeIndices = new Uint32Array(Math.ceil(actualVis / step));
        let j = 0;
        for (let i = 0; i < actualVis; i += step) {
            activeIndices[j++] = visibleBuf[i];
        }
        activeCount = j;
    } else {
        activeCount = Math.min(visCount, visibleBuf.length);
        activeIndices = visibleBuf.subarray(0, activeCount);
    }

    /* ── Phase 2: Radix sort back-to-front ── */
    const t0 = performance.now();

    const M = activeCount;
    const keys    = new Uint32Array(M);
    const indices = new Uint32Array(M);

    for (let i = 0; i < M; i++) {
        const src = activeIndices[i];
        const dx = centers[src*3]   - cpx;
        const dy = centers[src*3+1] - cpy;
        const dz = centers[src*3+2] - cpz;
        const depth = dx*cfx + dy*cfy + dz*cfz;
        keys[i]    = floatToSortKey(-depth);
        indices[i] = src;
    }

    radixSort(keys, indices, M);

    // Return as Float32Array (integers exact up to 2^24 = 16M splats)
    const result = new Float32Array(M);
    for (let i = 0; i < M; i++) result[i] = indices[i];

    const sortTime = performance.now() - t0;
    // Return the transferred centers/radii buffers back to the main thread
    const transferList = [result.buffer];
    if (msg.centers) transferList.push(msg.centers);
    if (msg.radii)   transferList.push(msg.radii);
    self.postMessage(
        { type: 'sorted', indices: result.buffer, sortTime, cullTime, visibleCount: visCount,
          centers: msg.centers || null, radii: msg.radii || null },
        transferList
    );
};
