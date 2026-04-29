// ── Timing log & log panel ──────────────────────────────────────────────────
let _logCollapsed=false;
const _LOG_MAX=200;
function _appendLog(html){
  const el=document.getElementById('log-entries');if(!el)return;
  const d=document.createElement('div');d.className='log-entry';d.innerHTML=html;el.insertBefore(d,el.firstChild);
  while(el.children.length>_LOG_MAX)el.removeChild(el.lastChild);
}
function _tlogFrame(fetchMs,parseMs,renderMs,npts,fromCache,filename){
  const total=(fromCache?0:fetchMs)+parseMs+renderMs;
  const now=new Date().toLocaleTimeString('en',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const fetchStr=fromCache?'<span class="le-cache">cached</span>':'<span class="le-fetch">fetch:'+fetchMs.toFixed(0)+'ms</span>';
  const html='<span class="le-time">['+now+']</span> '
    +fetchStr
    +'  <span class="le-parse">parse:'+parseMs.toFixed(0)+'ms</span>'
    +'  <span class="le-render">render:'+renderMs.toFixed(0)+'ms</span>'
    +'  <span class="le-total">total:'+total.toFixed(0)+'ms</span>'
    +'  <span class="le-pts">'+(npts/1000).toFixed(1)+'k pts</span>'
    +(filename?'  <span class="le-file">'+filename+'</span>':'');
  _appendLog(html);
  const lineText='['+now+'] '+(fromCache?'cached':'fetch:'+fetchMs.toFixed(0)+'ms')+' parse:'+parseMs.toFixed(0)+'ms render:'+renderMs.toFixed(0)+'ms total:'+total.toFixed(0)+'ms '+(npts/1000).toFixed(1)+'k pts'+(filename?' '+filename:'');
  console.log('[PCD timing] '+lineText);
}
function clearLog(){const el=document.getElementById('log-entries');if(el)el.innerHTML='';}

// ── Generic UI activity log ───────────────────────────────────────────────
// 把所有用户操作 / 状态变化都记录到右下角 log 面板
function _logUI(action, info, level){
  const now=new Date().toLocaleTimeString('en',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const ms =('00'+new Date().getMilliseconds()).slice(-3);
  const lvCls={ok:'le-cache',err:'le-fetch',warn:'le-render',ui:'le-pts'}[level||'ui']||'le-pts';
  const html='<span class="le-time">['+now+'.'+ms+']</span> '
    +'<span class="'+lvCls+'">'+(level||'ui').toUpperCase()+'</span> '
    +'<span class="le-file">'+action+'</span>'
    +(info!=null&&info!==''?'  <span class="le-total">'+String(info).replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))+'</span>':'');
  _appendLog(html);
}
// 自动捕获所有侧栏按钮点击 / select 变化 / checkbox 切换 / range/number 输入
(function(){
  function nodeLabel(el){
    if(!el)return '?';
    const id=el.id||'';
    let txt=(el.textContent||'').trim().slice(0,28);
    if(!txt&&el.title)txt=el.title;
    if(!txt&&el.tagName==='INPUT')txt=el.placeholder||el.type;
    return (id?'#'+id+' ':'')+txt;
  }
  function inSidebar(el){return el && el.closest && el.closest('#sidebar');}
  document.addEventListener('click',e=>{
    const btn=e.target.closest && e.target.closest('button,label.btn');
    if(!btn||!inSidebar(btn))return;
    _logUI('click', nodeLabel(btn));
  },true);
  document.addEventListener('change',e=>{
    const el=e.target;if(!inSidebar(el))return;
    if(el.tagName==='SELECT')      _logUI('select', nodeLabel(el)+' = '+el.value);
    else if(el.type==='checkbox')  _logUI('toggle', nodeLabel(el)+' = '+(el.checked?'on':'off'));
    else if(el.type==='number')    _logUI('input',  nodeLabel(el)+' = '+el.value);
  },true);
  // range slider 在松开时记一次（避免拖动刷屏）
  document.addEventListener('change',e=>{
    if(e.target.type==='range'&&inSidebar(e.target))_logUI('slider', nodeLabel(e.target)+' = '+e.target.value);
  },true);
})();
function toggleLogPanel(){
  const p=document.getElementById('log-panel'),btn=document.getElementById('log-panel-toggle');
  if(!p)return;
  _logCollapsed=!_logCollapsed;
  p.classList.add('collapsing');
  p.classList.toggle('collapsed',_logCollapsed);
  btn.textContent=_logCollapsed?'\u25BC Show':'\u25B2 Hide';
  setTimeout(()=>p.classList.remove('collapsing'),200);
  if(window._three&&window._three.resize)window._three.resize();
}
// ── Log panel drag-to-resize ───────────────────────────────────────────
(function(){
  const bar=document.getElementById('log-resize-bar');
  const panel=document.getElementById('log-panel');
  let _logH=200;
  bar.addEventListener('mousedown',e=>{
    if(_logCollapsed)return;
    e.preventDefault();
    bar.classList.add('dragging');
    const startY=e.clientY,startH=panel.offsetHeight;
    function onMove(e){
      const h=Math.max(60,Math.min(600,startH-(e.clientY-startY)));
      _logH=h;panel.style.height=h+'px';
      if(window._three&&window._three.resize)window._three.resize();
    }
    function onUp(){bar.classList.remove('dragging');document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);}
    document.addEventListener('mousemove',onMove);
    document.addEventListener('mouseup',onUp);
  });
})();
// ── Frame cache & prefetch ───────────────────────────────────────────────────
const _frameCache=new Map();
const _fetchPromises=new Map();  // in-flight fetch promises — shared by prefetch & loadFile
const _PREFETCH_AHEAD=8,_CACHE_MAX=40;
function _cacheEvict(){while(_frameCache.size>_CACHE_MAX){_frameCache.delete(_frameCache.keys().next().value);}}
// Central fetch: deduplicates concurrent requests for the same key
function _fetchBuf(url,key){
  if(_frameCache.has(key))return Promise.resolve(_frameCache.get(key));
  if(_fetchPromises.has(key))return _fetchPromises.get(key);
  const p=fetch(url).then(r=>{if(!r.ok)throw new Error(r.status);return r.arrayBuffer();}).then(buf=>{
    _frameCache.set(key,buf);_cacheEvict();_fetchPromises.delete(key);return buf;
  }).catch(e=>{_fetchPromises.delete(key);throw e;});
  _fetchPromises.set(key,p);return p;
}
function _parsePcdBuf(buf){
  const dv=new DataView(buf),metaLen=dv.getUint32(0,true);
  const meta=JSON.parse(new TextDecoder().decode(new Uint8Array(buf,4,metaLen)));
  const{fields,npoints,original_count,file:fname}=meta;
  const nfields=fields.length,rawOff=4+metaLen,dataOff=rawOff+((4-rawOff%4)%4);
  return{fields,npoints,nfields,original_count,fname,floats:new Float32Array(buf,dataOff,npoints*nfields)};
}
function prefetchFile(path){
  if(!path||_frameCache.has(path)||_fetchPromises.has(path))return;
  _fetchBuf('/api/pcd_binary?file='+encodeURIComponent(path),path).catch(()=>{});
}
// ── Playback engine ──────────────────────────────────────────────────────────
let _playFiles=[],_playCur=0,_playTotal=0,_playFps=10;
let _playRunning=false,_playGen=0;
function _playGoto(idx){
  if(!_playFiles.length)return;
  idx=Math.max(0,Math.min(_playTotal-1,idx));
  _playCur=idx;
  const f=_playFiles[idx];
  const sel=document.getElementById('file-select');if(sel)sel.value=f;
  document.getElementById('play-idx').textContent=idx+1;
  const sk=document.getElementById('play-seek');if(sk)sk.value=idx;
  loadFile(f);
}
function playStep(d){if(!_playRunning)_playGoto(_playCur+d);}
function playSeek(i){_playCur=Math.max(0,Math.min(_playTotal-1,i));if(!_playRunning)_playGoto(_playCur);}
function playSetFps(v){_playFps=v;document.getElementById('play-fps-val').textContent=v;}
async function _playLoopStep(gen){
  if(!_playRunning||gen!==_playGen)return;
  const f=_playFiles[_playCur];
  const sel=document.getElementById('file-select');if(sel)sel.value=f;
  document.getElementById('play-idx').textContent=_playCur+1;
  const sk=document.getElementById('play-seek');if(sk)sk.value=_playCur;
  const t0=performance.now();
  await loadFile(f);
  if(!_playRunning||gen!==_playGen)return;
  for(let k=1;k<=_PREFETCH_AHEAD;k++)prefetchFile(_playFiles[(_playCur+k)%_playTotal]);
  _playCur=(_playCur+1)%_playTotal;
  const elapsed=performance.now()-t0;
  setTimeout(()=>_playLoopStep(gen),Math.max(0,1000/_playFps-elapsed));
}
function _stopPlay(){
  if(_playRunning){_playRunning=false;_playGen++;document.getElementById('btn-play').innerHTML='&#9654; Play';}
}
function playToggle(){
  if(_playRunning){_stopPlay();return;}
  if(!_playTotal)return;
  _playRunning=true;const gen=++_playGen;
  document.getElementById('btn-play').innerHTML='&#9646;&#9646; Pause';
  _playLoopStep(gen);
}
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){exitAllModes();return;}
  const tag=document.activeElement.tagName;
  if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
  if(_ddsActive)return;
  if(e.key==='ArrowLeft'){playStep(-1);e.preventDefault();}
  else if(e.key==='ArrowRight'){playStep(1);e.preventDefault();}
  else if(e.key===' '){playToggle();e.preventDefault();}
});
// end playback
// ── DDS Live mode ────────────────────────────────────────────────────────────
let _ddsActive=false,_ddsLastId=-1,_ddsStatusPoll=null,_ddsPaused=false;
// 最新收到但尚未渲染的帧（fetch 写入，rAF 消费）
let _ddsPending=null; // {floats, nfields, fields, fid, npoints} | null
// Foxglove 风格：渲染预算（固定帧率上限）+ 自适应点数预算
let _ddsRenderFpsCap=20,_ddsRenderMinInterval=1000/20,_ddsLastRenderAt=0;
let _ddsAdaptive=true,_ddsRenderMsEwma=0,_ddsAdaptCooldownUntil=0;
let _ddsCurrentMaxPoints=60000,_ddsAutoMinPoints=10000,_ddsAutoMaxPoints=1000000;
let _ddsLastUiStatusAt=0,_ddsLastZRangeAt=0;
let _ddsLastUiStatusFid=-1,_ddsLastUiStatusTs=0;
let _ddsFetchedCount=0,_ddsRenderedCount=0,_ddsOverwrittenCount=0;
let _ddsLastFetchedCount=0,_ddsLastRenderedCount=0,_ddsLastOverwrittenCount=0;
let _ddsWorkerParseMsTotal=0,_ddsLastWorkerParseMsTotal=0;
let _ddsTransitMsTotal=0,_ddsLastTransitMsTotal=0,_ddsTransitSamples=0,_ddsLastTransitSamples=0;
let _ddsWorkerOpenCount=0,_ddsWorkerCloseCount=0;
let _ddsWorker=null;
// FPS meter（渲染侧）
let _ddsFpsCnt=0,_ddsFpsT0=performance.now(),_ddsFpsLast='';
function _ddsFpsTick(){
  _ddsFpsCnt++;
  const now=performance.now(),dt=now-_ddsFpsT0;
  if(dt>=1000){_ddsFpsLast=(_ddsFpsCnt*1000/dt).toFixed(1)+' fps';_ddsFpsCnt=0;_ddsFpsT0=now;}
}
function _ddsRoundPts(v){return Math.max(_ddsAutoMinPoints,Math.min(_ddsAutoMaxPoints,Math.round(v/1000)*1000));}
function _ddsSetMaxPoints(n,silent){
  const v=_ddsRoundPts(parseInt(n,10)||_ddsCurrentMaxPoints);
  _ddsCurrentMaxPoints=v;
  const el=document.getElementById('dds-max-pts');if(el&&parseInt(el.value,10)!==v)el.value=v;
  const val=document.getElementById('dds-max-pts-val');if(val)val.textContent=Math.round(v/1000)+'k';
  fetch('/api/dds_set_max_points?n='+v).catch(()=>{});
  if(!silent)setStatus('DDS max points: '+v.toLocaleString(),'ok');
}
function ddsSetMaxPointsFromUI(v){_ddsSetMaxPoints(v,false);}
function ddsSetRenderFpsFromUI(v){
  const fps=Math.max(1,Math.min(30,parseInt(v,10)||10));
  _ddsRenderFpsCap=fps;
  // 留 5% 余量，避免与源帧率 (例如 10 fps) 临界对齐时因抖动漏帧 → 实测 9 fps。
  _ddsRenderMinInterval=(1000/fps)*0.95;
  const el=document.getElementById('dds-render-fps-val');if(el)el.textContent=String(fps);
}
function ddsToggleAdaptive(on){_ddsAdaptive=!!on;}
async function _ddsStartWorker(){
  if(_ddsWorker){try{_ddsWorker.terminate();}catch(e){} _ddsWorker=null;}
  // Lazy-start the DDS UDP listener + WS server on first use.
  try{await fetch('/api/dds_ensure');}catch(e){}
  let wsCfg=null;
  try{
    const r=await fetch('/api/dds_stream_config');
    wsCfg=await r.json();
  }catch(e){
    setStatus('DDS stream config error','err');
    return;
  }
  const wsProto=location.protocol==='https:'?'wss':'ws';
  const wsUrl=wsProto+'://'+location.hostname+':'+(wsCfg.port||8090);
  _ddsWorker=new Worker('/static/dds_fetch_worker.js');
  _ddsWorker.onmessage=(event)=>{
    const data=event.data||{};
    if(!_ddsActive)return;
    if(data.type==='frame'){
      _ddsLastId=data.fid||0;
      const floats=new Float32Array(data.buffer,data.dataOff,data.npoints*data.nfields);
      _ddsFetchedCount++;
      _ddsWorkerParseMsTotal+=(data.parseMs||0);
      if(typeof data.transitMs==='number'&&data.transitMs>=0){
        _ddsTransitMsTotal+=data.transitMs;
        _ddsTransitSamples++;
      }
      if(_ddsPending)_ddsOverwrittenCount++;
      _ddsPending={floats,nfields:data.nfields,fields:data.fields,fid:data.fid,npoints:data.npoints,fname:data.fname||''};
      return;
    }
    if(data.type==='ws-open'){
      _ddsWorkerOpenCount++;
      _logUI('dds-ws', 'open '+(data.url||wsUrl)+' '+(data.connectMs||0).toFixed(1)+'ms', 'ok');
      return;
    }
    if(data.type==='ws-close'){
      _ddsWorkerCloseCount++;
      _logUI('dds-ws', 'closed; reconnecting', 'warn');
      return;
    }
    if(data.type==='error'){
      document.getElementById('dds-status').textContent='error';
      document.getElementById('dds-status').style.color='#f87171';
      _logUI('dds-ws', (data.stage||'worker')+': '+(data.message||'unknown error'), 'err');
    }
  };
  _ddsWorker.postMessage({cmd:'start',wsUrl});
}
function _ddsStopWorker(){
  if(!_ddsWorker)return;
  try{_ddsWorker.postMessage({cmd:'stop'});}catch(e){}
  try{_ddsWorker.terminate();}catch(e){}
  _ddsWorker=null;
}
async function ddsRefreshReceiverConfig(){
  try{
    const [receiverResp,streamResp]=await Promise.all([
      fetch('/api/dds_receiver_config'),
      fetch('/api/dds_stream_config'),
    ]);
    const d=await receiverResp.json();
    const s=await streamResp.json();
    const ip=document.getElementById('dds-bind-ip');
    // Don't overwrite user's pending edits; only fill if empty/unfocused.
    if(ip&&document.activeElement!==ip&&!ip.value)ip.value=d.host||'255.255.255.255';
    const pt=document.getElementById('dds-bind-port');
    if(pt&&document.activeElement!==pt&&!pt.value)pt.value=String(d.port||9870);
    const st=document.getElementById('dds-bind-status');
    if(st){
      const src=(d.src_host&&d.src_host.length)?(' \u2190 from '+d.src_host+':'+d.src_port):'';
      st.textContent='udp: '+(d.host||'255.255.255.255')+':'+(d.port||9870)+(d.running?' (running)':' (stopped)')+src+'  |  ws: '+location.hostname+':'+(s.port||8090)+(s.running?' (running)':' (stopped)');
    }
  }catch(e){
    const st=document.getElementById('dds-bind-status');if(st)st.textContent='bind: read failed';
  }
}
async function ddsApplyReceiverConfig(){
  const ip=(document.getElementById('dds-bind-ip')?.value||'127.0.0.1').trim()||'127.0.0.1';
  const port=parseInt(document.getElementById('dds-bind-port')?.value||'9870',10);
  if(!(port>=1&&port<=65535)){setStatus('DDS receiver port invalid','err');return;}
  try{
    const r=await fetch('/api/dds_rebind?ip='+encodeURIComponent(ip)+'&port='+port);
    const d=await r.json();
    if(!d.ok){setStatus('DDS rebind failed: '+(d.error||'unknown'),'err');return;}
    const st=document.getElementById('dds-bind-status');
    if(st)st.textContent='udp: '+d.host+':'+d.port+(d.running?' (running)':' (stopped)');
    setStatus('DDS receiver bound to '+d.host+':'+d.port,'ok');
    ddsRefreshReceiverConfig();
  }catch(e){
    setStatus('DDS rebind error','err');
  }
}
function _ddsAdaptiveBudget(renderMs){
  _ddsRenderMsEwma=_ddsRenderMsEwma>0?(_ddsRenderMsEwma*0.85+renderMs*0.15):renderMs;
  const now=performance.now();
  if(!_ddsAdaptive||now<_ddsAdaptCooldownUntil)return;
  if(_ddsRenderMsEwma>40&&_ddsCurrentMaxPoints>_ddsAutoMinPoints){
    _ddsSetMaxPoints(Math.max(_ddsAutoMinPoints,Math.floor(_ddsCurrentMaxPoints*0.8)),true);
    _ddsAdaptCooldownUntil=now+1400;
    return;
  }
  if(_ddsRenderMsEwma<18&&_ddsCurrentMaxPoints<_ddsAutoMaxPoints){
    _ddsSetMaxPoints(Math.min(_ddsAutoMaxPoints,Math.floor(_ddsCurrentMaxPoints*1.1)),true);
    _ddsAdaptCooldownUntil=now+2200;
  }
}
// rAF 驱动的渲染循环：只消费 _ddsPending，与 fetch 完全解耦
function _ddsRenderTick(){
  if(!_ddsActive)return;
  if(_ddsPaused){requestAnimationFrame(_ddsRenderTick);return;}
  const now=performance.now();
  if(now-_ddsLastRenderAt<_ddsRenderMinInterval){requestAnimationFrame(_ddsRenderTick);return;}
  if(_ddsPending){
    const{floats,nfields,fields,fid,npoints}=_ddsPending;
    _ddsPending=null;
    const r0=performance.now();
    if(window._three.updateLive)window._three.updateLive(floats,nfields,fields);
    else window._three.loadPoints(floats,nfields,fields);
    // Z range UI update is expensive; run at low frequency in live mode.
    if(npoints>0&&now-_ddsLastZRangeAt>=800){_applyZRange(floats,nfields,fields);_ddsLastZRangeAt=now;}
    _ddsLastRenderAt=now;
    _ddsAdaptiveBudget(performance.now()-r0);
    _ddsRenderedCount++;
    _ddsFpsTick();
    const fpsStr=_ddsFpsLast?' \u00b7 '+_ddsFpsLast:'';
    document.getElementById('dds-status').textContent='frame '+fid+' \u00b7 '+npoints.toLocaleString()+' pts'+fpsStr;
    document.getElementById('dds-status').style.color='#34d399';
    document.getElementById('info').textContent=npoints.toLocaleString()+' pts  \u00b7  DDS Live #'+fid;
    // Avoid per-frame log/DOM churn from setStatus; keep periodic heartbeat only.
    if(now-_ddsLastUiStatusAt>=1000){
      const dt=Math.max(1,now-_ddsLastUiStatusTs);
      const recvDelta=_ddsFetchedCount-_ddsLastFetchedCount;
      const renderDelta=_ddsRenderedCount-_ddsLastRenderedCount;
      const overwriteDelta=_ddsOverwrittenCount-_ddsLastOverwrittenCount;
      const workerParseDelta=_ddsWorkerParseMsTotal-_ddsLastWorkerParseMsTotal;
      const transitDelta=_ddsTransitMsTotal-_ddsLastTransitMsTotal;
      const transitSampleDelta=_ddsTransitSamples-_ddsLastTransitSamples;
      const recvHz=((recvDelta*1000)/dt).toFixed(1);
      const renderHz=((renderDelta*1000)/dt).toFixed(1);
      const avgParseMs=recvDelta>0?(workerParseDelta/recvDelta).toFixed(2):'0.00';
      const avgTransitMs=transitSampleDelta>0?(transitDelta/transitSampleDelta).toFixed(1):'-';
      const avgRenderMs=_ddsRenderMsEwma.toFixed(1);
      const lt=window._liveLastTimings||{loopMs:0,flushMs:0,np:0};
      const gpuMs=(window._renderStats&&window._renderStats.ewmaMs)?window._renderStats.ewmaMs.toFixed(1):'-';
      setStatus('DDS #'+fid+' recv:'+recvDelta+'('+recvHz+'/s) render:'+renderDelta+'('+renderHz+'/s) overwrite:'+overwriteDelta+' parse:'+avgParseMs+'ms transit:'+avgTransitMs+'ms cpu:'+avgRenderMs+'ms loop:'+lt.loopMs.toFixed(1)+'ms flush:'+lt.flushMs.toFixed(1)+'ms gpu:'+gpuMs+'ms','ok');
      _ddsLastUiStatusAt=now;
      _ddsLastUiStatusFid=fid;
      _ddsLastUiStatusTs=now;
      _ddsLastFetchedCount=_ddsFetchedCount;
      _ddsLastRenderedCount=_ddsRenderedCount;
      _ddsLastOverwrittenCount=_ddsOverwrittenCount;
      _ddsLastWorkerParseMsTotal=_ddsWorkerParseMsTotal;
      _ddsLastTransitMsTotal=_ddsTransitMsTotal;
      _ddsLastTransitSamples=_ddsTransitSamples;
    }
  }
  requestAnimationFrame(_ddsRenderTick);
}
function _ddsLockFileUi(on){
  ['sec-file','sec-play'].forEach(id=>{
    const el=document.getElementById(id);if(!el)return;
    el.classList.toggle('dds-locked',!!on);
    if(on)el.removeAttribute('open');
  });
}
function ddsToggle(){
  if(_ddsActive){ddsStop();return;}
  _ddsActive=true;_ddsLastId=-1;_ddsPending=null;_ddsFpsCnt=0;_ddsFpsT0=performance.now();_ddsFpsLast='';
  _ddsLastRenderAt=0;_ddsRenderMsEwma=0;_ddsAdaptCooldownUntil=0;
  _ddsLastUiStatusAt=0;_ddsLastZRangeAt=0;
  _ddsLastUiStatusFid=-1;_ddsLastUiStatusTs=performance.now();
  _ddsFetchedCount=0;_ddsRenderedCount=0;_ddsOverwrittenCount=0;
  _ddsLastFetchedCount=0;_ddsLastRenderedCount=0;_ddsLastOverwrittenCount=0;
  _ddsWorkerParseMsTotal=0;_ddsLastWorkerParseMsTotal=0;
  _ddsTransitMsTotal=0;_ddsLastTransitMsTotal=0;_ddsTransitSamples=0;_ddsLastTransitSamples=0;
  _ddsWorkerOpenCount=0;_ddsWorkerCloseCount=0;
  _stopPlay(); // stop file playback
  _ddsLockFileUi(true);
  const _ovl=document.getElementById('overlay');if(_ovl)_ovl.style.display='none';
  document.getElementById('btn-dds').innerHTML='&#x23F9; DDS Stop';
  document.getElementById('btn-dds').style.background='#dc2626';
  document.getElementById('dds-status').textContent='connecting\u2026';
  document.getElementById('dds-status').style.color='#facc15';
  ddsSetRenderFpsFromUI(document.getElementById('dds-render-fps')?.value||'10');
  ddsToggleAdaptive(document.getElementById('dds-adaptive')?.checked!==false);
  _ddsSetMaxPoints(document.getElementById('dds-max-pts')?.value||_ddsCurrentMaxPoints,true);
  setStatus('DDS Live: waiting for frames\u2026','loading');
  requestAnimationFrame(_ddsRenderTick); // 启动渲染循环
  _ddsStartWorker();                     // 启动 worker WebSocket 拉流/解析
  // Poll receiver/stream config so the UI shows the live broadcaster IP.
  if(_ddsStatusPoll)clearInterval(_ddsStatusPoll);
  _ddsStatusPoll=setInterval(()=>{if(_ddsActive)ddsRefreshReceiverConfig();},1000);
  _ddsPaused=false;
  const pb=document.getElementById('btn-dds-pause');
  if(pb){pb.style.display='';pb.innerHTML='&#x23F8; Pause';pb.style.background='';}
}
function ddsPauseToggle(){
  if(!_ddsActive)return;
  _ddsPaused=!_ddsPaused;
  const pb=document.getElementById('btn-dds-pause');
  if(pb){
    pb.innerHTML=_ddsPaused?'&#x25B6; Resume':'&#x23F8; Pause';
    pb.style.background=_ddsPaused?'#f59e0b':'';
  }
  const st=document.getElementById('dds-status');
  if(st&&_ddsPaused){st.textContent='paused';st.style.color='#f59e0b';}
}
function ddsStop(){
  _ddsActive=false;
  _ddsPaused=false;
  _ddsPending=null;
  _ddsStopWorker();
  if(_ddsStatusPoll){clearInterval(_ddsStatusPoll);_ddsStatusPoll=null;}
  const pb=document.getElementById('btn-dds-pause');if(pb){pb.style.display='none';pb.style.background='';}
  _ddsLockFileUi(false);
  if(window._three&&window._three.exitLiveMode)window._three.exitLiveMode();
  document.getElementById('btn-dds').innerHTML='&#x1F4E1; DDS Live';
  document.getElementById('btn-dds').style.background='';
  document.getElementById('dds-status').textContent='off';
  document.getElementById('dds-status').style.color='#475569';
  setStatus('DDS stopped','ok');
}
// end DDS live
function setStatus(m,c){
  const e=document.getElementById('status');e.textContent=m;e.className=c||'';
  // 同时把状态消息打到 log 面板（去掉空消息和"loading"占位避免刷屏）
  if(m && m!==setStatus._last){
    setStatus._last=m;
    const lv=(c==='err')?'err':(c==='ok'?'ok':(c==='loading'||c==='warn'?'warn':'ui'));
    if(c!=='loading' || (m.length>4 && !/\.\.\.|\u2026/.test(m))) _logUI('status', m, lv);
  }
}
function onFileSelect(path){if(_ddsActive)return;_stopPlay();if(path)loadFile(path);}
async function refreshList(){const r=await fetch('/api/files');const d=await r.json();const sel=document.getElementById('file-select');sel.innerHTML='<option value="">&#8212; select file &#8212;</option>';d.files.forEach(f=>{const o=document.createElement('option');o.value=f;o.textContent=f;sel.appendChild(o);});_playFiles=d.files||[];_playTotal=_playFiles.length;const ts=document.getElementById('play-total');if(ts)ts.textContent=_playTotal;const sk=document.getElementById('play-seek');if(sk){sk.max=Math.max(0,_playTotal-1);sk.value=_playCur;}}
function _applyZRange(floats,nfields,fields){const zi=fields.indexOf('z');if(zi<0)return;const np=(floats.length/nfields)|0;let mn=Infinity,mx=-Infinity;for(let i=0;i<np;i++){const z=floats[i*nfields+zi];if(z<mn)mn=z;if(z>mx)mx=z;}const step=Math.max(0.01,parseFloat(((mx-mn)/200).toFixed(2)));['flt-zmin','flt-zmax'].forEach((id,ii)=>{const el=document.getElementById(id);if(el){el.min=mn.toFixed(2);el.max=mx.toFixed(2);el.step=step;el.value=ii===0?mn.toFixed(2):mx.toFixed(2);}});}
async function loadFile(path){
  if(!path)return;setStatus('loading…','loading');document.getElementById('overlay').style.display='none';
  try{
    const _t0=performance.now();
    const _fromCache=_frameCache.has(path)||_fetchPromises.has(path);
    const buf=await _fetchBuf('/api/pcd_binary?file='+encodeURIComponent(path),path);
    const _t1=performance.now();
    const{fields,npoints,nfields,original_count,fname,floats}=_parsePcdBuf(buf);
    const _t2=performance.now();
    window._three.loadPoints(floats,nfields,fields);
    const _t3=performance.now();
    if(npoints>0)_applyZRange(floats,nfields,fields);
    _tlogFrame(_t1-_t0,_t2-_t1,_t3-_t2,npoints,_fromCache,fname||path);
    document.getElementById('info').textContent=npoints.toLocaleString()+' pts'+(original_count!==npoints?' (↓'+original_count.toLocaleString()+')':'')+'  ·  '+(fname||path);setStatus('OK','ok');
  }catch(e){setStatus('fetch error','err');console.error(e);}
}
function updatePointSize(v){document.getElementById('pt-size-val').textContent=parseFloat(v).toFixed(1);window._three.setPointSize(parseFloat(v));window._three.setPickThreshold(parseFloat(v)*0.05);}
function applyColorMode(v){window._three.setColorMode(v);}function resetCamera(){window._three.resetCamera();}
function applyGrid(){
  const show=document.getElementById('grid-show').checked;
  const size=Math.max(1,parseFloat(document.getElementById('grid-size').value)||200);
  const step=Math.max(0.1,parseFloat(document.getElementById('grid-step').value)||1);
  const style=document.getElementById('grid-style')?.value||'square';
  const labelStep=Math.max(0.5,parseFloat(document.getElementById('grid-label-step')?.value)||10);
  const div=Math.max(1,Math.round(size/step));
  if(window._grid){window._grid.setStyle(style);window._grid.setLabelStep(labelStep);window._grid.setSize(size,div);window._grid.setVisible(show);}
}
function applyFlip(){const x=document.getElementById('flip-x').checked?-1:1,y=document.getElementById('flip-y').checked?-1:1,z=document.getElementById('flip-z').checked?-1:1;window._three.setFlip(x,y,z);}
let _dA=false,_pA=false,_lA=false,_eA=false;
function _da(e){if(e!=='draw'&&_dA){_dA=false;_sb('btn-draw',false);window._three.setDrawMode(false);}if(e!=='pick'&&_pA){_pA=false;_sb('btn-pick',false);window._three.setPickMode(false);}if(e!=='lasso'&&_lA){_lA=false;_sb('btn-lasso',false);window._three.setLassoMode(false);}if(e!=='eraser'&&_eA){_eA=false;_sb('btn-eraser',false);window._three.setEraserMode(false);}}
function exitAllModes(){
  if(_dA){_dA=false;_sb('btn-draw',false);window._three.setDrawMode(false);}
  if(_pA){_pA=false;_sb('btn-pick',false);window._three.setPickMode(false);}
  if(_lA){_lA=false;_sb('btn-lasso',false);window._three.setLassoMode(false);}
  if(_eA){_eA=false;_sb('btn-eraser',false);window._three.setEraserMode(false);}
  if(window._three){
    if(window._three.isFreeMode && window._three.isFreeMode())setView('3d');
    window._three.clearSelection();
  }
}
function toggleDraw(){if(_dA){exitAllModes();return;}_da('draw');_dA=true;window._three.setDrawMode(true);_sb('btn-draw',true);}
function togglePick(){if(_pA){exitAllModes();return;}_da('pick');_pA=true;window._three.setPickMode(true);_sb('btn-pick',true);}
function toggleLasso(){if(_lA){exitAllModes();return;}_da('lasso');_lA=true;window._three.setLassoMode(true);_sb('btn-lasso',true);}
function toggleEraser(){if(_eA){exitAllModes();return;}_da('eraser');_eA=true;window._three.setEraserMode(true);_sb('btn-eraser',true);}
function _sb(id,on){const btn=document.getElementById(id);if(!btn)return;const m={'btn-pick':['#059669','#d1fae5'],'btn-draw':['#d97706','#fef3c7'],'btn-lasso':['#7c3aed','#ede9fe'],'btn-eraser':['#ea580c','#ffedd5']};const[bg,fg]=m[id]||['#059669','#d1fae5'];btn.style.background=on?bg:'';btn.style.color=on?fg:'';}
function updateEraserRadius(v){document.getElementById('eraser-r-val').textContent=v;window._three._setEraserRadius(parseInt(v));}
function deleteSelected(){window._three.deleteSelected();}
function undoDelete(){window._three.undoDelete();}
function clearSelection(){window._three.clearSelection();}
async function savePcd(){
  const pts=window._three.getEditedPoints(),flds=window._three.getFields();if(!pts||!pts.length){alert('No points to save.');return;}
  const name=prompt('Save as (no extension):','edited_'+new Date().toISOString().slice(0,10));if(!name)return;
  setStatus('saving…','loading');
  try{const r=await fetch('/api/save_pcd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({points:pts,fields:flds,filename:name})});const d=await r.json();if(d.ok){setStatus('Saved: '+d.file,'ok');refreshList();}else setStatus('Save error: '+d.error,'err');}catch(e){setStatus('save error','err');console.error(e);}
}
function trajUndo(){window._three.undoWaypoint();}function trajClear(){window._three.clearWaypoints();}
function trajExport(){const pts=window._three.getWaypoints();if(!pts.length){alert('No waypoints.');return;}const a=document.createElement('a');a.href='data:application/json,'+encodeURIComponent(JSON.stringify({version:1,waypoints:pts},null,2));a.download='trajectory_'+new Date().toISOString().slice(0,19).replace(/:/g,'-')+'.json';a.click();}
function trajImport(input){const file=input.files[0];if(!file)return;const reader=new FileReader();reader.onload=e=>{try{const obj=JSON.parse(e.target.result);const pts=Array.isArray(obj)?obj:obj.waypoints;if(!pts||!pts.length){alert('No waypoints found.');return;}window._three.loadWaypoints(pts);}catch(err){alert('JSON parse error: '+err.message);}};reader.readAsText(file);input.value='';}
async function trajSaveServer(){const pts=window._three.getWaypoints();if(!pts.length){alert('No waypoints.');return;}const name=prompt('Filename:','traj_'+new Date().toISOString().slice(0,10));if(!name)return;const r=await fetch('/api/trajectory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1,waypoints:pts,name:name+'.json'})});const d=await r.json();if(d.ok){setStatus('Saved: '+d.file,'ok');refreshTrajList();}else setStatus('Save error: '+d.error,'err');}
async function refreshTrajList(){const r=await fetch('/api/trajectory');const d=await r.json();const sel=document.getElementById('traj-server-list');sel.innerHTML='<option value="">&#8212; server trajs &#8212;</option>';(d.files||[]).forEach(f=>{const o=document.createElement('option');o.value=f;o.textContent=f;sel.appendChild(o);});}
async function trajLoadServer(fname){if(!fname)return;const r=await fetch('/api/trajectory?file='+encodeURIComponent(fname));const d=await r.json();if(d.error){setStatus('Load error: '+d.error,'err');return;}const pts=Array.isArray(d)?d:d.waypoints;if(!pts){setStatus('No waypoints in file','err');return;}window._three.loadWaypoints(pts);setStatus('Loaded: '+fname,'ok');}
function wpDelete(idx){window._three.deleteWaypointAt(idx);}function hideWpPopup(){document.getElementById('wp-popup').style.display='none';}
let _fm='keep';function setFilterMode(m){_fm=m;document.getElementById('flt-keep').classList.toggle('active',m==='keep');document.getElementById('flt-excl').classList.toggle('active',m==='exclude');applyHeightFilter();}
function applyHeightFilter(){if(!window._three||!window._three.hasCloud())return;const zMin=parseFloat(document.getElementById('flt-zmin').value),zMax=parseFloat(document.getElementById('flt-zmax').value);if(isNaN(zMin)||isNaN(zMax)||zMin>=zMax)return;window._three.applyFilter(zMin,zMax,_fm);setStatus('Filter: '+_fm+' ['+zMin.toFixed(2)+', '+zMax.toFixed(2)+']','ok');}
function resetHeightFilter(){window._three.resetFilter();setStatus('Filter reset','ok');}
function setView(p){window._three.setView(p);['3d','top','front','left'].forEach(v=>{const b=document.getElementById('view-'+v);if(b)b.classList.toggle('active',v===p);});const fb=document.getElementById('view-free');if(fb)fb.classList.toggle('active',p==='free');}
// keyboard shortcuts: p/P → 3D, t/T → Top
document.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.altKey||e.metaKey)return;
  const t=e.target,tn=t&&t.tagName;
  if(tn==='INPUT'||tn==='TEXTAREA'||tn==='SELECT'||(t&&t.isContentEditable))return;
  const k=e.key.toLowerCase();
  if(k==='p'){e.preventDefault();setView('3d');}
  else if(k==='t'){e.preventDefault();setView('top');}
  else if(k==='f'){e.preventDefault();setView(window._three && window._three.isFreeMode && window._three.isFreeMode()?'3d':'free');}
});
// ── Directory browser ──────────────────────────────────────────────────────
let _browseDir='';
async function browseDir(dir){
  try{
    const r=await fetch('/api/browse?dir='+encodeURIComponent(dir||''));
    const d=await r.json();
    if(d.error&&!d.items.length){setStatus('Browse: '+d.error,'err');return;}
    _browseDir=d.cwd;
    const inp=document.getElementById('dir-path-input');if(inp)inp.value=d.cwd;
    const cwdEl=document.getElementById('dir-modal-cwd');if(cwdEl)cwdEl.textContent=d.cwd;
    const el=document.getElementById('dir-list');if(!el)return;el.innerHTML='';
    d.items.forEach(item=>{
      const div=document.createElement('div');
      div.className='dir-item '+(item.type==='dir'?'is-dir':'is-pcd');
      div.title=item.path;
      div.textContent=(item.type==='dir'?'\u25b8 ':'')+item.name;
      div.onclick=()=>{if(item.type==='dir')browseDir(item.path);else{_stopPlay();loadFileAbs(item.path);}};
      el.appendChild(div);
    });
  }catch(e){setStatus('Browse error','err');console.error(e);}
}
function browseUp(){if(_browseDir)browseDir(_browseDir+'/..');}
function browseDirInput(){const v=(document.getElementById('dir-path-input')||{}).value||'';if(v.trim())browseDir(v.trim());}
async function pickFileNative(){
  setStatus('opening file picker\u2026','loading');
  try{
    const r=await fetch('/api/pick_file?dir='+encodeURIComponent(_browseDir||''));
    const d=await r.json();
    if(d.error){setStatus('Picker: '+d.error,'err');return;}
    if(!d.path){setStatus('cancelled','idle');return;}
    _browseDir=d.data_dir||'';
    _stopPlay();
    _frameCache.clear(); _fetchPromises.clear();
    // refresh dropdown so the picked file's directory is reflected
    await refreshList();
    if(d.fname){
      const sel=document.getElementById('file-select');
      if(sel){
        for(let i=0;i<sel.options.length;i++){if(sel.options[i].value===d.fname){sel.selectedIndex=i;break;}}
      }
    }
    loadFileAbs(d.path);
  }catch(e){setStatus('Picker error','err');console.error(e);}
}
async function pickDirNative(){
  setStatus('opening picker\u2026','loading');
  try{
    const r=await fetch('/api/pick_dir?dir='+encodeURIComponent(_browseDir||''));
    const d=await r.json();
    if(d.error){setStatus('Picker: '+d.error,'err');return;}
    if(!d.path){setStatus('cancelled','idle');return;}
    _browseDir=d.data_dir||d.path;
    _frameCache.clear(); _fetchPromises.clear();
    setStatus('listing '+_browseDir+'\u2026','loading');
    const cwdEl=document.getElementById('dir-modal-cwd'); if(cwdEl) cwdEl.textContent=_browseDir;
    // 直接走 /api/files 拿文件列表（与下拉框同源），省掉一次 /api/browse 往返
    await refreshList();
    if(_playFiles && _playFiles.length){
      const sel=document.getElementById('file-select');
      if(sel&&sel.options.length>1){sel.selectedIndex=1;}
      setStatus('switched to '+_browseDir+' ('+_playFiles.length+' pcd)','ok');
      // 第一个文件用相对路径加载（与下拉框 onFileSelect 一致）
      loadFile(_playFiles[0]);
    }else{
      setStatus('switched dir, no .pcd here','warn');
      browseDir(_browseDir);
      const el=document.getElementById('dir-modal-overlay');if(el)el.classList.add('open');
    }
  }catch(e){setStatus('Picker error','err');console.error(e);}
}
async function openInExplorer(){
  if(!_browseDir){setStatus('no directory','err');return;}
  try{
    const r=await fetch('/api/open_in_explorer?dir='+encodeURIComponent(_browseDir));
    const d=await r.json();
    if(!d.ok)setStatus('Explorer: '+(d.error||'fail'),'err');
  }catch(e){setStatus('Explorer error','err');console.error(e);}
}
function openDirModal(){const el=document.getElementById('dir-modal-overlay');if(!el)return;el.classList.add('open');if(!_browseDir)browseDir('');}
function closeDirModal(){const el=document.getElementById('dir-modal-overlay');if(el)el.classList.remove('open');}
async function loadFileAbs(absPath){
  if(!absPath)return;setStatus('loading\u2026','loading');closeDirModal();document.getElementById('overlay').style.display='none';
  try{
    const _t0=performance.now();
    const _fromCache=_frameCache.has(absPath)||_fetchPromises.has(absPath);
    const buf=await _fetchBuf('/api/pcd_abs?file='+encodeURIComponent(absPath),absPath);
    const _t1=performance.now();
    const{fields,npoints,nfields,original_count,fname,floats}=_parsePcdBuf(buf);
    const _t2=performance.now();
    window._three.loadPoints(floats,nfields,fields);
    const _t3=performance.now();
    if(npoints>0)_applyZRange(floats,nfields,fields);
    _tlogFrame(_t1-_t0,_t2-_t1,_t3-_t2,npoints,_fromCache,fname||absPath.split(/[\\/]/).pop());
    document.getElementById('info').textContent=npoints.toLocaleString()+' pts'+(original_count!==npoints?' (\u2193'+original_count.toLocaleString()+')':'')+'  \u00b7  '+(fname||absPath.split(/[\\/]/).pop());setStatus('OK','ok');
  }catch(e){setStatus('fetch error','err');console.error(e);}
}
refreshList();refreshTrajList();ddsRefreshReceiverConfig();

// ── Drag & drop .pcd files / folders onto the 3D canvas ─────────────────────────────
(function(){
  const wrap=document.getElementById('canvas-wrap');
  const ov=document.createElement('div');
  ov.id='drop-ov';
  ov.style.cssText='position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(14,116,144,.18);border:3px dashed #22d3ee;color:#cffafe;font-size:1.1rem;font-weight:600;pointer-events:none;z-index:30;text-align:center;padding:20px;text-shadow:0 1px 4px #000';
  ov.innerHTML='\u2935\ufe0f  Drop .pcd file(s) or folder to load';
  wrap.appendChild(ov);
  let _depth=0;
  function show(on){ov.style.display=on?'flex':'none';}
  wrap.addEventListener('dragenter',e=>{e.preventDefault();_depth++;show(true);});
  wrap.addEventListener('dragover', e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';});
  wrap.addEventListener('dragleave',e=>{e.preventDefault();_depth=Math.max(0,_depth-1);if(_depth===0)show(false);});

  // recursively traverse a webkit FileSystem entry, collecting {file, relpath} for every .pcd
  function _readEntries(reader){return new Promise((res,rej)=>reader.readEntries(res,rej));}
  async function _walkEntry(entry, prefix, out){
    if(entry.isFile){
      if(!entry.name.toLowerCase().endsWith('.pcd'))return;
      const file=await new Promise((res,rej)=>entry.file(res,rej));
      out.push({file, relpath: prefix?prefix+'/'+entry.name:entry.name});
      return;
    }
    if(entry.isDirectory){
      const reader=entry.createReader();
      let batch;
      do{ batch=await _readEntries(reader);
        for(const ent of batch){ await _walkEntry(ent, prefix?prefix+'/'+entry.name:entry.name, out); }
      }while(batch && batch.length);
    }
  }

  wrap.addEventListener('drop', async e=>{
    e.preventDefault();_depth=0;show(false);
    // collect: prefer DataTransferItem entries (supports folders), fall back to plain files
    const collected=[]; // {file, relpath}
    const items=e.dataTransfer.items?[...e.dataTransfer.items]:[];
    if(items.length && items[0].webkitGetAsEntry){
      try{
        const entries=items.map(it=>it.webkitGetAsEntry()).filter(Boolean);
        for(const ent of entries){ await _walkEntry(ent, '', collected); }
      }catch(err){console.error('walk error',err);}
    }
    if(!collected.length){
      // fallback: plain files only
      for(const f of (e.dataTransfer.files||[])){
        if(f.name.toLowerCase().endsWith('.pcd')) collected.push({file:f, relpath:f.name});
      }
    }
    if(!collected.length){setStatus('drop ignored: no .pcd files','warn');return;}
    setStatus('uploading '+collected.length+' file'+(collected.length>1?'s':'')+'\u2026','loading');
    _stopPlay();
    let firstRel='', okN=0;
    for(const {file, relpath} of collected){
      try{
        const r=await fetch('/api/upload_pcd',{method:'POST',
          headers:{
            'X-Filename':encodeURIComponent(file.name),
            'X-Relpath' :encodeURIComponent(relpath),
            'Content-Type':'application/octet-stream'},
          body:file});
        const d=await r.json();
        if(d.ok){okN++; if(!firstRel)firstRel=d.file;}
        else setStatus('upload error: '+(d.error||'?'),'err');
      }catch(err){console.error(err);setStatus('upload failed','err');}
    }
    if(!firstRel)return;
    _frameCache.clear(); _fetchPromises.clear();
    await refreshList();
    const sel=document.getElementById('file-select');
    if(sel){
      for(let i=0;i<sel.options.length;i++){if(sel.options[i].value===firstRel){sel.selectedIndex=i;break;}}
    }
    setStatus('uploaded '+okN+' \u2192 '+firstRel,'ok');
    loadFile(firstRel);
  });
})();
// ── Sidebar resize & collapse ────────────────────────────────────────────────
const _sidebar=document.getElementById('sidebar');
const _handle=document.getElementById('resize-handle');
const _toggle=document.getElementById('sidebar-toggle');
let _sidebarW=280,_collapsed=false;
function toggleSidebar(){
  _collapsed=!_collapsed;
  if(_collapsed){_sidebar.classList.add('collapsed');_sidebar.style.width='';_toggle.innerHTML='&#9654;';_handle.style.cursor='default';}
  else{_sidebar.classList.remove('collapsed');_sidebar.style.width=_sidebarW+'px';_toggle.innerHTML='&#9664;';_handle.style.cursor='col-resize';}
}
// drag-to-resize
_handle.addEventListener('mousedown',e=>{
  if(_collapsed)return;
  e.preventDefault();
  _handle.classList.add('dragging');
  const startX=e.clientX,startW=_sidebar.offsetWidth;
  function onMove(e){
    const w=Math.max(140,Math.min(600,startW+(e.clientX-startX)));
    _sidebarW=w;_sidebar.style.width=w+'px';
    if(window._three&&window._three.resize)window._three.resize();
  }
  function onUp(){_handle.classList.remove('dragging');document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);}
  document.addEventListener('mousemove',onMove);
  document.addEventListener('mouseup',onUp);
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape')closeDirModal();
  const tag=document.activeElement.tagName;
  if(tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA')return;
  if(e.key==='b'||e.key==='B')toggleSidebar();
  if(e.key==='l'||e.key==='L')toggleLogPanel();
});
