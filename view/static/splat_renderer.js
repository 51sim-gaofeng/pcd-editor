/**
 * splat_renderer.js — Three.js Gaussian Splat Renderer
 *
 * Implements proper 2D Gaussian covariance projection (SuperSplat / antimatter15 approach):
 *   1. Reads pre-computed 3D covariance Σ from RGBA32F DataTexture
 *   2. Vertex shader: Jacobian projection → 2D cov → eigendecomposition → ellipse quad
 *   3. Fragment shader: Gaussian falloff exp(-dot(uv,uv))  (uv already in eigen-space)
 *   4. Premultiplied-alpha custom blending (ONE, ONE_MINUS_SRC_ALPHA)
 *   5. Sort worker: 4-pass radix sort by view-space depth (back-to-front)
 *
 * Texture layout:
 *   u_texture (RGBA32F, W=1024): 3 texels per splat
 *     px0: x, y, z, 0
 *     px1: cov00, cov01, cov02, cov11
 *     px2: cov12, cov22, 0, rgba_packed_float32
 *   u_index (R32F, W=1024): 1 texel per splat = sorted splat index (float, exact for N<16M)
 */

import * as THREE from 'three';

/* ──────────────────────────────────────────────────────────────────────────── */
/* GLSL shaders                                                                 */
/* ──────────────────────────────────────────────────────────────────────────── */

const VERTEX_SHADER = /* glsl */`
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D u_texture;   // RGBA32F: 3 texels per splat
uniform sampler2D u_index;     // R32F:    sorted splat indices
uniform sampler2D u_shTex;     // optional SH coeff texture (RGB coeff per texel)

uniform vec2  u_viewport;      // (width, height) in pixels
uniform mat4  u_view;          // camera.matrixWorldInverse
uniform mat4  u_proj;          // camera.projectionMatrix
uniform float u_splatScale;    // user scale multiplier (default 1.0)
uniform vec3  u_camPos;        // camera position in world
uniform int   u_shCoeffCount;  // number of SH coeff texels per splat
uniform int   u_shDegree;      // 0..3

in vec3 position;              // quad corner in [-2, 2] range (local splat space)

out vec4 vColor;
out vec2 vPos2;                // passed to fragment for Gaussian eval

/* ── fetch helpers ── */
ivec2 addr(int idx, int w) { return ivec2(idx % w, idx / w); }
vec3 fetchSh(int splatIdx, int coeffIdx){
    int sw = textureSize(u_shTex, 0).x;
    int p = splatIdx * u_shCoeffCount + coeffIdx;
    return texelFetch(u_shTex, addr(p, sw), 0).rgb;
}

void main() {
    /* look up sorted splat index */
    int iw = textureSize(u_index, 0).x;
    int splatIdx = int(texelFetch(u_index, addr(gl_InstanceID, iw), 0).r + 0.5);

    /* read 3 data texels */
    int dw   = textureSize(u_texture, 0).x;
    int base = splatIdx * 3;
    vec4 px0 = texelFetch(u_texture, addr(base,   dw), 0);   // x, y, z, _
    vec4 px1 = texelFetch(u_texture, addr(base+1, dw), 0);   // cov00..cov11
    vec4 px2 = texelFetch(u_texture, addr(base+2, dw), 0);   // cov12, cov22, _, rgba

    /* view-space position */
    vec4 cam  = u_view * vec4(px0.xyz, 1.0);
    vec4 clip = u_proj * cam;

    /* conservative cull: keep x/y in case large ellipses overlap viewport edge */
    float cl = 1.2 * clip.w;
    if (clip.z < -cl || clip.z > cl ||
        cam.z  >= -0.001) {               /* behind near plane */
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        vColor = vec4(0.0); vPos2 = vec2(0.0);
        return;
    }

    /* ── 3D covariance (upper-triangle, symmetric) ── */
    mat3 Vrk = mat3(
        px1.x, px1.y, px1.z,
        px1.y, px1.w, px2.x,
        px1.z, px2.x, px2.y
    );

    /* ── Jacobian of perspective projection at cam ── */
    /* focal lengths in pixels: f_x = proj[0][0]*W/2, f_y = proj[1][1]*H/2 */
    float focalX =  u_proj[0][0] * u_viewport.x * 0.5;
    float focalY =  u_proj[1][1] * u_viewport.y * 0.5;
    float z = cam.z;    /* negative for objects in front (OpenGL convention) */

    /* J is the Jacobian of the pixel-space projection w.r.t. view-space coords */
    mat3 J = mat3(
         focalX / z,   0.0,          -(focalX * cam.x) / (z * z),
         0.0,          focalY / z,   -(focalY * cam.y) / (z * z),
         0.0,          0.0,           0.0
    );

    /* T = Rᵥᵢₑwᵀ · J  — used to project world covariance to screen space */
    mat3 T = transpose(mat3(u_view)) * J;

    /* 2D screen-space covariance:  Σ₂D = Tᵀ · Vrk · T */
    mat3 cov2d = transpose(T) * Vrk * T;

    /* low-pass filter (prevents aliasing / degenerate splats) */
    cov2d[0][0] += 0.3;
    cov2d[1][1] += 0.3;

    float a = cov2d[0][0], b = cov2d[0][1], c = cov2d[1][1];

    /* ── eigendecomposition of 2×2 covariance ── */
    float mid   = 0.5 * (a + c);
    float disc  = sqrt(max(0.0, mid*mid - (a*c - b*b)));
    float lam1  = mid + disc;
    float lam2  = max(0.0, mid - disc);

    /* principal eigenvector (major axis direction) */
    vec2 ev = (abs(b) > 1e-6) ? normalize(vec2(b, lam1 - a)) : vec2(1.0, 0.0);

    /* pixel radii along each axis (clamped to 1024 px for safety) */
    float r1 = min(u_splatScale * sqrt(2.0 * lam1), 1024.0);
    float r2 = min(u_splatScale * sqrt(2.0 * lam2), 1024.0);

    /* screen-space ellipse axes */
    vec2 major = ev             * r1;
    vec2 minor = vec2(-ev.y, ev.x) * r2;

    /* NDC centre + displaced quad corner */
    vec2 ndc    = clip.xy / clip.w;
    vec2 offset = (position.x * major + position.y * minor) / (u_viewport * 0.5);
    gl_Position = vec4(ndc + offset, 0.0, 1.0);

    /* ── unpack RGBA from bit-cast float ── */
    uint rgba = floatBitsToUint(px2.w);
    vColor = vec4(
        float( rgba        & 0xffu),
        float((rgba >>  8u)& 0xffu),
        float((rgba >> 16u)& 0xffu),
        float((rgba >> 24u)& 0xffu)
    ) / 255.0;

    if (u_shDegree > 0 && u_shCoeffCount > 0) {
        vec3 rgb = vColor.rgb;
        vec3 d = normalize(u_camPos - px0.xyz);
        float x=d.x,y=d.y,z=d.z;
        if (u_shCoeffCount > 0) {
            vec3 c = fetchSh(splatIdx, 0);
            rgb += vec3(-0.4886025119*y) * c;
        }
        if (u_shCoeffCount > 1) {
            vec3 c = fetchSh(splatIdx, 1);
            rgb += vec3(0.4886025119*z) * c;
        }
        if (u_shCoeffCount > 2) {
            vec3 c = fetchSh(splatIdx, 2);
            rgb += vec3(-0.4886025119*x) * c;
        }
        if (u_shDegree >= 2) {
            if (u_shCoeffCount > 3) rgb += vec3(1.0925484306*x*y) * fetchSh(splatIdx, 3);
            if (u_shCoeffCount > 4) rgb += vec3(-1.0925484306*y*z) * fetchSh(splatIdx, 4);
            if (u_shCoeffCount > 5) rgb += vec3(0.3153915653*(3.0*z*z-1.0)) * fetchSh(splatIdx, 5);
            if (u_shCoeffCount > 6) rgb += vec3(-1.0925484306*x*z) * fetchSh(splatIdx, 6);
            if (u_shCoeffCount > 7) rgb += vec3(0.5462742153*(x*x-y*y)) * fetchSh(splatIdx, 7);
        }
        if (u_shDegree >= 3) {
            if (u_shCoeffCount > 8)  rgb += vec3(-0.5900435899*y*(3.0*x*x-y*y)) * fetchSh(splatIdx, 8);
            if (u_shCoeffCount > 9)  rgb += vec3(2.8906114426*x*y*z) * fetchSh(splatIdx, 9);
            if (u_shCoeffCount > 10) rgb += vec3(-0.4570457995*y*(5.0*z*z-1.0)) * fetchSh(splatIdx, 10);
            if (u_shCoeffCount > 11) rgb += vec3(0.3731763326*z*(5.0*z*z-3.0)) * fetchSh(splatIdx, 11);
            if (u_shCoeffCount > 12) rgb += vec3(-0.4570457995*x*(5.0*z*z-1.0)) * fetchSh(splatIdx, 12);
            if (u_shCoeffCount > 13) rgb += vec3(1.4453057213*z*(x*x-y*y)) * fetchSh(splatIdx, 13);
            if (u_shCoeffCount > 14) rgb += vec3(-0.5900435899*x*(x*x-3.0*y*y)) * fetchSh(splatIdx, 14);
        }
        vColor.rgb = clamp(rgb, 0.0, 1.0);
    }

    vPos2 = position.xy;   /* local quad coordinate for fragment Gaussian */
}
`;

const FRAGMENT_SHADER = /* glsl */`
precision highp float;

uniform float u_brightness;   // [-1, 1]
uniform float u_contrast;     // [0, 2], default 1
uniform float u_saturation;   // [0, 2], default 1
uniform float u_temperature;  // [-1, 1], negative=cool/blue, positive=warm/yellow
uniform float u_hueShift;     // [0, 2π]

in vec4 vColor;
in vec2 vPos2;

out vec4 fragColor;

void main() {
    float A = -dot(vPos2, vPos2);
    if (A < -4.0) discard;

    vec3 rgb = vColor.rgb;

    /* ── brightness ── */
    rgb += u_brightness;

    /* ── contrast (pivot at mid-gray 0.5) ── */
    rgb = (rgb - 0.5) * u_contrast + 0.5;

    /* ── color temperature (red/blue channel shift) ── */
    rgb.r += u_temperature * 0.15;
    rgb.b -= u_temperature * 0.15;

    /* ── saturation (luminance-preserving) ── */
    float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    rgb = mix(vec3(lum), rgb, u_saturation);

    /* ── hue rotation (YIQ color space) ── */
    if (abs(u_hueShift) > 0.001) {
        float cosH = cos(u_hueShift), sinH = sin(u_hueShift);
        mat3 hueRot = mat3(
            0.299+0.701*cosH+0.168*sinH, 0.587-0.587*cosH+0.330*sinH, 0.114-0.114*cosH-0.497*sinH,
            0.299-0.299*cosH-0.328*sinH, 0.587+0.413*cosH+0.035*sinH, 0.114-0.114*cosH+0.292*sinH,
            0.299-0.300*cosH+1.250*sinH, 0.587-0.588*cosH-1.050*sinH, 0.114+0.886*cosH-0.203*sinH
        );
        rgb = hueRot * rgb;
    }

    rgb = clamp(rgb, 0.0, 1.0);

    float alpha = vColor.a * exp(A);
    fragColor   = vec4(alpha * rgb, alpha);
}
`;

/* ──────────────────────────────────────────────────────────────────────────── */

const TEX_W = 1024;   // fallback texture width

export class SplatRenderer {
    constructor(renderer, camera, scene) {
        this.renderer  = renderer;
        this.camera    = camera;
        this.scene     = scene;

        this.numSplats = 0;
        this.splatScale = 1.0;

        this._mesh         = null;
        this._dataTex      = null;   // RGBA32F, 3 texels per splat
        this._idxTex       = null;   // R32F,    1 texel per splat
        this._shTex        = null;   // RGBA32F, nCoeff texels per splat
        this._centersF32   = null;   // Float32Array of xyz (cpu-side for sorting)
        this._radiusF32    = null;   // Float32Array of conservative world radii
        this._shCoeffCount = 0;
        this._shDegree     = 0;
        this._maxVisibleSplats = 4000000;
        this._minScreenPxCull  = 0.05;
        this._texW = Math.max(TEX_W, Math.min((renderer.capabilities?.maxTextureSize || TEX_W), 8192));

        this._sortWorker   = null;
        this._sortPending  = false;
        this._sortNeeded   = false;  // force re-sort on next requestSort()
        this._lastSortMs   = 0;      // measured sort time for adaptive throttle
        this._lastCamPos   = new THREE.Vector3(Infinity, Infinity, Infinity);
        this._lastCamFwd   = new THREE.Vector3(0, 0, -1);
        this._tmpFwd       = new THREE.Vector3();   // reused in requestSort(), no GC
        // Ping-pong sort buffers: worker owns these during sort, _centersF32/_radiusF32
        // stay on the main thread so appendChunk() can always write to them safely.
        this._sortCentersBuf = null;  // Float32Array reused across sort calls
        this._sortRadiiBuf   = null;

        this._initSortWorker();
    }

    /* ── sort worker ──────────────────────────────────────────────────────── */

    _initSortWorker() {
        const url = new URL('./splat_sort_worker.js', import.meta.url).href;
        this._sortWorker = new Worker(url);
        this._sortWorker.onmessage = (e) => {
            const { type, indices, sortTime, centers, radii } = e.data;
            if (type !== 'sorted') return;
            // Reclaim ping-pong sort buffers (main thread _centersF32/_radiusF32 are untouched)
            if (centers) this._sortCentersBuf = new Float32Array(centers);
            if (radii)   this._sortRadiiBuf   = new Float32Array(radii);
            this._sortPending = false;
            this._lastSortMs  = sortTime;
            // upload sorted index texture
            const idxF32 = new Float32Array(indices);
            if (this._idxTex && idxF32.length <= this._idxTex.image.data.length) {
                this._idxTex.image.data.set(idxF32);
                this._idxTex.needsUpdate = true;
                if (this._mesh) this._mesh.geometry.instanceCount = idxF32.length;
            }
        };
    }

    /* ── chunk ingestion (called on every parsed chunk) ──────────────────── */

    appendChunk(texDataBuf, centersBuf, count, offset, shDataBuf = null, shCoeffCount = 0, radiiBuf = null) {
        const needed = offset + count;
        if (shCoeffCount > 0 && this._shCoeffCount === 0) this._shCoeffCount = shCoeffCount;

        // grow textures if necessary
        if (!this._dataTex || (this._dataTex.image.width * this._dataTex.image.height) < needed * 3) {
            this._growDataTex(needed);
        }
        if (!this._idxTex || (this._idxTex.image.width * this._idxTex.image.height) < needed) {
            this._growIdxTex(needed);
        }
        if (this._shCoeffCount > 0 && (!this._shTex || (this._shTex.image.width * this._shTex.image.height) < needed * this._shCoeffCount)) {
            this._growShTex(needed);
        }
        if (!this._centersF32 || this._centersF32.length < needed * 3) {
            const nb = new Float32Array(Math.max(needed * 3, 1024 * 3));
            if (this._centersF32) nb.set(this._centersF32);
            this._centersF32 = nb;
        }
        if (!this._radiusF32 || this._radiusF32.length < needed) {
            const rb = new Float32Array(Math.max(needed, 1024));
            if (this._radiusF32) rb.set(this._radiusF32);
            this._radiusF32 = rb;
        }

        // copy chunk into data texture flat array
        this._dataTex.image.data.set(new Float32Array(texDataBuf), offset * 12);
        this._dataTex.needsUpdate = true;
        if (this._shTex && shDataBuf) {
            this._shTex.image.data.set(new Float32Array(shDataBuf), offset * this._shCoeffCount * 4);
            this._shTex.needsUpdate = true;
        }
        if (radiiBuf) {
            this._radiusF32.set(new Float32Array(radiiBuf), offset);
        }

        // copy chunk centers
        this._centersF32.set(new Float32Array(centersBuf), offset * 3);

        this.numSplats = needed;

        // initialise identity index order for new splats
        const idxData = this._idxTex.image.data;
        for (let i = offset; i < needed; i++) idxData[i] = i;
        this._idxTex.needsUpdate = true;

        // build (or update) instanced mesh
        if (!this._mesh) {
            this._buildMesh();
        } else {
            this._mesh.geometry.instanceCount = this.numSplats;
            this._mesh.material.uniforms.u_shCoeffCount.value = this._shCoeffCount;
            this._mesh.material.uniforms.u_shDegree.value = this._shDegree;
        }

        this._sortNeeded = true;
    }

    /* ── texture helpers ──────────────────────────────────────────────────── */

    _growDataTex(minSplats) {
        // capacity in pixels = 3 texels per splat, padded
        const minPx = minSplats * 3;
        const oldPx = this._dataTex ? this._dataTex.image.width * this._dataTex.image.height : 0;
        const cap   = Math.max(minPx, Math.ceil(oldPx * 1.5), TEX_W);
        const h     = Math.ceil(cap / this._texW);

        const data = new Float32Array(this._texW * h * 4);
        if (this._dataTex) {
            data.set(this._dataTex.image.data);
            this._dataTex.dispose();
        }

        this._dataTex = new THREE.DataTexture(data, this._texW, h, THREE.RGBAFormat, THREE.FloatType);
        this._dataTex.minFilter = THREE.NearestFilter;
        this._dataTex.magFilter = THREE.NearestFilter;
        this._dataTex.needsUpdate = true;

        if (this._mesh) this._mesh.material.uniforms.u_texture.value = this._dataTex;
    }

    _growIdxTex(minSplats) {
        const oldN = this._idxTex ? this._idxTex.image.width * this._idxTex.image.height : 0;
        const cap  = Math.max(minSplats, Math.ceil(oldN * 1.5), TEX_W);
        const h    = Math.ceil(cap / this._texW);

        const data = new Float32Array(this._texW * h);
        if (this._idxTex) {
            data.set(this._idxTex.image.data);
            this._idxTex.dispose();
        }

        this._idxTex = new THREE.DataTexture(data, this._texW, h, THREE.RedFormat, THREE.FloatType);
        this._idxTex.minFilter = THREE.NearestFilter;
        this._idxTex.magFilter = THREE.NearestFilter;
        this._idxTex.needsUpdate = true;

        if (this._mesh) this._mesh.material.uniforms.u_index.value = this._idxTex;
    }

    _growShTex(minSplats) {
        if (this._shCoeffCount <= 0) return;
        const minPx = minSplats * this._shCoeffCount;
        const oldPx = this._shTex ? this._shTex.image.width * this._shTex.image.height : 0;
        const cap = Math.max(minPx, Math.ceil(oldPx * 1.5), this._texW);
        const h = Math.ceil(cap / this._texW);
        const data = new Float32Array(this._texW * h * 4);
        if (this._shTex) {
            data.set(this._shTex.image.data);
            this._shTex.dispose();
        }
        this._shTex = new THREE.DataTexture(data, this._texW, h, THREE.RGBAFormat, THREE.FloatType);
        this._shTex.minFilter = THREE.NearestFilter;
        this._shTex.magFilter = THREE.NearestFilter;
        this._shTex.needsUpdate = true;
        if (this._mesh) this._mesh.material.uniforms.u_shTex.value = this._shTex;
    }

    /* ── mesh construction ────────────────────────────────────────────────── */

    _buildMesh() {
        // quad positions in [-2, 2]: two triangles, 6 vertices
        const geo = new THREE.InstancedBufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
            -2,-2, 0,   2,-2, 0,   2, 2, 0,
            -2,-2, 0,   2, 2, 0,  -2, 2, 0,
        ]), 3));
        geo.instanceCount = this.numSplats;

        const vp = this.renderer.getSize(new THREE.Vector2());
        const mat = new THREE.RawShaderMaterial({
            vertexShader:   VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            glslVersion:    THREE.GLSL3,
            uniforms: {
                u_texture:   { value: this._dataTex },
                u_index:     { value: this._idxTex  },
                u_shTex:     { value: this._shTex || this._dataTex },
                u_viewport:  { value: vp             },
                u_view:      { value: this.camera.matrixWorldInverse },
                u_proj:      { value: this.camera.projectionMatrix   },
                u_splatScale:{ value: this.splatScale },
                u_camPos:    { value: this.camera.position },
                u_shCoeffCount: { value: this._shCoeffCount },
                u_shDegree:  { value: this._shDegree },
                u_brightness:  { value: 0.0 },
                u_contrast:    { value: 1.0 },
                u_saturation:  { value: 1.0 },
                u_temperature: { value: 0.0 },
                u_hueShift:    { value: 0.0 },
            },
            blending:          THREE.CustomBlending,
            blendEquation:     THREE.AddEquation,
            blendSrc:          THREE.OneFactor,
            blendDst:          THREE.OneMinusSrcAlphaFactor,
            blendEquationAlpha:THREE.AddEquation,
            blendSrcAlpha:     THREE.OneFactor,
            blendDstAlpha:     THREE.OneMinusSrcAlphaFactor,
            depthTest:   true,
            depthWrite:  false,
            transparent: true,
        });

        this._mesh = new THREE.Mesh(geo, mat);
        this._mesh.frustumCulled = false;
        this._mesh.renderOrder   = 1;         // render after opaque objects
        this.scene.add(this._mesh);
    }

    /* ── sort request ─────────────────────────────────────────────────────── */

    requestSort() {
        if (this._sortPending || !this._centersF32 || this.numSplats === 0) return;

        const cam = this.camera;
        const cp  = cam.position;
        const fwd = this._tmpFwd;
        cam.getWorldDirection(fwd);
        const focalX = cam.projectionMatrix.elements[0] * this._mesh.material.uniforms.u_viewport.value.x * 0.5;
        const focalY = cam.projectionMatrix.elements[5] * this._mesh.material.uniforms.u_viewport.value.y * 0.5;
        const focal = Math.max(Math.abs(focalX), Math.abs(focalY));

        // Skip if camera and view direction barely changed
        if (!this._sortNeeded) {
            const dPos = cp.distanceTo(this._lastCamPos);
            const dFwd = fwd.dot(this._lastCamFwd);
            if (dPos < 0.02 && dFwd > 0.9999) return;
        }
        this._sortNeeded = false;
        this._lastCamPos.copy(cp);
        this._lastCamFwd.copy(fwd);

        // Ping-pong: copy current centers/radii into dedicated sort buffers,
        // then TRANSFER those buffers (zero-copy handoff to worker).
        // _centersF32/_radiusF32 stay intact on main thread — appendChunk() is safe.
        const N = this.numSplats;
        if (!this._sortCentersBuf || this._sortCentersBuf.length < N * 3) {
            this._sortCentersBuf = new Float32Array(N * 3);
        }
        this._sortCentersBuf.set(this._centersF32.subarray(0, N * 3));

        let radiiBuffer = null;
        if (this._radiusF32) {
            if (!this._sortRadiiBuf || this._sortRadiiBuf.length < N) {
                this._sortRadiiBuf = new Float32Array(N);
            }
            this._sortRadiiBuf.set(this._radiusF32.subarray(0, N));
            radiiBuffer = this._sortRadiiBuf.buffer;
            this._sortRadiiBuf = null;   // transferred
        }
        const centersBuffer = this._sortCentersBuf.buffer;
        this._sortCentersBuf = null;     // transferred

        const transferList = [centersBuffer];
        if (radiiBuffer) transferList.push(radiiBuffer);
        this._sortPending = true;
        this._sortWorker.postMessage(
            { type: 'sort',
              centers: centersBuffer,
              radii: radiiBuffer,
              totalCount: N,
              camPos: [cp.x, cp.y, cp.z],
              camFwd: [fwd.x, fwd.y, fwd.z],
              focal: focal,
              maxVisible: this._maxVisibleSplats,
              minPx: this._minScreenPxCull,
              farCull: 120000.0
            },
            transferList
        );
    }

    /* ── API ──────────────────────────────────────────────────────────────── */

    setSplatScale(s) {
        this.splatScale = s;
        if (this._mesh) this._mesh.material.uniforms.u_splatScale.value = s;
    }

    onResize(w, h) {
        if (this._mesh) this._mesh.material.uniforms.u_viewport.value.set(w, h);
    }

    updateFrameUniforms() {
        if (!this._mesh) return;
        const u = this._mesh.material.uniforms;
        u.u_view.value = this.camera.matrixWorldInverse;
        u.u_proj.value = this.camera.projectionMatrix;
        u.u_camPos.value.copy(this.camera.position);
    }

    setShDegree(level) {
        this._shDegree = Math.max(0, Math.min(3, level | 0));
        if (this._mesh) this._mesh.material.uniforms.u_shDegree.value = this._shDegree;
    }

    /* ── Color adjustment API ── */
    setColorAdjust(key, value) {
        if (!this._mesh) return;
        const u = this._mesh.material.uniforms;
        if (u['u_' + key]) u['u_' + key].value = value;
    }

    getColorDefaults() {
        return { brightness: 0, contrast: 1, saturation: 1, temperature: 0, hueShift: 0 };
    }

    resetColorAdjust() {
        const d = this.getColorDefaults();
        for (const [k, v] of Object.entries(d)) this.setColorAdjust(k, v);
    }

    dispose() {
        if (this._mesh) {
            this.scene.remove(this._mesh);
            this._mesh.geometry.dispose();
            this._mesh.material.dispose();
            this._mesh = null;
        }
        if (this._dataTex) { this._dataTex.dispose(); this._dataTex = null; }
        if (this._idxTex)  { this._idxTex.dispose();  this._idxTex  = null; }
        if (this._shTex)   { this._shTex.dispose();   this._shTex   = null; }
        if (this._sortWorker) { this._sortWorker.terminate(); this._sortWorker = null; }
        this._centersF32 = null;
        this._radiusF32 = null;
        this.numSplats = 0;
    }
}
