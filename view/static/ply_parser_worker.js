/**
 * ply_parser_worker.js — Web Worker: parse 3DGS PLY + compute 3D covariance matrix.
 *
 * Message in:  { type:'parse', buffer: ArrayBuffer }
 * Message out: { type:'chunk', texData:ArrayBuffer, centers:ArrayBuffer,
 *                count, offset, totalCount }  (multiple, one per CHUNK_SIZE splats)
 *              { type:'done',  totalCount, parseMs }
 *              { type:'error', message }
 *
 * Data layout per splat (3 RGBA32F texels = 12 floats):
 *   px0: x,  y,  z,  0
 *   px1: cov00, cov01, cov02, cov11
 *   px2: cov12, cov22, 0, rgba_packed_as_float32
 *        rgba packed: uint32 = r|(g<<8)|(b<<16)|(a<<24), reinterpreted as float32
 *
 * SH DC base color decode (common 3DGS convention): rgb = clamp(0.5 + SH_C0 * f_dc, 0, 1)
 */

'use strict';

const CHUNK_SIZE = 131072;      // splats per posted chunk (reduce worker messaging overhead)
const SH_C0 = 0.2820947917;    // SH band-0 coefficient

/* ---------- helpers ---------- */

function sigmoid(x) {
    return x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
}

/**
 * Compute upper-triangle of 3D covariance Σ = RS·(RS)ᵀ
 * where RS[col j] = R_col_j * scale_j
 * Returns [s00, s01, s02, s11, s12, s22]
 */
function computeCov3DInto(out, qw, qx, qy, qz, s0, s1, s2) {
    // Normalize quaternion
    const lenSq = qw*qw + qx*qx + qy*qy + qz*qz;
    const inv = lenSq > 1e-12 ? 1.0 / Math.sqrt(lenSq) : 1.0;
    const w = qw*inv, x = qx*inv, y = qy*inv, z = qz*inv;

    // Rotation matrix (column-major, from unit quaternion)
    const x2=2*x, y2=2*y, z2=2*z;
    const wx=w*x2, wy=w*y2, wz=w*z2;
    const xx=x*x2, xy=x*y2, xz=x*z2;
    const yy=y*y2, yz=y*z2, zz=z*z2;

    // R: column 0 = (r00, r10, r20), column 1 = (r01, r11, r21), column 2 = (r02, r12, r22)
    const r00 = 1-(yy+zz), r10 = xy+wz,    r20 = xz-wy;
    const r01 = xy-wz,     r11 = 1-(xx+zz), r21 = yz+wx;
    const r02 = xz+wy,     r12 = yz-wx,     r22 = 1-(xx+yy);

    // Scaled columns: RS_j = R_col_j * s_j
    const m00=r00*s0, m10=r10*s0, m20=r20*s0;
    const m01=r01*s1, m11=r11*s1, m21=r21*s1;
    const m02=r02*s2, m12=r12*s2, m22=r22*s2;

    // Σ = RS·(RS)ᵀ  (symmetric, store upper triangle)
    out[0] = m00*m00 + m01*m01 + m02*m02;  // [0][0]
    out[1] = m00*m10 + m01*m11 + m02*m12;  // [0][1]
    out[2] = m00*m20 + m01*m21 + m02*m22;  // [0][2]
    out[3] = m10*m10 + m11*m11 + m12*m12;  // [1][1]
    out[4] = m10*m20 + m11*m21 + m12*m22;  // [1][2]
    out[5] = m20*m20 + m21*m21 + m22*m22;  // [2][2]
}

/* ---------- PLY header parser ---------- */

function parsePlyHeader(buffer) {
    const maxHead = Math.min(8192, buffer.byteLength);
    const bytes = new Uint8Array(buffer, 0, maxHead);
    let raw = '';
    for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]);

    const endTag = 'end_header';
    const tagIdx = raw.indexOf(endTag);
    if (tagIdx === -1) throw new Error('PLY: end_header not found');

    let littleEndian = true;

    // Skip past the newline that follows end_header
    let dataOffset = tagIdx + endTag.length;
    if (raw[dataOffset] === '\r') dataOffset++;
    if (raw[dataOffset] === '\n') dataOffset++;

    const lines = raw.slice(0, tagIdx).split('\n');
    let vertexCount = 0;
    const properties = [];
    let inVertex = false;

    for (const line of lines) {
        const t = line.trim();
        if (t === 'format binary_big_endian 1.0') littleEndian = false;
        else if (t === 'format binary_little_endian 1.0') littleEndian = true;
        if (t.startsWith('element vertex')) {
            vertexCount = parseInt(t.split(/\s+/)[2], 10);
            inVertex = true;
        } else if (t.startsWith('element ') && !t.startsWith('element vertex')) {
            inVertex = false;
        } else if (inVertex && t.startsWith('property float')) {
            properties.push(t.split(/\s+/)[2]);
        }
    }

    return { vertexCount, dataOffset, properties, littleEndian };
}

/* ---------- main message handler ---------- */

self.onmessage = function (e) {
    const msg = e.data;
    if (msg.type !== 'parse') return;

    const buffer = msg.buffer;
    const options = msg.options || {};
    const maxSplats = Math.max(100000, Math.min(20000000, options.maxSplats || 20000000));
    const shDegree = Math.max(0, Math.min(3, options.shDegree || 0));
    const t0 = performance.now();

    try {
        const { vertexCount, dataOffset, properties, littleEndian } = parsePlyHeader(buffer);
        if (!vertexCount) throw new Error('PLY: no vertices found');

        // Build property index map
        const pi = {};
        properties.forEach((p, i) => { pi[p] = i; });
        const nProps = properties.length;
        const bytesPerSplat = nProps * 4;  // float32 per property

        // Validate enough data
        const available = (buffer.byteLength - dataOffset) / bytesPerSplat | 0;
        const totalCount = Math.min(vertexCount, available, maxSplats);

        // Required indices
        const xi   = pi['x']       ?? -1, yi  = pi['y']     ?? -1, zi  = pi['z']     ?? -1;
        const f0i  = pi['f_dc_0']  ?? -1, f1i = pi['f_dc_1']?? -1, f2i = pi['f_dc_2']?? -1;
        const ri   = pi['red']     ?? -1, gi  = pi['green'] ?? -1, bi  = pi['blue']   ?? -1;
        const oi   = pi['opacity'] ?? -1;
        const sc0i = pi['scale_0'] ?? -1, sc1i = pi['scale_1']?? -1, sc2i = pi['scale_2']?? -1;
        const q0i  = pi['rot_0']   ?? -1, q1i = pi['rot_1']  ?? -1;
        const q2i  = pi['rot_2']   ?? -1, q3i = pi['rot_3']  ?? -1;

        const hasPos   = xi>=0 && yi>=0 && zi>=0;
        const hasSH    = f0i>=0 && f1i>=0 && f2i>=0;
        const hasRGB   = ri>=0 && gi>=0 && bi>=0;
        const hasOpa   = oi>=0;
        const hasScale = sc0i>=0 && sc1i>=0 && sc2i>=0;
        const hasRot   = q0i>=0 && q1i>=0 && q2i>=0 && q3i>=0;

        const restMap = [];
        for (const p of properties) {
            if (p.startsWith('f_rest_')) {
                const n = parseInt(p.slice(7), 10);
                if (!Number.isNaN(n)) restMap[n] = pi[p];
            }
        }
        const restCount = restMap.reduce((acc, v) => acc + (v !== undefined ? 1 : 0), 0);
        const availableShCoeffCount = Math.min(15, Math.floor(restCount / 3));
        const shNeedByDegree = [0, 3, 8, 15];
        const targetShCoeffCount = shNeedByDegree[shDegree] || 0;
        const shCoeffCount = Math.min(availableShCoeffCount, targetShCoeffCount);

        if (!hasPos) throw new Error('PLY: missing x/y/z properties');

        const dataView = new DataView(buffer, dataOffset, totalCount * bytesPerSplat);

        // Precompute byte offsets for hot-loop fields
        const xB = xi * 4, yB = yi * 4, zB = zi * 4;
        const f0B = f0i * 4, f1B = f1i * 4, f2B = f2i * 4;
        const rBOfs = ri * 4, gBOfs = gi * 4, bBOfs = bi * 4;
        const oB = oi * 4;
        const sc0B = sc0i * 4, sc1B = sc1i * 4, sc2B = sc2i * 4;
        const q0B = q0i * 4, q1B = q1i * 4, q2B = q2i * 4, q3B = q3i * 4;

        const shR = [];
        const shG = [];
        const shB = [];
        if (shCoeffCount > 0) {
            const gOff = shCoeffCount;
            const bOff = shCoeffCount * 2;
            for (let c = 0; c < shCoeffCount; c++) {
                const piR = restMap[c] ?? -1;
                const piG = restMap[gOff + c] ?? -1;
                const piB = restMap[bOff + c] ?? -1;
                shR[c] = piR >= 0 ? piR * 4 : -1;
                shG[c] = piG >= 0 ? piG * 4 : -1;
                shB[c] = piB >= 0 ? piB * 4 : -1;
            }
        }

        const cov = new Float32Array(6);

        // Reusable DataView for float↔uint32 bit casting
        const _ab = new ArrayBuffer(4);
        const _f32 = new Float32Array(_ab);
        const _u32 = new Uint32Array(_ab);

        for (let chunkStart = 0; chunkStart < totalCount; chunkStart += CHUNK_SIZE) {
            const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, totalCount);
            const count = chunkEnd - chunkStart;

            // texData: 12 floats per splat (3 RGBA32F texels)
            const texData = new Float32Array(count * 12);
            const centers = new Float32Array(count * 3);
            const shData = shCoeffCount > 0 ? new Float32Array(count * shCoeffCount * 4) : null;
            const radii = new Float32Array(count);

            for (let i = 0; i < count; i++) {
                const rowByte = (chunkStart + i) * bytesPerSplat;

                /* --- position --- */
                const px = hasPos ? dataView.getFloat32(rowByte + xB, littleEndian) : 0;
                const py = hasPos ? dataView.getFloat32(rowByte + yB, littleEndian) : 0;
                const pz = hasPos ? dataView.getFloat32(rowByte + zB, littleEndian) : 0;
                centers[i*3] = px; centers[i*3+1] = py; centers[i*3+2] = pz;

                /* --- color --- */
                let r = 0.5, g = 0.5, b = 0.5;
                if (hasRGB) {
                    r = dataView.getFloat32(rowByte + rBOfs, littleEndian);
                    g = dataView.getFloat32(rowByte + gBOfs, littleEndian);
                    b = dataView.getFloat32(rowByte + bBOfs, littleEndian);
                    if (r > 1 || g > 1 || b > 1) {
                        r /= 255.0; g /= 255.0; b /= 255.0;
                    }
                } else if (hasSH) {
                    r = 0.5 + SH_C0 * dataView.getFloat32(rowByte + f0B, littleEndian);
                    g = 0.5 + SH_C0 * dataView.getFloat32(rowByte + f1B, littleEndian);
                    b = 0.5 + SH_C0 * dataView.getFloat32(rowByte + f2B, littleEndian);
                }

                /* --- opacity --- */
                const opacity = hasOpa ? sigmoid(dataView.getFloat32(rowByte + oB, littleEndian)) : 1.0;

                /* --- scale (log → exp) --- */
                const s0 = hasScale ? Math.exp(dataView.getFloat32(rowByte + sc0B, littleEndian)) : 1.0;
                const s1 = hasScale ? Math.exp(dataView.getFloat32(rowByte + sc1B, littleEndian)) : 1.0;
                const s2 = hasScale ? Math.exp(dataView.getFloat32(rowByte + sc2B, littleEndian)) : 1.0;

                /* --- rotation quaternion (rot_0=w, rot_1=x, rot_2=y, rot_3=z) --- */
                const qw = hasRot ? dataView.getFloat32(rowByte + q0B, littleEndian) : 1.0;
                const qx = hasRot ? dataView.getFloat32(rowByte + q1B, littleEndian) : 0.0;
                const qy = hasRot ? dataView.getFloat32(rowByte + q2B, littleEndian) : 0.0;
                const qz = hasRot ? dataView.getFloat32(rowByte + q3B, littleEndian) : 0.0;

                /* --- 3D covariance --- */
                computeCov3DInto(cov, qw, qx, qy, qz, s0, s1, s2);
                const diagMax = Math.max(cov[0], cov[3], cov[5]);
                radii[i] = Math.max(1e-4, 3.0 * Math.sqrt(Math.max(0.0, diagMax)));

                /* --- pack RGBA as float32 via uint32 bit reinterpretation --- */
                const rB = Math.round(Math.min(1, Math.max(0, r))       * 255) & 0xff;
                const gB = Math.round(Math.min(1, Math.max(0, g))       * 255) & 0xff;
                const bB = Math.round(Math.min(1, Math.max(0, b))       * 255) & 0xff;
                const aB = Math.round(Math.min(1, Math.max(0, opacity)) * 255) & 0xff;
                _u32[0] = rB | (gB << 8) | (bB << 16) | (aB << 24);
                const rgbaPacked = _f32[0];

                /* --- write 3 texels (12 floats) --- */
                const t = i * 12;
                texData[t+0]  = px;       texData[t+1]  = py;       texData[t+2]  = pz;       texData[t+3]  = 0.0;
                texData[t+4]  = cov[0];   texData[t+5]  = cov[1];   texData[t+6]  = cov[2];   texData[t+7]  = cov[3];
                texData[t+8]  = cov[4];   texData[t+9]  = cov[5];   texData[t+10] = 0.0;      texData[t+11] = rgbaPacked;

                if (shData) {
                    const sBase = i * shCoeffCount * 4;
                    for (let c = 0; c < shCoeffCount; c++) {
                        const sv = sBase + c * 4;
                        const rOfs = shR[c], gOfs = shG[c], bOfs = shB[c];
                        shData[sv + 0] = rOfs >= 0 ? dataView.getFloat32(rowByte + rOfs, littleEndian) : 0.0;
                        shData[sv + 1] = gOfs >= 0 ? dataView.getFloat32(rowByte + gOfs, littleEndian) : 0.0;
                        shData[sv + 2] = bOfs >= 0 ? dataView.getFloat32(rowByte + bOfs, littleEndian) : 0.0;
                        shData[sv + 3] = 0.0;
                    }
                }
            }

            if (shData) {
                self.postMessage(
                                        { type: 'chunk', texData: texData.buffer, centers: centers.buffer, shData: shData.buffer,
                                            radii: radii.buffer, shCoeffCount, count, offset: chunkStart, totalCount },
                                        [texData.buffer, centers.buffer, shData.buffer, radii.buffer]
                );
            } else {
                self.postMessage(
                                        { type: 'chunk', texData: texData.buffer, centers: centers.buffer,
                                            radii: radii.buffer, shCoeffCount: 0, count, offset: chunkStart, totalCount },
                                        [texData.buffer, centers.buffer, radii.buffer]
                );
            }
        }

        self.postMessage({ type: 'done', totalCount, parseMs: performance.now() - t0 });

    } catch (err) {
        self.postMessage({ type: 'error', message: err.message });
    }
};
