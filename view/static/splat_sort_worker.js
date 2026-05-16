/**
 * splat_sort_worker.js — Web Worker: sort Gaussian splats back-to-front.
 *
 * Uses 4-pass 8-bit radix sort (32-bit key) for O(N) performance.
 * Sort key: negated view-space depth → ascending sort = back-to-front.
 *
 * Message in:
 *   { type:'sort', centers:ArrayBuffer (Float32, N×3),
 *     indices?:ArrayBuffer(Uint32, N), count:N, camPos:[x,y,z], camFwd:[fx,fy,fz] }
 * Message out:
 *   { type:'sorted', indices:ArrayBuffer (Float32, N), sortTime:ms }
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
// Positive floats: flip sign bit (0x80000000)
// Negative floats: flip all bits
// Result: larger uint32 ⟺ larger float

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

    const t0 = performance.now();

    const { count: N, camPos, camFwd } = msg;
    const pos = new Float32Array(msg.centers);     // transferred buffer
    const srcIndices = msg.indices ? new Uint32Array(msg.indices) : null;

    // Build sort keys (negate depth so ascending sort = back-to-front)
    const keys    = new Uint32Array(N);
    const indices = new Uint32Array(N);

    const cpx = camPos[0], cpy = camPos[1], cpz = camPos[2];
    const cfx = camFwd[0], cfy = camFwd[1], cfz = camFwd[2];

    for (let i = 0; i < N; i++) {
        const src = srcIndices ? srcIndices[i] : i;
        const dx = pos[src*3]   - cpx;
        const dy = pos[src*3+1] - cpy;
        const dz = pos[src*3+2] - cpz;
        const depth = dx*cfx + dy*cfy + dz*cfz;
        // Negate: farthest (largest depth) → most negative negated → smallest key → sorted first
        keys[i]    = floatToSortKey(-depth);
        indices[i] = src;
    }

    // 4-pass radix sort (ascending key = back-to-front)
    radixSort(keys, indices, N);

    // Return as Float32Array for use as index texture values
    // (Float32 can represent integers exactly up to 2^24 = 16M splats)
    const result = new Float32Array(N);
    for (let i = 0; i < N; i++) result[i] = indices[i];

    const sortTime = performance.now() - t0;
    self.postMessage(
        { type: 'sorted', indices: result.buffer, sortTime },
        [result.buffer]
    );
};
