import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const canvas=document.getElementById('cv');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(devicePixelRatio);renderer.setClearColor(0x0a0c12);
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(60,1,0.01,10000);
// 初始视口常量：x 朝前，俯角 ≈10°。修改这里后 resetCamera 与首帧加载都跳同步。
const INIT_CAM_POS=[-20,0,8], INIT_CAM_TARGET=[30,0,0];
camera.position.set(...INIT_CAM_POS);camera.up.set(0,0,1);
const controls=new OrbitControls(camera,canvas);
controls.target.set(...INIT_CAM_TARGET);
controls.enableDamping=true;controls.dampingFactor=0.08;controls.screenSpacePanning=true;
// ── Coordinate axes: solid cylinder shafts + cone heads (linewidth>1 is a no-op in WebGL) ─
(function(){
  const L=2.0;            // shaft length
  const R=0.045;          // shaft radius (粗细)
  const headLen=0.32;     // cone head length
  const headR=0.12;       // cone head radius
  const segs=24;          // 圆柱/圆锥分段数
  const axes=[
    {dir:new THREE.Vector3(1,0,0),color:0xef4444},  // X red
    {dir:new THREE.Vector3(0,1,0),color:0x22c55e},  // Y green
    {dir:new THREE.Vector3(0,0,1),color:0x3b82f6},  // Z blue
  ];
  const upY=new THREE.Vector3(0,1,0);
  axes.forEach(({dir,color})=>{
    const mat=new THREE.MeshBasicMaterial({color});
    // shaft：默认沿 Y 轴，从 (0,0,0) 起；移动到 (0,L/2,0) 让一端在原点
    const shaftGeo=new THREE.CylinderGeometry(R,R,L,segs,1,false);
    shaftGeo.translate(0,L/2,0);
    const shaft=new THREE.Mesh(shaftGeo,mat);
    // head：圆锥默认沿 Y 轴，底面在 y=0，顶点在 y=headLen
    const headGeo=new THREE.ConeGeometry(headR,headLen,segs);
    headGeo.translate(0,L+headLen/2,0);
    const head=new THREE.Mesh(headGeo,mat);
    const grp=new THREE.Group();grp.add(shaft);grp.add(head);
    // 把默认的 +Y 朝向旋转到目标方向
    grp.quaternion.setFromUnitVectors(upY,dir.clone().normalize());
    scene.add(grp);
  });
  // 原点小球作为视觉锚点
  const originGeo=new THREE.SphereGeometry(R*1.6,16,12);
  const originMat=new THREE.MeshBasicMaterial({color:0xffffff});
  scene.add(new THREE.Mesh(originGeo,originMat));
})();
let grid=null;
function rebuildGrid(size,divisions){
  if(grid){scene.remove(grid);grid.geometry.dispose();grid.material.dispose();}
  grid=new THREE.GridHelper(size,divisions,0x1e2235,0x1e2235);
  grid.rotation.x=Math.PI/2;
  scene.add(grid);
}
rebuildGrid(200,200);
window._grid={
  setSize(s,d){rebuildGrid(s,d);},
  setVisible(v){if(grid)grid.visible=!!v;},
};
const wrap=document.getElementById('canvas-wrap');
const lc=document.getElementById('lasso-canvas');
const lctx=lc.getContext('2d');
function resize(){const w=wrap.clientWidth,h=wrap.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();lc.width=w;lc.height=h;}
new ResizeObserver(resize).observe(wrap);resize();

// ── Free-fly controls (custom Z-up, RMB to look) ─────────────────────────
let _freeMode=false;
const _flyKeys={w:false,a:false,s:false,d:false,q:false,e:false,shift:false};
let _flySpeed=8;          // units per second
let _flyYaw=0,_flyPitch=0;     // radians; yaw around world +Z, pitch around camera right
const _flyClock=new THREE.Clock();
const _MOUSE_SENS=0.0025;
const _PITCH_LIMIT=Math.PI/2-0.01;

function _flyApplyOrientation(){
  // forward direction from yaw/pitch in Z-up, +X-forward world
  const cp=Math.cos(_flyPitch), sp=Math.sin(_flyPitch);
  const cy=Math.cos(_flyYaw),  sy=Math.sin(_flyYaw);
  const fwd=new THREE.Vector3(cp*cy, cp*sy, sp);
  camera.up.set(0,0,1);
  camera.lookAt(camera.position.clone().add(fwd));
}
function _flyInitFromCamera(){
  // derive yaw/pitch from current camera forward
  const fwd=new THREE.Vector3();camera.getWorldDirection(fwd);
  _flyPitch=Math.asin(Math.max(-1,Math.min(1,fwd.z)));
  _flyYaw=Math.atan2(fwd.y,fwd.x);
  _flyApplyOrientation();
}

// rotate while right mouse button is held — no PointerLock (avoids 100ms acquisition lag + center-warp jump)
let _flyRotating=false, _flyLastX=0, _flyLastY=0;
function _onMouseMove(e){
  if(!_freeMode||!_flyRotating)return;
  // prefer movementX/Y; fall back to manual delta from previous client position
  let dx=e.movementX, dy=e.movementY;
  if(dx===undefined||dy===undefined){ dx=e.clientX-_flyLastX; dy=e.clientY-_flyLastY; }
  _flyLastX=e.clientX; _flyLastY=e.clientY;
  _flyYaw   -= dx*_MOUSE_SENS;
  _flyPitch -= dy*_MOUSE_SENS;
  if(_flyPitch> _PITCH_LIMIT)_flyPitch= _PITCH_LIMIT;
  if(_flyPitch<-_PITCH_LIMIT)_flyPitch=-_PITCH_LIMIT;
  _flyApplyOrientation();
}
document.addEventListener('mousemove',_onMouseMove);
canvas.addEventListener('mousedown',e=>{
  if(!_freeMode)return;
  if(e.button===2){
    e.preventDefault();
    _flyRotating=true; _flyLastX=e.clientX; _flyLastY=e.clientY;
    canvas.style.cursor='none';
  }
});
window.addEventListener('mouseup',e=>{
  if(!_freeMode)return;
  if(e.button===2 && _flyRotating){
    _flyRotating=false;
    canvas.style.cursor='default';
  }
});
canvas.addEventListener('contextmenu',e=>{ if(_freeMode)e.preventDefault(); });

function _setFreeMode(on){
  if(on===_freeMode)return;
  _freeMode=on;
  if(on){
    if(typeof _stopPlay==='function')_stopPlay();
    controls.enabled=false;
    document.getElementById('free-hint').style.display='block';
    _flyInitFromCamera();
    // do NOT lock pointer here — only lock while right mouse is held
  } else {
    document.getElementById('free-hint').style.display='none';
    _flyRotating=false; canvas.style.cursor='default';
    // resync orbit target a bit ahead of camera so OrbitControls feels natural
    const fwd=new THREE.Vector3();camera.getWorldDirection(fwd);
    controls.target.copy(camera.position).add(fwd.multiplyScalar(10));
    controls.enabled=true;
    controls.update();
  }
  const fb=document.getElementById('view-free');if(fb)fb.classList.toggle('active',on);
}
window.addEventListener('keydown',e=>{
  if(!_freeMode)return;
  const k=e.key.toLowerCase();
  if(k in _flyKeys){_flyKeys[k]=true;e.preventDefault();}
  if(e.key==='Shift'){_flyKeys.shift=true;}
});
window.addEventListener('keyup',e=>{
  const k=e.key.toLowerCase();
  if(k in _flyKeys){_flyKeys[k]=false;}
  if(e.key==='Shift'){_flyKeys.shift=false;}
});
canvas.addEventListener('wheel',e=>{
  if(!_freeMode)return;
  _flySpeed=Math.max(0.5,Math.min(200,_flySpeed*(e.deltaY<0?1.15:0.87)));
  e.preventDefault();
},{passive:false});

function _flyTick(){
  if(!_freeMode){_flyClock.getDelta();return;}
  const dt=Math.min(_flyClock.getDelta(),0.1);
  const spd=_flySpeed*(_flyKeys.shift?4:1)*dt;
  // forward/right vectors derived from camera quaternion
  const fwd=new THREE.Vector3();camera.getWorldDirection(fwd);
  const right=new THREE.Vector3().crossVectors(fwd,new THREE.Vector3(0,0,1)).normalize();
  let f=0,r=0,u=0;
  if(_flyKeys.w)f+=1; if(_flyKeys.s)f-=1;
  if(_flyKeys.d)r+=1; if(_flyKeys.a)r-=1;
  if(_flyKeys.e)u+=1; if(_flyKeys.q)u-=1;
  if(f)camera.position.addScaledVector(fwd,f*spd);
  if(r)camera.position.addScaledVector(right,r*spd);
  if(u)camera.position.z+=u*spd;
}

function animate(){requestAnimationFrame(animate);_flyTick();if(!_freeMode)controls.update();renderer.render(scene,camera);}
animate();

let pointCloud=null,rawPoints=[],rawFields=[],ptSize=1.5,colorMode='height';
let flipX=1,flipY=1,flipZ=1;
let _lockedZRange=null;  // {mn, mx} — locked height color range, null=auto per-frame
function lockZRange(mn,mx){_lockedZRange={mn,mx};document.getElementById('z-lock-btn').innerHTML='&#128274; Unlock Z';document.getElementById('z-lock-indicator').textContent='Z: '+mn.toFixed(1)+' ~ '+mx.toFixed(1);}
function unlockZRange(){_lockedZRange=null;document.getElementById('z-lock-btn').innerHTML='&#128275; Lock Z';document.getElementById('z-lock-indicator').textContent='auto';}
function toggleZLock(){
  if(_lockedZRange){unlockZRange();return;}
  // lock to current frame's range
  if(!rawFloats||!rawFloats.length)return;
  const zi=rawFields.indexOf('z'),nf=rawNfields,np=(rawFloats.length/nf)|0;
  let mn=Infinity,mx=-Infinity;
  for(let i=0;i<np;i++){const z=rawFloats[i*nf+zi];if(z<mn)mn=z;if(z>mx)mx=z;}
  lockZRange(mn,mx);
}
let filterActive=false,filterZMin=-Infinity,filterZMax=Infinity,filterMode='keep';
let displayedToRaw=null;
let selectedIndices=new Set(),selectionCloud=null,undoBuffer=null;
let lassoMode=false,eraserMode=false,eraserRadius=20;
let _lassoPts=[],_lassoDown=false,_eraserDown=false;

function clearLassoCanvas(){lctx.clearRect(0,0,lc.width,lc.height);}
function drawEraserCircle(cx,cy){clearLassoCanvas();lctx.beginPath();lctx.arc(cx,cy,eraserRadius,0,Math.PI*2);lctx.strokeStyle='rgba(251,146,60,0.85)';lctx.lineWidth=1.5;lctx.stroke();}

function projectPoints(){
  if(!pointCloud)return[];
  const pa=pointCloud.geometry.getAttribute('position');
  const n=pa.count,w=lc.width,h=lc.height;
  const out=new Array(n);const v=new THREE.Vector3();
  for(let i=0;i<n;i++){v.fromBufferAttribute(pa,i);v.project(camera);out[i]=[(v.x*0.5+0.5)*w,(-v.y*0.5+0.5)*h];}
  return out;
}
function pointInPolygon(px,py,poly){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];
    if(((yi>py)!==(yj>py))&&(px<(xj-xi)*(py-yi)/(yj-yi)+xi))inside=!inside;
  }return inside;
}
function finalizeLasso(){
  if(_lassoPts.length<3){clearLassoCanvas();return;}
  const proj=projectPoints();const ns=new Set(selectedIndices);
  proj.forEach((sp,i)=>{if(pointInPolygon(sp[0],sp[1],_lassoPts))ns.add(i);});
  selectedIndices=ns;clearLassoCanvas();rebuildSelectionCloud();
}
function applyEraserAt(cx,cy){
  const proj=projectPoints();const ns=new Set(selectedIndices);const r2=eraserRadius*eraserRadius;
  proj.forEach((sp,i)=>{const dx=sp[0]-cx,dy=sp[1]-cy;if(dx*dx+dy*dy<=r2)ns.add(i);});
  selectedIndices=ns;rebuildSelectionCloud();
}
function rebuildSelectionCloud(){
  if(selectionCloud){scene.remove(selectionCloud);selectionCloud.geometry.dispose();selectionCloud=null;}
  if(!selectedIndices.size||!pointCloud){updateSelCount();return;}
  const pa=pointCloud.geometry.getAttribute('position');
  const n=selectedIndices.size,pos=new Float32Array(n*3);let k=0;
  selectedIndices.forEach(i=>{pos[k]=pa.getX(i);pos[k+1]=pa.getY(i);pos[k+2]=pa.getZ(i);k+=3;});
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
  selectionCloud=new THREE.Points(geo,new THREE.PointsMaterial({color:0xf43f5e,size:ptSize*0.08,sizeAttenuation:true,depthTest:false}));
  scene.add(selectionCloud);updateSelCount();
}
function clearSelectionInternal(){
  selectedIndices=new Set();
  if(selectionCloud){scene.remove(selectionCloud);selectionCloud.geometry.dispose();selectionCloud=null;}
  updateSelCount();
}
function updateSelCount(){document.getElementById('sel-count').textContent=selectedIndices.size?'('+selectedIndices.size+')'  :'';}

lc.addEventListener('mousedown',e=>{
  if(e.button!==0)return;
  if(lassoMode){_lassoDown=true;_lassoPts=[[e.offsetX,e.offsetY]];clearLassoCanvas();lctx.beginPath();lctx.moveTo(e.offsetX,e.offsetY);}
  else if(eraserMode){_eraserDown=true;applyEraserAt(e.offsetX,e.offsetY);drawEraserCircle(e.offsetX,e.offsetY);}
});
lc.addEventListener('mousemove',e=>{
  if(lassoMode&&_lassoDown){_lassoPts.push([e.offsetX,e.offsetY]);lctx.strokeStyle='rgba(167,139,250,0.9)';lctx.lineWidth=1.5;lctx.lineTo(e.offsetX,e.offsetY);lctx.stroke();}
  else if(eraserMode){drawEraserCircle(e.offsetX,e.offsetY);if(_eraserDown)applyEraserAt(e.offsetX,e.offsetY);}
});
lc.addEventListener('mouseup',e=>{
  if(lassoMode&&_lassoDown){_lassoDown=false;finalizeLasso();}
  else if(eraserMode&&_eraserDown)_eraserDown=false;
});
lc.addEventListener('mouseleave',()=>{
  if(_lassoDown){_lassoDown=false;finalizeLasso();}
  if(_eraserDown)_eraserDown=false;
  if(eraserMode)clearLassoCanvas();
});

let drawMode=false,pickMode=false;
let waypoints=[],wpMarkers=[],trajLine=null,trajArrows=[];
function yawToQuat(y){const h=y/2;return{q_x:0,q_y:0,q_z:Math.sin(h),q_w:Math.cos(h)};}
function recomputeQuaternions(){
  const n=waypoints.length;
  for(let i=0;i<n;i++){
    let dx,dy;
    if(i<n-1){dx=waypoints[i+1].x-waypoints[i].x;dy=waypoints[i+1].y-waypoints[i].y;}
    else if(n>1){dx=waypoints[i].x-waypoints[i-1].x;dy=waypoints[i].y-waypoints[i-1].y;}
    else{dx=1;dy=0;}
    const d=Math.sqrt(dx*dx+dy*dy);Object.assign(waypoints[i],yawToQuat(d>0.001?Math.atan2(dy,dx):0));
  }
}
function rebuildTrajLine(){
  if(trajLine){scene.remove(trajLine);trajLine.geometry.dispose();trajLine=null;}
  trajArrows.forEach(a=>scene.remove(a));trajArrows=[];
  if(waypoints.length<2)return;
  const pts=waypoints.map(w=>new THREE.Vector3(w.x,w.y,w.z));
  trajLine=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:0xf59e0b,linewidth:2}));
  scene.add(trajLine);
  for(let i=0;i<pts.length-1;i++){
    const dir=new THREE.Vector3().subVectors(pts[i+1],pts[i]);
    const mid=new THREE.Vector3().addVectors(pts[i],pts[i+1]).multiplyScalar(0.5);
    const len=dir.length();if(len<0.001)continue;dir.normalize();
    const arr=new THREE.ArrowHelper(dir,mid,Math.min(len*0.4,1.0),0xfbbf24,0.4,0.2);scene.add(arr);trajArrows.push(arr);
  }
}
function addWaypoint(x,y,z,q){
  waypoints.push(q?{x,y,z,q_x:q.q_x??0,q_y:q.q_y??0,q_z:q.q_z??0,q_w:q.q_w??1}:{x,y,z,q_x:0,q_y:0,q_z:0,q_w:1});
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(0.25,12,8),new THREE.MeshBasicMaterial({color:0xf59e0b}));
  mesh.position.set(x,y,z);scene.add(mesh);wpMarkers.push(mesh);
  rebuildTrajLine();recomputeQuaternions();document.getElementById('traj-count').textContent=waypoints.length+' pts';
}
function trajUndoInternal(){
  if(!waypoints.length)return;waypoints.pop();
  const m=wpMarkers.pop();if(m){scene.remove(m);m.geometry.dispose();}
  rebuildTrajLine();recomputeQuaternions();document.getElementById('traj-count').textContent=waypoints.length+' pts';
}
function trajClearInternal(){
  waypoints=[];wpMarkers.forEach(m=>{scene.remove(m);m.geometry.dispose();});wpMarkers=[];
  if(trajLine){scene.remove(trajLine);trajLine.geometry.dispose();trajLine=null;}
  trajArrows.forEach(a=>scene.remove(a));trajArrows=[];
  document.getElementById('wp-popup').style.display='none';document.getElementById('traj-count').textContent='0 pts';
}
function loadWaypointsArray(pts){
  trajClearInternal();
  pts.forEach(p=>addWaypoint(p.x??0,p.y??0,p.z??0,p.q_w!==undefined?{q_x:p.q_x??0,q_y:p.q_y??0,q_z:p.q_z??0,q_w:p.q_w??1}:null));
}
function showWpPopup(cx,cy,idx){
  const wp=waypoints[idx];window._wpPopupIdx=idx;
  const f4=v=>(typeof v==='number')?v.toFixed(4):String(v);
  const yd=(Math.atan2(2*(wp.q_w*wp.q_z),1-2*wp.q_z*wp.q_z)*180/Math.PI).toFixed(1);
  const rows=[['#',idx],['X','<span style="color:#ef4444">'+f4(wp.x)+'</span>'],['Y','<span style="color:#22c55e">'+f4(wp.y)+'</span>'],['Z','<span style="color:#3b82f6">'+f4(wp.z)+'</span>'],['q_x',f4(wp.q_x)],['q_y',f4(wp.q_y)],['q_z',f4(wp.q_z)],['q_w',f4(wp.q_w)],['yaw°',yd]];
  document.getElementById('wp-popup-content').innerHTML=rows.map(([k,v])=>'<div><span style="color:#94a3b8;min-width:46px;display:inline-block">'+k+'</span>'+v+'</div>').join('');
  const pp=document.getElementById('wp-popup');pp.style.display='block';
  const mr=wrap.getBoundingClientRect();let lx=cx-mr.left+14,ly=cy-mr.top+14;
  if(lx+210>mr.width)lx=cx-mr.left-214;if(ly+260>mr.height)ly=cy-mr.top-264;
  pp.style.left=lx+'px';pp.style.top=ly+'px';
}
function deleteWaypointAt(idx){
  if(idx<0||idx>=waypoints.length)return;waypoints.splice(idx,1);
  const m=wpMarkers.splice(idx,1)[0];if(m){scene.remove(m);m.geometry.dispose();}
  rebuildTrajLine();recomputeQuaternions();document.getElementById('wp-popup').style.display='none';
  document.getElementById('traj-count').textContent=waypoints.length+' pts';
}

let _dragIdx=-1,_dragActive=false;
const _ray=new THREE.Raycaster();_ray.params.Points={threshold:0.3};
canvas.addEventListener('mousedown',e=>{
  if(lassoMode||eraserMode)return;
  if((!drawMode&&!pickMode)||e.button!==0||!wpMarkers.length)return;
  const rect=canvas.getBoundingClientRect();const ndc=new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1,-((e.clientY-rect.top)/rect.height)*2+1);
  _ray.setFromCamera(ndc,camera);const hits=_ray.intersectObjects(wpMarkers);
  if(hits.length>0){_dragIdx=wpMarkers.indexOf(hits[0].object);_dragActive=true;controls.enabled=false;document.getElementById('wp-popup').style.display='none';e.stopPropagation();}
});
canvas.addEventListener('mousemove',e=>{
  if(lassoMode||eraserMode)return;if(!_dragActive||_dragIdx<0)return;
  const rect=canvas.getBoundingClientRect();const ndc=new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1,-((e.clientY-rect.top)/rect.height)*2+1);
  _ray.setFromCamera(ndc,camera);const wp=waypoints[_dragIdx];
  const wpZ=parseFloat(document.getElementById('wp-z')?.value??'0')||0;
  const plane=new THREE.Plane(new THREE.Vector3(0,0,1),-wpZ);const hit=new THREE.Vector3();_ray.ray.intersectPlane(plane,hit);
  if(hit){waypoints[_dragIdx].x=hit.x;waypoints[_dragIdx].y=hit.y;waypoints[_dragIdx].z=wpZ;wpMarkers[_dragIdx].position.set(hit.x,hit.y,wpZ);rebuildTrajLine();recomputeQuaternions();}
});
canvas.addEventListener('mouseup',()=>{if(_dragActive){_dragActive=false;_dragIdx=-1;controls.enabled=!drawMode;}});

let pickMarker=null;
function showPickPopup(cx,cy,info){
  const pp=document.getElementById('pick-popup');let html='';
  for(const[k,v] of Object.entries(info)){const lbl={x:'<span style="color:#ef4444">X</span>',y:'<span style="color:#22c55e">Y</span>',z:'<span style="color:#3b82f6">Z</span>'}[k]||k;html+='<div><span style="color:#94a3b8;min-width:80px;display:inline-block">'+lbl+'</span>'+v+'</div>';}
  pp.innerHTML=html;pp.style.display='block';
  const mr=wrap.getBoundingClientRect();let lx=cx-mr.left+14,ly=cy-mr.top+14;
  if(lx+180>mr.width)lx=cx-mr.left-184;if(ly+200>mr.height)ly=cy-mr.top-204;
  pp.style.left=lx+'px';pp.style.top=ly+'px';
}
function hidePickPopup(){document.getElementById('pick-popup').style.display='none';if(pickMarker){scene.remove(pickMarker);pickMarker.geometry.dispose();pickMarker=null;}}

canvas.addEventListener('click',e=>{
  if(_dragActive||lassoMode||eraserMode)return;
  if((pickMode||drawMode)&&wpMarkers.length){
    const rect=canvas.getBoundingClientRect();const ndc=new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1,-((e.clientY-rect.top)/rect.height)*2+1);
    _ray.setFromCamera(ndc,camera);const wh=_ray.intersectObjects(wpMarkers);
    if(wh.length>0){const wi=wpMarkers.indexOf(wh[0].object);if(wi>=0){showWpPopup(e.clientX,e.clientY,wi);return;}}
  }
  if(pickMode&&pointCloud){
    const rect=canvas.getBoundingClientRect();const ndc=new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1,-((e.clientY-rect.top)/rect.height)*2+1);
    _ray.setFromCamera(ndc,camera);const hits=_ray.intersectObject(pointCloud);
    if(hits.length>0){
      const h=hits[0],idx=h.index,pa=pointCloud.geometry.getAttribute('position');
      const px=pa.getX(idx),py=pa.getY(idx),pz=pa.getZ(idx);const info={};
      rawFields.forEach((fn,fi)=>{const raw=rawFloats?rawFloats[idx*rawNfields+fi]:undefined;if(raw!==undefined)info[fn]=(Math.abs(raw)<1e4&&raw%1!==0)?raw.toFixed(4):raw;});
      info['x']=px.toFixed(4);info['y']=py.toFixed(4);info['z']=pz.toFixed(4);info['index']=idx;info['dist']=h.distance.toFixed(3)+' m';
      if(pickMarker){scene.remove(pickMarker);pickMarker.geometry.dispose();}
      pickMarker=new THREE.Mesh(new THREE.SphereGeometry(0.18,10,6),new THREE.MeshBasicMaterial({color:0x00ffcc,depthTest:false}));
      pickMarker.position.set(px,py,pz);scene.add(pickMarker);showPickPopup(e.clientX,e.clientY,info);
    }else hidePickPopup();return;
  }
  if(!drawMode)return;
  const rect=canvas.getBoundingClientRect();const ndc=new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1,-((e.clientY-rect.top)/rect.height)*2+1);
  _ray.setFromCamera(ndc,camera);const hit=new THREE.Vector3();
  const wpZ=parseFloat(document.getElementById('wp-z')?.value??'0')||0;
  _ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,0,1),-wpZ),hit);
  if(hit){addWaypoint(hit.x,hit.y,wpZ);}
});

function heightColor(t){const c=[[0.1,0.1,0.8],[0.0,0.8,0.8],[0.0,0.9,0.1],[0.9,0.9,0.0],[0.9,0.1,0.1]];const s=Math.max(0,Math.min(1,t))*(c.length-1);const lo=Math.floor(s),hi=Math.min(c.length-1,lo+1),f=s-lo;return[c[lo][0]+(c[hi][0]-c[lo][0])*f,c[lo][1]+(c[hi][1]-c[lo][1])*f,c[lo][2]+(c[hi][2]-c[lo][2])*f];}
function getFilt(){return filterActive?{active:true,zMin:filterZMin,zMax:filterZMax,mode:filterMode}:null;}
// buildPointCloud works directly on Float32Array (stride=nfields) for JIT-friendly access
function buildPointCloud(floats,nfields,fields,mode,filt){
  const xi=fields.indexOf('x'),yi=fields.indexOf('y'),zi=fields.indexOf('z'),ii=fields.indexOf('intensity');
  const np=(floats.length/nfields)|0;
  // Build filtered index list
  let idxs=null;
  if(filt&&filt.active){
    idxs=[];
    for(let i=0;i<np;i++){const z=floats[i*nfields+zi]*flipZ;const inside=z>=filt.zMin&&z<=filt.zMax;if(filt.mode==='keep'?inside:!inside)idxs.push(i);}
    displayedToRaw=idxs;
  }else{displayedToRaw=null;}
  const n=idxs?idxs.length:np;
  const pos=new Float32Array(n*3),col=new Float32Array(n*3);
  // Pass 1: find Z/intensity range
  let zMn=Infinity,zMx=-Infinity,iMn=Infinity,iMx=-Infinity;
  for(let k=0;k<n;k++){const i=idxs?idxs[k]:k;const z=floats[i*nfields+zi];if(z<zMn)zMn=z;if(z>zMx)zMx=z;if(ii>=0){const iv=floats[i*nfields+ii];if(iv<iMn)iMn=iv;if(iv>iMx)iMx=iv;}}
  // Use locked Z range for height mode (prevents color drift between frames)
  if(mode==='height'&&_lockedZRange){zMn=_lockedZRange.mn;zMx=_lockedZRange.mx;}
  else if(mode==='height'&&_lockedZRange===null&&zMn!==Infinity){
    // Auto-lock on first frame
    lockZRange(zMn,zMx);
  }
  const zR=zMx-zMn||1,iR=iMx-iMn||1;
  // Pass 2: fill buffers
  for(let k=0;k<n;k++){
    const i=idxs?idxs[k]:k,b=i*nfields;
    pos[k*3]=floats[b+xi]*flipX;pos[k*3+1]=floats[b+yi]*flipY;pos[k*3+2]=floats[b+zi]*flipZ;
    let r,g,bl;if(mode==='height')[r,g,bl]=heightColor((floats[b+zi]-zMn)/zR);else if(mode==='intensity'&&ii>=0)[r,g,bl]=heightColor((floats[b+ii]-iMn)/iR);else{r=0.4;g=0.8;bl=1.0;}
    col[k*3]=r;col[k*3+1]=g;col[k*3+2]=bl;
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));geo.computeBoundingBox();
  return new THREE.Points(geo,new THREE.PointsMaterial({size:ptSize*0.05,vertexColors:true,sizeAttenuation:true}));
}
function _rawPointsFromFloats(){
  // Lazily build rawPoints array-of-arrays from rawFloats (needed for edit ops)
  if(rawPoints&&rawPoints.length===(rawFloats.length/rawNfields|0))return;
  const np=(rawFloats.length/rawNfields)|0;
  rawPoints=new Array(np);
  for(let i=0;i<np;i++){const r=new Array(rawNfields),b=i*rawNfields;for(let j=0;j<rawNfields;j++)r[j]=rawFloats[b+j];rawPoints[i]=r;}
}
function _floatsFromRawPoints(){
  rawFloats=new Float32Array(rawPoints.length*rawNfields);
  for(let i=0;i<rawPoints.length;i++){const b=i*rawNfields;for(let j=0;j<rawNfields;j++)rawFloats[b+j]=rawPoints[i][j]||0;}
}
function replacePointCloud(pc){if(pointCloud){scene.remove(pointCloud);pointCloud.geometry.dispose();}pointCloud=pc;scene.add(pointCloud);}

function setLassoModeInternal(on){
  lassoMode=on;
  if(on){eraserMode=false;drawMode=false;pickMode=false;controls.enabled=false;lc.style.pointerEvents='auto';canvas.style.cursor='crosshair';document.getElementById('lasso-hint').style.display='block';['traj-hint','pick-hint','eraser-hint'].forEach(id=>document.getElementById(id).style.display='none');}
  else{lc.style.pointerEvents='none';controls.enabled=true;canvas.style.cursor='default';clearLassoCanvas();document.getElementById('lasso-hint').style.display='none';}
}
function setEraserModeInternal(on){
  eraserMode=on;
  if(on){lassoMode=false;drawMode=false;pickMode=false;controls.enabled=false;lc.style.pointerEvents='auto';canvas.style.cursor='none';document.getElementById('eraser-hint').style.display='block';['traj-hint','pick-hint','lasso-hint'].forEach(id=>document.getElementById(id).style.display='none');}
  else{lc.style.pointerEvents='none';controls.enabled=true;canvas.style.cursor='default';clearLassoCanvas();document.getElementById('eraser-hint').style.display='none';}
}

let _camInit=false;
let rawFloats=null,rawNfields=0;
window._three={
  loadPoints(floats,nfields,fields){
    rawFloats=floats;rawNfields=nfields;rawFields=fields;rawPoints=null;  // rawPoints built lazily
    // Reset Z lock when loading a new sequence (color mode change or fresh load)
    // Don't reset mid-playback — _lockedZRange persists across frames intentionally
    clearSelectionInternal();replacePointCloud(buildPointCloud(floats,nfields,fields,colorMode,getFilt()));
    if(!_camInit){_camInit=true;}  // 保留首帧标记，但不再覆盖初始视角
  },
  resetCamInit(){_camInit=false;},
  setPointSize(s){ptSize=s;if(pointCloud)pointCloud.material.size=s*0.05;if(selectionCloud)selectionCloud.material.size=s*0.08;},
  setColorMode(m){colorMode=m;if(m!=='height')unlockZRange();if(rawFloats)replacePointCloud(buildPointCloud(rawFloats,rawNfields,rawFields,m,getFilt()));},
  setFlip(x,y,z){flipX=x;flipY=y;flipZ=z;if(!rawFloats)return;replacePointCloud(buildPointCloud(rawFloats,rawNfields,rawFields,colorMode,getFilt()));},
  resetCamera(){camera.position.set(...INIT_CAM_POS);camera.up.set(0,0,1);controls.target.set(...INIT_CAM_TARGET);controls.update();},
  setDrawMode(on){drawMode=on;if(on){pickMode=false;document.getElementById('pick-hint').style.display='none';hidePickPopup();setLassoModeInternal(false);setEraserModeInternal(false);}controls.enabled=!on;canvas.style.cursor=on?'crosshair':(pickMode?'cell':'default');document.getElementById('traj-hint').style.display=on?'block':'none';},
  setPickMode(on){pickMode=on;if(on){drawMode=false;document.getElementById('traj-hint').style.display='none';setLassoModeInternal(false);setEraserModeInternal(false);}else hidePickPopup();controls.enabled=true;canvas.style.cursor=on?'cell':'default';document.getElementById('pick-hint').style.display=on?'block':'none';},
  setLassoMode(on){setLassoModeInternal(on);},
  setEraserMode(on){setEraserModeInternal(on);},
  clearSelection(){clearSelectionInternal();},
  hasCloud(){return rawFloats&&rawFloats.length>0;},
  deleteSelected(){if(!selectedIndices.size)return;_rawPointsFromFloats();undoBuffer={rawPoints:[...rawPoints],rawFields:[...rawFields],rawFloats:rawFloats.slice(),rawNfields};document.getElementById('edit-undo-btn').style.display='';const rawIdxs=displayedToRaw?[...selectedIndices].map(i=>displayedToRaw[i]):[...selectedIndices];rawIdxs.sort((a,b)=>b-a).forEach(i=>rawPoints.splice(i,1));_floatsFromRawPoints();clearSelectionInternal();replacePointCloud(buildPointCloud(rawFloats,rawNfields,rawFields,colorMode,getFilt()));},
  undoDelete(){if(!undoBuffer)return;rawPoints=undoBuffer.rawPoints;rawFields=undoBuffer.rawFields;rawFloats=undoBuffer.rawFloats;rawNfields=undoBuffer.rawNfields;undoBuffer=null;document.getElementById('edit-undo-btn').style.display='none';clearSelectionInternal();replacePointCloud(buildPointCloud(rawFloats,rawNfields,rawFields,colorMode,getFilt()));},
  getEditedPoints(){_rawPointsFromFloats();return rawPoints;},getFields(){return rawFields;},
  _setEraserRadius(r){eraserRadius=r;},
  undoWaypoint:trajUndoInternal,clearWaypoints:trajClearInternal,getWaypoints:()=>[...waypoints],loadWaypoints:loadWaypointsArray,deleteWaypointAt(idx){deleteWaypointAt(idx);},setPickThreshold(t){_ray.params.Points.threshold=t;},
  applyFilter(zMin,zMax,mode){filterActive=true;filterZMin=zMin;filterZMax=zMax;filterMode=mode;if(rawFloats)replacePointCloud(buildPointCloud(rawFloats,rawNfields,rawFields,colorMode,{active:true,zMin,zMax,mode}));},
  resetFilter(){filterActive=false;if(rawFloats)replacePointCloud(buildPointCloud(rawFloats,rawNfields,rawFields,colorMode,null));},
  setView(preset){if(preset==='free'){_setFreeMode(true);return;}if(_freeMode)_setFreeMode(false);if(!pointCloud)return;const box=pointCloud.geometry.boundingBox,center=new THREE.Vector3(),size=new THREE.Vector3();box.getCenter(center);box.getSize(size);const d=size.length()*1.5;controls.target.copy(center);switch(preset){case 'top':{const h=Math.max(size.x,size.y)*0.18+1.5;controls.target.set(0,0,0);camera.position.set(0,0,h);camera.up.set(1,0,0);break;}case 'front':{const d2=Math.max(size.y,size.z)*0.6+3;controls.target.set(0,0,0);camera.position.set(d2,0,0);camera.up.set(0,0,1);break;}case 'left':{const d2=Math.max(size.x,size.z)*0.6+3;controls.target.set(0,0,0);camera.position.set(0,d2,0);camera.up.set(0,0,1);break;}default:/* '3d' \u6062\u590d\u521d\u59cb\u89c6\u89d2 */camera.position.set(...INIT_CAM_POS);camera.up.set(0,0,1);controls.target.set(...INIT_CAM_TARGET);}controls.update();},
  resize(){resize();},
  isFreeMode(){return _freeMode;}
};
