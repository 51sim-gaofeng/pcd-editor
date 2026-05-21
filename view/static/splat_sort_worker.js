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
 *   { type:'sorted', indices:ArrayBuffer(Uint32, M), sortTime:ms, cullTime:ms, visibleCount:number }
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
    const seq = msg.seq | 0;

    const { totalCount: N, camPos, camFwd, maxVisible } = msg;
    const centers = new Float32Array(msg.centers);
    const radii = msg.radii ? new Float32Array(msg.radii) : null;

    const cpx = camPos[0], cpy = camPos[1], cpz = camPos[2];
    const cfx = camFwd[0], cfy = camFwd[1], cfz = camFwd[2];

    /* ── Phase 1: Stable working set selection (SuperSplat-style) ── */
    const tCull0 = performance.now();

    // Keep selected splat set stable across camera motion.
    // This avoids visible-set thrashing/pop-in when rapidly retreating or orbiting.
    let activeIndices;
    let activeCount;

    if (N > maxVisible) {
        activeIndices = new Uint32Array(maxVisible);
        const step = N / maxVisible;
        for (let i = 0; i < maxVisible; i++) {
            activeIndices[i] = Math.floor(i * step);
        }
        activeCount = maxVisible;
    } else {
        activeIndices = new Uint32Array(N);
        for (let i = 0; i < N; i++) activeIndices[i] = i;
        activeCount = N;
    }

    const cullTime = performance.now() - tCull0;

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

    const result = new Uint32Array(M);
    result.set(indices);

    const sortTime = performance.now() - t0;
    // Return the transferred centers/radii buffers back to the main thread
    const transferList = [result.buffer];
    if (msg.centers) transferList.push(msg.centers);
    if (msg.radii)   transferList.push(msg.radii);
    self.postMessage(
                { type: 'sorted', indices: result.buffer, sortTime, cullTime, visibleCount: activeCount,
                    centers: msg.centers || null, radii: msg.radii || null, seq },
        transferList
    );
};
