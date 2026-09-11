// GPU LiDAR-camera fusion viewport. The camera image is drawn as a full-screen
// textured quad and the point cloud is projected onto it entirely in a WebGL2
// vertex shader (pinhole / fisheye_opencv / ftheta), mirroring the CPU math in
// model/fusion_model.py::_render so the offline viewer can render many cameras
// on the GPU instead of re-projecting/encoding per frame on the CPU.
(function(){
'use strict';

const IMG_VS=`#version 300 es
in vec2 aPos; in vec2 aUV; out vec2 vUV;
void main(){ vUV=aUV; gl_Position=vec4(aPos,0.0,1.0); }`;
const IMG_FS=`#version 300 es
precision highp float; in vec2 vUV; uniform sampler2D uTex; out vec4 o;
void main(){ o=texture(uTex,vUV); }`;

// Point projection. uModel: 0=pinhole(+8 distort) 1=fisheye_opencv(4) 2=ftheta poly.
const PTS_VS=`#version 300 es
in vec4 aPos;                 // x,y,z,intensity (LiDAR frame)
uniform mat4 uT;              // LiDAR -> camera-optical
uniform vec4 uK;             // fx,fy,cx,cy
uniform vec2 uImg;           // image width,height (px)
uniform int uModel;
uniform float uD[8];         // pinhole k1,k2,p1,p2,k3,k4,k5,k6 or fisheye k1..k4
uniform float uPoly[6];      // ftheta: c0 + c1*th + c2*th^2 + ...
uniform int uColorMode;      // 0 intensity, 1 height, 2 flat
uniform float uIScale;       // intensity multiplier (255 if normalized else 1)
uniform vec2 uZ;             // z min,max for height mode
uniform float uPointSize;
out vec3 vColor;
vec3 jet(float val){
  float v=clamp(val,0.0,255.0);
  float b=clamp(255.0-max(v-33.0,0.0)*7.727,0.0,255.0);
  float g=v<=33.0? v*7.727 : (v<=100.0? 255.0 : 255.0-(v-100.0)*7.727/4.697);
  float r=v<=66.0? 0.0 : (v<=100.0? (v-67.0)*7.727 : 255.0);
  return vec3(clamp(r,0.0,255.0),clamp(g,0.0,255.0),clamp(b,0.0,255.0))/255.0;
}
void main(){
  vec4 op=uT*vec4(aPos.xyz,1.0);
  if(op.z<=0.0){ gl_Position=vec4(2.0,2.0,2.0,1.0); gl_PointSize=0.0; return; }
  vec2 pix;
  if(uModel==2){                     // ftheta polynomial (uses cx,cy only)
    float r=length(op.xy);
    float th=atan(r,op.z);
    float rad=uPoly[0]+th*(uPoly[1]+th*(uPoly[2]+th*(uPoly[3]+th*(uPoly[4]+th*uPoly[5]))));
    float s=r>1e-9? rad/r : 0.0;
    pix=vec2(uK.z+s*op.x, uK.w+s*op.y);
  }else if(uModel==1){               // fisheye equidistant (opencv 4-param)
    float r=length(op.xy);
    float th=atan(r,op.z);
    float t2=th*th;
    float thd=th*(1.0+t2*(uD[0]+t2*(uD[1]+t2*(uD[2]+t2*uD[3]))));
    float s=r>1e-9? thd/r : 0.0;
    pix=vec2(uK.x*s*op.x+uK.z, uK.y*s*op.y+uK.w);
  }else{                             // pinhole + radial/tangential distortion
    vec2 xy=op.xy/op.z;
    float r2=dot(xy,xy);
    float radial=(1.0+r2*(uD[0]+r2*(uD[1]+r2*uD[4])))/(1.0+r2*(uD[5]+r2*(uD[6]+r2*uD[7])));
    vec2 xyd;
    xyd.x=xy.x*radial+2.0*uD[2]*xy.x*xy.y+uD[3]*(r2+2.0*xy.x*xy.x);
    xyd.y=xy.y*radial+uD[2]*(r2+2.0*xy.y*xy.y)+2.0*uD[3]*xy.x*xy.y;
    pix=vec2(uK.x*xyd.x+uK.z, uK.y*xyd.y+uK.w);
  }
  vec2 ndc=vec2(pix.x/uImg.x*2.0-1.0, 1.0-pix.y/uImg.y*2.0);
  gl_Position=vec4(ndc,0.0,1.0);
  gl_PointSize=uPointSize;
  if(uColorMode==2) vColor=vec3(0.0,1.0,0.0);
  else if(uColorMode==1){ float rng=max(uZ.y-uZ.x,1e-6); vColor=jet((aPos.z-uZ.x)/rng*255.0); }
  else vColor=jet(clamp(aPos.w*uIScale,0.0,255.0));
}`;
const PTS_FS=`#version 300 es
precision highp float; in vec3 vColor; out vec4 o;
void main(){ o=vec4(vColor,1.0); }`;

function compile(gl,type,src){
  const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)||'shader compile failed');
  return s;
}
function link(gl,vs,fs){
  const p=gl.createProgram();
  gl.attachShader(p,compile(gl,gl.VERTEX_SHADER,vs));
  gl.attachShader(p,compile(gl,gl.FRAGMENT_SHADER,fs));
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)||'program link failed');
  return p;
}

const MAX_CANVAS=1600;  // cap per-viewport drawing buffer (aspect kept)

class FusionView{
  constructor(canvas){
    const gl=canvas.getContext('webgl2',{antialias:false,alpha:false,preserveDrawingBuffer:false});
    if(!gl) throw new Error('WebGL2 not available');
    this.canvas=canvas; this.gl=gl;
    this.imgProg=link(gl,IMG_VS,IMG_FS);
    this.ptsProg=link(gl,PTS_VS,PTS_FS);
    // Full-screen quad (clip xy, uv). UV.v is flipped so the image's top row
    // maps to the top of the screen, matching the point projection's NDC (which
    // uses ndc.y = 1 - pix.y/H), keeping image and projected points aligned.
    this.quad=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([
      -1,-1, 0,1,  1,-1, 1,1,  -1,1, 0,0,
      -1, 1, 0,0,  1,-1, 1,1,   1,1, 1,0]),gl.STATIC_DRAW);
    this.tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,this.tex);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    this.vbo=gl.createBuffer();
    this.count=0; this.imgW=1; this.imgH=1; this.hasTex=false;
    this.colorMode=0; this.iScale=1; this.zMin=0; this.zMax=1; this.pointSize=2;
    this.cfg=null;
    this.texW=0; this.texH=0;
    // Panel size is read once and refreshed by ResizeObserver: querying
    // clientWidth per frame forces a synchronous layout in every viewport.
    this.panelW=0; this.panelH=0;
    const body=canvas.parentElement;
    if(body&&typeof ResizeObserver==='function'){
      this._ro=new ResizeObserver(()=>{this.panelW=body.clientWidth;this.panelH=body.clientHeight;});
      this._ro.observe(body);
      this.panelW=body.clientWidth; this.panelH=body.clientHeight;
    }
    // Attrib/uniform locations are string lookups into the driver; resolving
    // them every frame costs more than the draw calls themselves.
    this.locImg={aPos:gl.getAttribLocation(this.imgProg,'aPos'),aUV:gl.getAttribLocation(this.imgProg,'aUV'),
                 uTex:gl.getUniformLocation(this.imgProg,'uTex')};
    const p=this.ptsProg;
    this.locPts={aPos:gl.getAttribLocation(p,'aPos'),uT:gl.getUniformLocation(p,'uT'),
                 uK:gl.getUniformLocation(p,'uK'),uImg:gl.getUniformLocation(p,'uImg'),
                 uModel:gl.getUniformLocation(p,'uModel'),uD:gl.getUniformLocation(p,'uD'),
                 uPoly:gl.getUniformLocation(p,'uPoly'),uColorMode:gl.getUniformLocation(p,'uColorMode'),
                 uIScale:gl.getUniformLocation(p,'uIScale'),uZ:gl.getUniformLocation(p,'uZ'),
                 uPointSize:gl.getUniformLocation(p,'uPointSize')};
  }
  setCalibration(cfg){
    // cfg: {T (row-major 16 or 4x4), K:[fx,fy,cx,cy], model, distortion[8], ftheta[6], width, height}
    const flat=Array.isArray(cfg.T[0])? [].concat.apply([],cfg.T) : cfg.T;
    const col=new Float32Array(16);              // row-major -> column-major
    for(let r=0;r<4;r++)for(let c=0;c<4;c++)col[c*4+r]=flat[r*4+c];
    const d=(cfg.distortion||[]).slice(0,8); while(d.length<8)d.push(0);
    const poly=(cfg.ftheta||[]).slice(0,6); while(poly.length<6)poly.push(0);
    this.cfg={T:col,K:new Float32Array(cfg.K),model:cfg.model|0,d:new Float32Array(d),
              poly:new Float32Array(poly),cw:cfg.width||this.imgW,ch:cfg.height||this.imgH};
  }
  // Size the drawing buffer to how large this panel is actually shown (not the
  // full image), so many small panels don't each render at full resolution —
  // total GPU pixels stay ~constant regardless of panel count. Aspect follows
  // the image so the quad isn't distorted.
  _fitToPanel(){
    const cv=this.canvas,body=cv.parentElement,dpr=window.devicePixelRatio||1;
    let bw=this.panelW,bh=this.panelH;
    if(bw<1||bh<1){bw=body?body.clientWidth:0;bh=body?body.clientHeight:0;this.panelW=bw;this.panelH=bh;}
    if(bw<1||bh<1){bw=this.imgW;bh=this.imgH;}
    const fit=Math.min(bw/this.imgW,bh/this.imgH)||1;
    let cw=this.imgW*fit*dpr,chh=this.imgH*fit*dpr;
    const cap=Math.min(1,MAX_CANVAS/Math.max(cw,chh,1));
    cw=Math.max(1,Math.round(cw*cap));chh=Math.max(1,Math.round(chh*cap));
    if(cv.width!==cw||cv.height!==chh){cv.width=cw;cv.height=chh;}
  }
  setImage(bitmap){
    const gl=this.gl;
    this.imgW=bitmap.width; this.imgH=bitmap.height;
    this._fitToPanel();
    gl.bindTexture(gl.TEXTURE_2D,this.tex);
    // Reallocating texture storage every frame is far costlier than overwriting
    // it, and playback feeds a steady stream of same-sized frames.
    if(this.texW===bitmap.width&&this.texH===bitmap.height){
      gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGB,gl.UNSIGNED_BYTE,bitmap);
    }else{
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,bitmap);
      this.texW=bitmap.width; this.texH=bitmap.height;
    }
    this.hasTex=true;
  }
  setPoints(buf,count,stats){
    const gl=this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER,this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER,buf,gl.DYNAMIC_DRAW);
    this.count=count;
    if(stats){this.iScale=stats.iScale;this.zMin=stats.zMin;this.zMax=stats.zMax;}
  }
  setColorMode(mode){this.colorMode=mode==='height'?1:(mode==='flat'?2:0);}
  setPointSize(px){this.pointSize=Math.max(1,+px||1);}
  render(){
    const gl=this.gl;
    if(!this.hasTex){return;}
    gl.viewport(0,0,this.canvas.width,this.canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0.04,0.05,0.07,1); gl.clear(gl.COLOR_BUFFER_BIT);
    // image
    gl.useProgram(this.imgProg);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
    const li=this.locImg;
    gl.enableVertexAttribArray(li.aPos); gl.vertexAttribPointer(li.aPos,2,gl.FLOAT,false,16,0);
    gl.enableVertexAttribArray(li.aUV); gl.vertexAttribPointer(li.aUV,2,gl.FLOAT,false,16,8);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,this.tex);
    gl.uniform1i(li.uTex,0);
    gl.drawArrays(gl.TRIANGLES,0,6);
    // points
    if(this.count&&this.cfg){
      const p=this.ptsProg,c=this.cfg,lp=this.locPts;
      gl.useProgram(p);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.vbo);
      gl.enableVertexAttribArray(lp.aPos); gl.vertexAttribPointer(lp.aPos,4,gl.FLOAT,false,16,0);
      gl.uniformMatrix4fv(lp.uT,false,c.T);
      gl.uniform4fv(lp.uK,c.K);
      gl.uniform2f(lp.uImg,c.cw,c.ch);
      gl.uniform1i(lp.uModel,c.model);
      gl.uniform1fv(lp.uD,c.d);
      gl.uniform1fv(lp.uPoly,c.poly);
      gl.uniform1i(lp.uColorMode,this.colorMode);
      gl.uniform1f(lp.uIScale,this.iScale);
      gl.uniform2f(lp.uZ,this.zMin,this.zMax);
      gl.uniform1f(lp.uPointSize,this.pointSize);
      gl.drawArrays(gl.POINTS,0,this.count);
    }
  }
  dispose(){
    const gl=this.gl;
    try{this._ro&&this._ro.disconnect();}catch(_e){}
    try{gl.deleteBuffer(this.quad);gl.deleteBuffer(this.vbo);gl.deleteTexture(this.tex);
        gl.deleteProgram(this.imgProg);gl.deleteProgram(this.ptsProg);
        gl.getExtension('WEBGL_lose_context')?.loseContext();}catch(_e){}
  }
}

// Compute intensity scale (match backend: normalize if max<=1) and z range once
// per frame so every camera viewport shares the same coloring reference.
FusionView.computeStats=function(buf,count){
  let iMax=0,zMin=Infinity,zMax=-Infinity;
  for(let k=0;k<count;k++){
    const z=buf[k*4+2],i=buf[k*4+3];
    if(i>iMax)iMax=i; if(z<zMin)zMin=z; if(z>zMax)zMax=z;
  }
  if(!isFinite(zMin)){zMin=0;zMax=1;}
  return {iScale:iMax<=1.5?255:1,zMin,zMax};
};

window.FusionView=FusionView;
})();
