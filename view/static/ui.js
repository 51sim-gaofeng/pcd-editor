// 鈹€鈹€ Timing log & log panel 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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
}
function clearLog(){const el=document.getElementById('log-entries');if(el)el.innerHTML='';}

// 鈹€鈹€ Generic UI activity log 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// 鎶婃墍鏈夌敤鎴锋搷浣?/ 鐘舵€佸彉鍖栭兘璁板綍鍒板彸涓嬭 log 闈㈡澘
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
// 鑷姩鎹曡幏鎵€鏈変晶鏍忔寜閽偣鍑?/ select 鍙樺寲 / checkbox 鍒囨崲 / range/number 杈撳叆
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
  // range slider 鍦ㄦ澗寮€鏃惰涓€娆★紙閬垮厤鎷栧姩鍒峰睆锛?
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
// 鈹€鈹€ Log panel drag-to-resize 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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
// 鈹€鈹€ Frame cache & prefetch 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
const _frameCache=new Map();
const _fetchPromises=new Map();  // in-flight fetch promises 鈥?shared by prefetch & loadFile
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
// 鈹€鈹€ Playback engine 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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
function pcdSetMaxPointsFromUI(v){
  const n=Math.max(10000,Math.min(1000000,Math.round((parseInt(v,10)||300000)/1000)*1000));
  const el=document.getElementById('pcd-max-pts');if(el&&parseInt(el.value,10)!==n)el.value=n;
  const val=document.getElementById('pcd-max-pts-val');if(val)val.textContent=Math.round(n/1000)+'k';
  fetch('/api/pcd_set_max_points?n='+n).catch(()=>{});
  // Backend cache is keyed by max_pts, but the browser-side frame cache isn't — clear it so
  // subsequent loads (including the current playback loop's next frame) re-fetch fresh data
  // instead of serving a stale binary from before the change.
  _frameCache.clear();_fetchPromises.clear();
  setStatus('PCD max points: '+n.toLocaleString(),'ok');
  if(!_playRunning){
    const sel=document.getElementById('file-select');
    if(sel&&sel.value)loadFile(sel.value);
  }
}
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
  const tabGs=document.getElementById('tab-gs');
  if(tabGs&&tabGs.classList.contains('active'))return;
  const tag=document.activeElement.tagName;
  if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
  if(_ddsActive){
    if(e.key===' '){ddsPauseToggle();e.preventDefault();}
    return;
  }
  if(_smActive){
    if(e.key===' '){streamingPauseToggle();e.preventDefault();}
    return;
  }
  if(e.key==='ArrowLeft'){playStep(-1);e.preventDefault();}
  else if(e.key==='ArrowRight'){playStep(1);e.preventDefault();}
  else if(e.key===' '){playToggle();e.preventDefault();}
});
// end playback
// 鈹€鈹€ DDS Live mode 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
let _ddsActive=false,_ddsLastId=-1,_ddsStatusPoll=null,_ddsPaused=false;
// 鏈€鏂版敹鍒颁絾灏氭湭娓叉煋鐨勫抚锛坒etch 鍐欏叆锛宺AF 娑堣垂锛?
let _ddsPending=null; // {floats, nfields, fields, fid, npoints} | null
// Foxglove 椋庢牸锛氭覆鏌撻绠楋紙鍥哄畾甯х巼涓婇檺锛? 鑷€傚簲鐐规暟棰勭畻
let _ddsRenderFpsCap=20,_ddsRenderMinInterval=1000/20,_ddsLastRenderAt=0;
let _ddsAdaptive=true,_ddsRenderMsEwma=0,_ddsAdaptCooldownUntil=0;
let _ddsCurrentMaxPoints=1000000,_ddsAutoMinPoints=10000,_ddsAutoMaxPoints=1000000;
let _ddsLastUiStatusAt=0,_ddsLastZRangeAt=0;
let _ddsLastUiStatusFid=-1,_ddsLastUiStatusTs=0;
let _ddsFetchedCount=0,_ddsRenderedCount=0,_ddsOverwrittenCount=0;
let _ddsLastFetchedCount=0,_ddsLastRenderedCount=0,_ddsLastOverwrittenCount=0;
let _ddsWorkerParseMsTotal=0,_ddsLastWorkerParseMsTotal=0;
let _ddsTransitMsTotal=0,_ddsLastTransitMsTotal=0,_ddsTransitSamples=0,_ddsLastTransitSamples=0;
let _ddsWorkerOpenCount=0,_ddsWorkerCloseCount=0;
let _ddsWorker=null;
// FPS meter锛堟覆鏌撲晶锛?
let _ddsFpsCnt=0,_ddsFpsT0=performance.now(),_ddsFpsLast='';
function _ddsFpsTick(){
  _ddsFpsCnt++;
  const now=performance.now(),dt=now-_ddsFpsT0;
  if(dt>=1000){_ddsFpsLast=(_ddsFpsCnt*1000/dt).toFixed(1)+' fps';_ddsFpsCnt=0;_ddsFpsT0=now;}
}
function _ddsRoundPts(v){return Math.max(_ddsAutoMinPoints,Math.min(_ddsAutoMaxPoints,Math.round(v/1000)*1000));}
function _ddsSetMaxPoints(n,silent){
  let raw=Math.max(10000,Math.min(1000000,parseInt(n,10)||_ddsCurrentMaxPoints));
  if(!silent)_ddsAutoMaxPoints=raw;   // user-driven change becomes the new adaptive ceiling
  const v=_ddsRoundPts(raw);
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
  // 鐣?5% 浣欓噺锛岄伩鍏嶄笌婧愬抚鐜?(渚嬪 10 fps) 涓寸晫瀵归綈鏃跺洜鎶栧姩婕忓抚 鈫?瀹炴祴 9 fps銆?
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
  // Build WS URL from backend-reported bind host first; fall back to page host.
  // Browsers cannot connect to 0.0.0.0 / ::, so remap those to a concrete host.
  let wsHost=((wsCfg&&wsCfg.host)||'').toString().trim();
  if(!wsHost||wsHost==='0.0.0.0'||wsHost==='::'||wsHost==='[::]'){
    wsHost=(location.hostname&&location.hostname!=='0.0.0.0')?location.hostname:'127.0.0.1';
  }
  const wsUrl=wsProto+'://'+wsHost+':'+(wsCfg.port||9090);
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
      const code=(typeof data.code==='number')?(' code='+data.code):'';
      const reason=(data.reason&&data.reason.length)?(' '+data.reason):'';
      _logUI('dds-ws', 'closed; reconnecting'+code+reason, 'warn');
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
      st.textContent='udp: '+(d.host||'255.255.255.255')+':'+(d.port||9870)+(d.running?' (running)':' (stopped)')+src+'  |  ws: '+location.hostname+':'+(s.port||9090)+(s.running?' (running)':' (stopped)');
    }
  }catch(e){
    const st=document.getElementById('dds-bind-status');if(st)st.textContent='bind: read failed';
  }
}
async function ddsApplyReceiverConfig(){
  const ip=(document.getElementById('dds-bind-ip')?.value||'127.0.0.1').trim()||'127.0.0.1';
  const port=parseInt(document.getElementById('dds-bind-port')?.value||'13956',10);
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
// rAF 椹卞姩鐨勬覆鏌撳惊鐜細鍙秷璐?_ddsPending锛屼笌 fetch 瀹屽叏瑙ｈ€?
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
  requestAnimationFrame(_ddsRenderTick); // 鍚姩娓叉煋寰幆
  _ddsStartWorker();                     // 鍚姩 worker WebSocket 鎷夋祦/瑙ｆ瀽
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
// ── Streaming Live mode ──────────────────────────────────────────────────────────────────────────
let _smActive=false,_smLastId=-1,_smStatusPoll=null,_smPaused=false;
let _smPending=null;
let _smRenderFpsCap=10,_smRenderMinInterval=1000/10,_smLastRenderAt=0;
let _smCurrentMaxPoints=60000;
let _smFpsCnt=0,_smFpsT0=performance.now(),_smFpsLast='';
let _smRenderMsEwma=0,_smAdaptCooldownUntil=0,_smLastZRangeAt=0,_smLastUiStatusAt=0,_smLastUiStatusTs=0;
let _smAutoMinPoints=10000,_smAutoMaxPoints=1000000,_smAdaptive=true;
// Streaming performance metrics
let _smFetchedCnt=0,_smFetchedLast=0,_smFetchHz='0.0';
let _smRenderedCnt=0,_smRenderedLast=0,_smRenderHz='0.0';
let _smLastPollMs=0,_smLastParseMs=0,_smLastRenderMs=0;
function _smFpsTick(){
  _smFpsCnt++;
  const now=performance.now(),dt=now-_smFpsT0;
  if(dt>=1000){_smFpsLast=(_smFpsCnt*1000/dt).toFixed(1)+' fps';_smFpsCnt=0;_smFpsT0=now;}
}
function _smSetMaxPoints(n,silent){
  const v=Math.max(10000,Math.min(1000000,Math.round((parseInt(n,10)||60000)/1000)*1000));
  _smCurrentMaxPoints=v;
  if(!silent)_smAutoMaxPoints=v;   // user-driven change becomes the new adaptive ceiling
  const el=document.getElementById('streaming-max-pts');if(el&&parseInt(el.value,10)!==v)el.value=v;
  const val=document.getElementById('streaming-max-pts-val');if(val)val.textContent=Math.round(v/1000)+'k';
  fetch('/api/streaming_set_max_points?n='+v).catch(()=>{});
  if(!silent)setStatus('Streaming max points: '+v.toLocaleString(),'ok');
}
function streamingSetMaxPointsFromUI(v){_smSetMaxPoints(v,false);}
function streamingSetRenderFpsFromUI(v){
  const fps=Math.max(1,Math.min(30,parseInt(v,10)||10));
  _smRenderFpsCap=fps;
  _smRenderMinInterval=(1000/fps)*0.95;
  const el=document.getElementById('streaming-render-fps-val');if(el)el.textContent=String(fps);
}
function _smRoundPts(v){return Math.max(_smAutoMinPoints,Math.min(_smAutoMaxPoints,Math.round(v/1000)*1000));}
function _smAdaptiveBudget(renderMs){
  _smLastRenderMs=renderMs;
  _smRenderMsEwma=_smRenderMsEwma>0?(_smRenderMsEwma*0.85+renderMs*0.15):renderMs;
  const now=performance.now();
  if(!_smAdaptive||now<_smAdaptCooldownUntil)return;
  if(_smRenderMsEwma>40&&_smCurrentMaxPoints>_smAutoMinPoints){
    const oldPts=_smCurrentMaxPoints;
    _smSetMaxPoints(Math.max(_smAutoMinPoints,Math.floor(_smCurrentMaxPoints*0.8)),true);
    _smAdaptCooldownUntil=now+1400;
    const msg='Streaming: cpu slow ('+_smRenderMsEwma.toFixed(1)+'ms) reduce pts '+oldPts+' → '+_smCurrentMaxPoints;
    setStatus(msg,'warn');
    return;
  }
  if(_smRenderMsEwma<18&&_smCurrentMaxPoints<_smAutoMaxPoints){
    const oldPts=_smCurrentMaxPoints;
    _smSetMaxPoints(Math.min(_smAutoMaxPoints,Math.floor(_smCurrentMaxPoints*1.1)),true);
    _smAdaptCooldownUntil=now+2200;
    const msg='Streaming: cpu fast ('+_smRenderMsEwma.toFixed(1)+'ms) increase pts '+oldPts+' → '+_smCurrentMaxPoints;
    setStatus(msg,'ok');
  }
}
let _smPollAbort=null;
async function _smStartPoll(){
  if(_smPollAbort){_smPollAbort.abort();_smPollAbort=null;}
  try{await fetch('/api/streaming_ensure');}catch(e){}
  const ac=new AbortController();
  _smPollAbort=ac;
  (async()=>{
    while(_smActive&&!ac.signal.aborted){
      try{
        const pollStart=performance.now();
        const r=await fetch('/api/streaming_frame?after_id='+_smLastId,{signal:ac.signal});
        _smLastPollMs=performance.now()-pollStart;
        if(!_smActive||ac.signal.aborted)break;
        if(r.status===204){
          // No new data: sleep briefly to avoid aggressive polling
          await new Promise(res=>setTimeout(res,50));
          continue;
        }
        if(!r.ok){await new Promise(res=>setTimeout(res,200));continue;}
        const parseStart=performance.now();
        const buf=await r.arrayBuffer();
        if(buf.byteLength<20)continue;
        const dv=new DataView(buf);
        // verify 'PCL2' magic
        if(dv.getUint8(0)!==80||dv.getUint8(1)!==67||dv.getUint8(2)!==76||dv.getUint8(3)!==50)continue;
        const fid=dv.getUint32(4,true);
        const npoints=dv.getUint32(8,true);
        const floats=new Float32Array(buf,20,npoints*4);
        _smLastParseMs=performance.now()-parseStart;
        _smLastId=fid;
        _smFetchedCnt++;
        _smPending={floats,nfields:4,fields:['x','y','z','intensity'],fid,npoints};
      }catch(e){
        if(!_smActive||ac.signal.aborted||e.name==='AbortError')break;
        await new Promise(res=>setTimeout(res,300));
      }
    }
  })();
}
function _smStopPoll(){
  if(_smPollAbort){_smPollAbort.abort();_smPollAbort=null;}
}
async function streamingRefreshReceiverConfig(){
  try{
    const rc=await fetch('/api/streaming_receiver_config');
    const r=await rc.json();
    const ip=document.getElementById('streaming-bind-ip');if(ip&&r.host)ip.value=r.host;
    const pt=document.getElementById('streaming-bind-port');if(pt&&r.port)pt.value=r.port;
    const ip2=document.getElementById('streaming-info-port');if(ip2&&r.info_port)ip2.value=r.info_port;
    const st=document.getElementById('streaming-bind-status');
    if(st)st.textContent='bind: '+(r.host||'?')+':'+(r.port||'?')+' | info: '+(r.info_port||'?')+(r.src_host?' | src: '+r.src_host:'');
  }catch(e){
    const st=document.getElementById('streaming-bind-status');if(st)st.textContent='bind: read failed';
  }
  _smRefreshDiag();
}
// Pull the server-side pipeline diagnostics (network scan rate, packet loss,
// decode-queue drops, decode/store timing) so a fps shortfall can be traced
// to the layer actually responsible instead of guessed at.
async function _smRefreshDiag(){
  const el=document.getElementById('streaming-diag-status');
  if(!el)return;
  try{
    const rs=await fetch('/api/streaming_status');
    const s=await rs.json();
    const d=s.diag||{};
    if(!d.updated_at){el.textContent='diag: waiting for data…';return;}
    const lossPct=d.avg_scan_pkts>0?((d.missing_pkts_per_sec/(d.pkt_hz||1))*100):0;
    const lossWarn=d.missing_pkts_per_sec>0.5?' \u26a0':'';
    const dropWarn=d.queue_drop_per_sec>0.5?' \u26a0':'';
    el.innerHTML=
      'net: '+d.scan_hz.toFixed(1)+' scan/s ('+d.pkt_hz.toFixed(0)+' pkt/s, avg '+d.avg_scan_pkts.toFixed(0)+' pkt/scan)'
      +'<br>loss: '+d.missing_pkts_per_sec.toFixed(1)+' pkt/s'+lossWarn
      +' · queue: depth '+d.queue_depth+', drop '+d.queue_drop_per_sec.toFixed(1)+'/s'+dropWarn
      +'<br>decode: '+d.decode_hz.toFixed(1)+'/s, '+d.decode_avg_ms.toFixed(1)+'ms decode + '+d.store_avg_ms.toFixed(1)+'ms store';
  }catch(e){/* ignore transient poll errors */}
}
async function streamingApplyReceiverConfig(){
  const ip=(document.getElementById('streaming-bind-ip')?.value||'127.0.0.1').trim()||'127.0.0.1';
  const port=parseInt(document.getElementById('streaming-bind-port')?.value||'6699',10);
  const infoPort=parseInt(document.getElementById('streaming-info-port')?.value||'7788',10);
  if(!(port>=1&&port<=65535)){setStatus('Streaming receiver port invalid','err');return;}
  if(!(infoPort>=1&&infoPort<=65535)){setStatus('Streaming info port invalid','err');return;}
  try{
    const r=await fetch('/api/streaming_rebind?ip='+encodeURIComponent(ip)+'&port='+port+'&info_port='+infoPort);
    const d=await r.json();
    if(!d.ok){setStatus('Streaming rebind failed: '+(d.error||'unknown'),'err');return;}
    const st=document.getElementById('streaming-bind-status');
    if(st)st.textContent='bind: '+d.host+':'+d.port+' | info: '+(d.info_port||infoPort);
    setStatus('Streaming receiver bound to '+d.host+':'+d.port+' info:'+infoPort,'ok');
    streamingRefreshReceiverConfig();
  }catch(e){setStatus('Streaming rebind error','err');}
}
function _smRenderTick(){
  if(!_smActive)return;
  if(_smPaused){requestAnimationFrame(_smRenderTick);return;}
  const now=performance.now();
  if(now-_smLastRenderAt<_smRenderMinInterval){requestAnimationFrame(_smRenderTick);return;}
  if(_smPending){
    const{floats,nfields,fields,fid,npoints}=_smPending;
    _smPending=null;
    const r0=performance.now();
    if(window._three&&window._three.updateLive)window._three.updateLive(floats,nfields,fields);
    else window._three.loadPoints(floats,nfields,fields);
    // Z range UI update at low frequency to avoid per-frame overhead (same as DDS pattern)
    if(npoints>0&&now-_smLastZRangeAt>=800){_applyZRange(floats,nfields,fields);_smLastZRangeAt=now;}
    _smLastRenderAt=now;
    _smAdaptiveBudget(performance.now()-r0);
    _smRenderedCnt++;
    _smFpsTick();
    // Throttle UI status update to 1000ms interval (avoid per-frame DOM thrashing)
    if(now-_smLastUiStatusAt>=1000){
      const dt=Math.max(1,now-_smLastUiStatusTs);
      const fetchDelta=_smFetchedCnt-_smFetchedLast;
      const renderDelta=_smRenderedCnt-_smRenderedLast;
      const fetchHz=((fetchDelta*1000)/dt).toFixed(1);
      const renderHz=((renderDelta*1000)/dt).toFixed(1);
      _smFetchHz=fetchHz;_smRenderHz=renderHz;
      const fpsStr=_smFpsLast?' · '+_smFpsLast:'';
      const avgRenderMs=_smRenderMsEwma.toFixed(1);
      const budgetStatus=(_smRenderMsEwma>40)?'⚠ slow':'✓ ok';
      const statusMsg='frame '+fid+' · '+npoints.toLocaleString()+' pts'+fpsStr+' (recv:'+fetchHz+'/s render:'+renderHz+'/s cpu:'+avgRenderMs+'ms '+budgetStatus+')';
      document.getElementById('streaming-status').textContent=statusMsg;
      document.getElementById('streaming-status').style.color='#a78bfa';
      document.getElementById('info').textContent=npoints.toLocaleString()+' pts  ·  Streaming #'+fid+' ('+_smCurrentMaxPoints.toLocaleString()+'pts max)';
      _smLastUiStatusAt=now;
      _smLastUiStatusTs=now;
      _smFetchedLast=_smFetchedCnt;
      _smRenderedLast=_smRenderedCnt;
    }
  }
  requestAnimationFrame(_smRenderTick);
}
function _smLockFileUi(on){
  ['sec-file','sec-play'].forEach(id=>{
    const el=document.getElementById(id);if(!el)return;
    el.classList.toggle('dds-locked',!!on);
    if(on)el.removeAttribute('open');
  });
}
let _smPrevColorMode=null;
async function streamingToggle(){
  if(_smActive){streamingStop();return;}
  _smActive=true;_smLastId=-1;_smPending=null;_smFpsCnt=0;_smFpsT0=performance.now();_smFpsLast='';
  _smLastRenderAt=0;_smRenderMsEwma=0;_smAdaptCooldownUntil=0;_smLastZRangeAt=0;_smLastUiStatusAt=0;_smLastUiStatusTs=0;
  _smFetchedCnt=0;_smFetchedLast=0;_smRenderedCnt=0;_smRenderedLast=0;_smLastPollMs=0;_smLastParseMs=0;_smLastRenderMs=0;
  _stopPlay();
  _smLockFileUi(true);
  // Switch to intensity color mode, remembering the previous mode for restore on stop.
  const cmSel=document.getElementById('color-mode');
  _smPrevColorMode=cmSel?cmSel.value:'height';
  if(cmSel)cmSel.value='intensity';
  if(window._three&&window._three.setColorMode)window._three.setColorMode('intensity');
  const _ovl=document.getElementById('overlay');if(_ovl)_ovl.style.display='none';
  document.getElementById('btn-streaming').innerHTML='&#x23F9; Streaming Stop';
  document.getElementById('btn-streaming').style.background='#7c3aed';
  document.getElementById('streaming-status').textContent='connecting\u2026';
  document.getElementById('streaming-status').style.color='#facc15';
  streamingSetRenderFpsFromUI(document.getElementById('streaming-render-fps')?.value||'10');
  _smSetMaxPoints(document.getElementById('streaming-max-pts')?.value||60000,true);
  setStatus('Streaming: waiting for frames\u2026','loading');
  requestAnimationFrame(_smRenderTick);
  _smStartPoll();
  if(_smStatusPoll)clearInterval(_smStatusPoll);
  _smStatusPoll=setInterval(()=>{if(_smActive)streamingRefreshReceiverConfig();},1000);
  _smPaused=false;
  const pb=document.getElementById('btn-streaming-pause');
  if(pb){pb.style.display='';pb.innerHTML='&#x23F8; Pause';pb.style.background='';}
}
function streamingPauseToggle(){
  if(!_smActive)return;
  _smPaused=!_smPaused;
  const pb=document.getElementById('btn-streaming-pause');
  if(pb){pb.innerHTML=_smPaused?'&#x25B6; Resume':'&#x23F8; Pause';pb.style.background=_smPaused?'#f59e0b':'';}
  const st=document.getElementById('streaming-status');
  if(st&&_smPaused){st.textContent='paused';st.style.color='#f59e0b';}
}
function streamingStop(){
  _smActive=false;
  _smPaused=false;
  _smPending=null;
  _smLastRenderAt=0;_smRenderMsEwma=0;_smAdaptCooldownUntil=0;_smLastZRangeAt=0;_smLastUiStatusAt=0;
  _smFetchedCnt=0;_smFetchedLast=0;_smRenderedCnt=0;_smRenderedLast=0;
  _smStopPoll();
  if(_smStatusPoll){clearInterval(_smStatusPoll);_smStatusPoll=null;}
  const pb=document.getElementById('btn-streaming-pause');if(pb){pb.style.display='none';pb.style.background='';}
  _smLockFileUi(false);
  if(window._three&&window._three.exitLiveMode)window._three.exitLiveMode();
  // Restore color mode that was active before streaming started.
  if(_smPrevColorMode){
    const cmSel=document.getElementById('color-mode');
    if(cmSel)cmSel.value=_smPrevColorMode;
    if(window._three&&window._three.setColorMode)window._three.setColorMode(_smPrevColorMode);
    _smPrevColorMode=null;
  }
  document.getElementById('btn-streaming').innerHTML='&#x1F4E1; Streaming Live';
  document.getElementById('btn-streaming').style.background='';
  document.getElementById('streaming-status').textContent='off';
  document.getElementById('streaming-status').style.color='#475569';
  setStatus('Streaming stopped','ok');
}
// end Streaming live
function setStatus(m,c){
  const e=document.getElementById('status');e.textContent=m;e.className=c||'';
  // 鍚屾椂鎶婄姸鎬佹秷鎭墦鍒?log 闈㈡澘锛堝幓鎺夌┖娑堟伅鍜?loading"鍗犱綅閬垮厤鍒峰睆锛?
  if(m && m!==setStatus._last){
    setStatus._last=m;
    const lv=(c==='err')?'err':(c==='ok'?'ok':(c==='loading'||c==='warn'?'warn':'ui'));
    if(c!=='loading' || (m.length>4 && !/\.\.\.|\u2026/.test(m))) _logUI('status', m, lv);
  }
}
function onFileSelect(path){if(_ddsActive||_smActive)return;_stopPlay();if(path)loadFile(path);}
async function refreshList(){const r=await fetch('/api/files');const d=await r.json();const sel=document.getElementById('file-select');sel.innerHTML='<option value="">&#8212; select file &#8212;</option>';d.files.forEach(f=>{const o=document.createElement('option');o.value=f;o.textContent=f;sel.appendChild(o);});_playFiles=d.files||[];_playTotal=_playFiles.length;const ts=document.getElementById('play-total');if(ts)ts.textContent=_playTotal;const sk=document.getElementById('play-seek');if(sk){sk.max=Math.max(0,_playTotal-1);sk.value=_playCur;}}
function _applyZRange(floats,nfields,fields){const zi=fields.indexOf('z');if(zi<0)return;const np=(floats.length/nfields)|0;let mn=Infinity,mx=-Infinity;for(let i=0;i<np;i++){const z=floats[i*nfields+zi];if(z<mn)mn=z;if(z>mx)mx=z;}const step=Math.max(0.01,parseFloat(((mx-mn)/200).toFixed(2)));['flt-zmin','flt-zmax'].forEach((id,ii)=>{const el=document.getElementById(id);if(el){el.min=mn.toFixed(2);el.max=mx.toFixed(2);el.step=step;el.value=ii===0?mn.toFixed(2):mx.toFixed(2);}});}
async function loadFile(path){
  if(!path)return;setStatus('loading...','loading');document.getElementById('overlay').style.display='none';
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
  }catch(e){setStatus('fetch error','err');}
}
function updatePointSize(v){document.getElementById('pt-size-val').textContent=parseFloat(v).toFixed(1);window._three.setPointSize(parseFloat(v));window._three.setPickThreshold(parseFloat(v)*0.05);if(_fusionMode){const r=Math.max(0,Math.min(8,Math.round(parseFloat(v))));fetch('/api/fusion_render_options?point_size='+r).catch(()=>{});}}
function applyColorMode(v){window._three.setColorMode(v);if(_fusionMode){fetch('/api/fusion_render_options?color_mode='+encodeURIComponent(v)).catch(()=>{});}}function resetCamera(){window._three.resetCamera();}
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
function _sb(id,on){const m={'btn-pick':['#059669','#d1fae5'],'btn-draw':['#d97706','#fef3c7'],'btn-lasso':['#7c3aed','#ede9fe'],'btn-eraser':['#ea580c','#ffedd5']};const[bg,fg]=m[id]||['#059669','#d1fae5'];const ids=(id==='btn-pick')?['btn-pick','btn-edit-pick']:[id];ids.forEach(_id=>{const btn=document.getElementById(_id);if(!btn)return;btn.style.background=on?bg:'';btn.style.color=on?fg:'';});}
function updateEraserRadius(v){document.getElementById('eraser-r-val').textContent=v;window._three._setEraserRadius(parseInt(v));}
function deleteSelected(){window._three.deleteSelected();}
function undoDelete(){window._three.undoDelete();}
function clearSelection(){window._three.clearSelection();}
async function savePcd(){
  const pts=window._three.getEditedPoints(),flds=window._three.getFields();if(!pts||!pts.length){alert('No points to save.');return;}
  const name=prompt('Save as (no extension):','edited_'+new Date().toISOString().slice(0,10));if(!name)return;
  setStatus('saving...','loading');
  try{const r=await fetch('/api/save_pcd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({points:pts,fields:flds,filename:name})});const d=await r.json();if(d.ok){setStatus('Saved: '+d.file,'ok');refreshList();}else setStatus('Save error: '+d.error,'err');}catch(e){setStatus('save error','err');}
}
function trajUndo(){window._three.undoWaypoint();}function trajClear(){window._three.clearWaypoints();}
async function trajExport(){
  const pts=window._three.getWaypoints();if(!pts.length){alert('No waypoints.');return;}
  const payload={version:1,waypoints:pts};
  // Try native save-as dialog via server (works in pywebview and browser)
  try{
    const r=await fetch('/api/traj_export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const d=await r.json();
    if(d.cancelled)return;
    if(d.ok){setStatus('Exported: '+d.file,'ok');return;}
    throw new Error(d.error||'server error');
  }catch(e){
    // Fallback: browser download via <a> (headless / non-pywebview)
    const a=document.createElement('a');
    a.href='data:application/json,'+encodeURIComponent(JSON.stringify(payload,null,2));
    a.download='trajectory_'+new Date().toISOString().slice(0,19).replace(/:/g,'-')+'.json';
    a.click();
  }
}
function trajImport(input){const file=input.files[0];if(!file)return;const reader=new FileReader();reader.onload=e=>{try{const obj=JSON.parse(e.target.result);const pts=Array.isArray(obj)?obj:obj.waypoints;if(!pts||!pts.length){alert('No waypoints found.');return;}window._three.loadWaypoints(pts);}catch(err){alert('JSON parse error: '+err.message);}};reader.readAsText(file);input.value='';}
async function trajSaveServer(){const pts=window._three.getWaypoints();if(!pts.length){alert('No waypoints.');return;}const name=prompt('Filename:','traj_'+new Date().toISOString().slice(0,10));if(!name)return;const r=await fetch('/api/trajectory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1,waypoints:pts,name:name+'.json'})});const d=await r.json();if(d.ok){setStatus('Saved: '+d.file,'ok');refreshTrajList();}else setStatus('Save error: '+d.error,'err');}
async function refreshTrajList(){const r=await fetch('/api/trajectory');const d=await r.json();const sel=document.getElementById('traj-server-list');sel.innerHTML='<option value="">&#8212; server trajs &#8212;</option>';(d.files||[]).forEach(f=>{const o=document.createElement('option');o.value=f;o.textContent=f;sel.appendChild(o);});}
async function trajLoadServer(fname){if(!fname)return;const r=await fetch('/api/trajectory?file='+encodeURIComponent(fname));const d=await r.json();if(d.error){setStatus('Load error: '+d.error,'err');return;}const pts=Array.isArray(d)?d:d.waypoints;if(!pts){setStatus('No waypoints in file','err');return;}window._three.loadWaypoints(pts);setStatus('Loaded: '+fname,'ok');}
function wpDelete(idx){window._three.deleteWaypointAt(idx);}function hideWpPopup(){document.getElementById('wp-popup').style.display='none';}
let _fm='keep';function setFilterMode(m){_fm=m;document.getElementById('flt-keep').classList.toggle('active',m==='keep');document.getElementById('flt-excl').classList.toggle('active',m==='exclude');applyHeightFilter();}
function applyHeightFilter(){
  const zMin=parseFloat(document.getElementById('flt-zmin').value),zMax=parseFloat(document.getElementById('flt-zmax').value);
  if(isNaN(zMin)||isNaN(zMax)||zMin>=zMax)return;
  let applied=false;
  if(window._three?.hasCloud?.()){window._three.applyFilter(zMin,zMax,_fm);applied=true;}
  if((window._gaussian?.getSplatCount?.()||0)>0){window._gaussian.applyFilter(zMin,zMax,_fm);applied=true;}
  if(!applied)return;
  setStatus('Filter: '+_fm+' ['+zMin.toFixed(2)+', '+zMax.toFixed(2)+']','ok');
}
function resetHeightFilter(){
  let applied=false;
  if(window._three?.hasCloud?.()){window._three.resetFilter();applied=true;}
  if((window._gaussian?.getSplatCount?.()||0)>0){window._gaussian.resetFilter();applied=true;}
  if(!applied)return;
  setStatus('Filter reset','ok');
}
function setView(p){window._three.setView(p);['3d','top','front','left'].forEach(v=>{const b=document.getElementById('view-'+v);if(b)b.classList.toggle('active',v===p);});const fb=document.getElementById('view-free');if(fb)fb.classList.toggle('active',p==='free');}
// keyboard shortcuts: p/P 鈫?3D, t/T 鈫?Top
document.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.altKey||e.metaKey)return;
  const t=e.target,tn=t&&t.tagName;
  if(tn==='INPUT'||tn==='TEXTAREA'||tn==='SELECT'||(t&&t.isContentEditable))return;
  const k=e.key.toLowerCase();
  if(k==='p'){e.preventDefault();setView('3d');}
  else if(k==='t'){e.preventDefault();setView('top');}
  else if(k==='f'){e.preventDefault();setView(window._three && window._three.isFreeMode && window._three.isFreeMode()?'3d':'free');}
});
// 鈹€鈹€ Directory browser 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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
  }catch(e){setStatus('Browse error','err');}
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
  }catch(e){setStatus('Picker error','err');}
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
    // 鐩存帴璧?/api/files 鎷挎枃浠跺垪琛紙涓庝笅鎷夋鍚屾簮锛夛紝鐪佹帀涓€娆?/api/browse 寰€杩?
    await refreshList();
    if(_playFiles && _playFiles.length){
      const sel=document.getElementById('file-select');
      if(sel&&sel.options.length>1){sel.selectedIndex=1;}
      setStatus('switched to '+_browseDir+' ('+_playFiles.length+' pcd)','ok');
      // 绗竴涓枃浠剁敤鐩稿璺緞鍔犺浇锛堜笌涓嬫媺妗?onFileSelect 涓€鑷达級
      loadFile(_playFiles[0]);
    }else{
      setStatus('switched dir, no .pcd here','warn');
      browseDir(_browseDir);
      const el=document.getElementById('dir-modal-overlay');if(el)el.classList.add('open');
    }
  }catch(e){setStatus('Picker error','err');}
}
async function openInExplorer(){
  if(!_browseDir){setStatus('no directory','err');return;}
  try{
    const r=await fetch('/api/open_in_explorer?dir='+encodeURIComponent(_browseDir));
    const d=await r.json();
    if(!d.ok)setStatus('Explorer: '+(d.error||'fail'),'err');
  }catch(e){setStatus('Explorer error','err');}
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
  }catch(e){setStatus('fetch error','err');}
}
refreshList();refreshTrajList();ddsRefreshReceiverConfig();refreshGsList();_initWelcomeOnStartup();
// 鈹€鈹€ Camera mode (GVSP UDP receiver) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
const _CAM_PCD_SECTIONS=['sec-file','sec-play','sec-streaming','sec-dds'];
let _camMode=false,_camActive=false,_camLastId=-1,_camSourceFrameId=-1,_camDisplayFrameId=-1;
let _fusionMode=false,_calibrationMode=false,_fusionVehicleJson=null,_fusionSensors=[];
let _fusionActive=false,_fusionLastSequence=-1,_fusionAbort=null,_fusionBlobUrl=null,_fusionPrevColorMode=null;
let _camAbortCtrl=null,_camCurrentBlobUrl=null,_camRenderBusy=false,_camPendingFrame=null,_camCanvasCtx=null,_camFpsTs=0,_camFpsFrames=0,_camFps=0,_camLastBuf=null;
let _camShowFps=true;
function _camGetCanvasCtx(){
  const cv=document.getElementById('camera-canvas');if(!cv)return null;
  if(!_camCanvasCtx)_camCanvasCtx=cv.getContext('2d',{alpha:false,desynchronized:true});
  return _camCanvasCtx;
}
function camToggleFps(on){
  _camShowFps=!!on;
  const badge=document.getElementById('cam-fps-badge');if(!badge)return;
  if(!_camShowFps||!_camActive||!_camMode||_camLastId<0){badge.style.display='none';return;}
  badge.style.display='block';
  badge.textContent=_camFps.toFixed(1)+' FPS';
}
function _camResetRender(){
  _camRenderBusy=false;_camPendingFrame=null;_camLastBuf=null;_camFpsTs=0;_camFpsFrames=0;_camFps=0;
  const img=document.getElementById('camera-img');
  if(img){img.onload=null;img.onerror=null;img.src='';img.style.display='none';}
  if(_camCurrentBlobUrl){URL.revokeObjectURL(_camCurrentBlobUrl);_camCurrentBlobUrl=null;}
  const badge=document.getElementById('cam-fps-badge');if(badge){badge.style.display='none';badge.textContent='';}
  const cv=document.getElementById('camera-canvas');
  if(cv){
    const ctx=_camGetCanvasCtx();
    if(ctx){ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,cv.width||0,cv.height||0);}
    cv.style.display='none';
  }
}
function _camUpdateStatus(fid,w,h){
  const now=performance.now();
  if(!_camFpsTs)_camFpsTs=now;
  _camFpsFrames++;
  const elapsed=now-_camFpsTs;
  if(elapsed>=500){_camFps=_camFpsFrames*1000/elapsed;_camFpsFrames=0;_camFpsTs=now;}
  const label='frame #'+fid+'  '+w+'\u00D7'+h;
  const noSig=document.getElementById('cam-no-signal');if(noSig)noSig.style.display='none';
  const stEl=document.getElementById('cam-status');if(stEl){stEl.textContent=label;stEl.style.color='#34d399';}
  document.getElementById('cam-bind-status').textContent=label;
  const badge=document.getElementById('cam-fps-badge');
  if(badge){
    if(_camShowFps){
      badge.textContent=_camFps.toFixed(1)+' FPS';
      badge.style.display='block';
    }else{
      badge.style.display='none';
    }
  }
}
function _camDrawBitmap(bitmap){
  const wrap=document.getElementById('camera-wrap'),cv=document.getElementById('camera-canvas'),ctx=_camGetCanvasCtx();
  if(!wrap||!cv||!ctx)return;
  const rect=wrap.getBoundingClientRect();
  const w=Math.max(1,Math.round(rect.width)),h=Math.max(1,Math.round(rect.height));
  const dpr=window.devicePixelRatio||1,pw=Math.max(1,Math.round(w*dpr)),ph=Math.max(1,Math.round(h*dpr));
  if(cv.width!==pw||cv.height!==ph){cv.width=pw;cv.height=ph;}
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.fillStyle='#0a0c12';ctx.fillRect(0,0,w,h);
  const s=Math.min(w/bitmap.width,h/bitmap.height),dw=Math.max(1,Math.round(bitmap.width*s)),dh=Math.max(1,Math.round(bitmap.height*s));
  ctx.drawImage(bitmap,(w-dw)*0.5,(h-dh)*0.5,dw,dh);
  cv.style.display='block';
  const img=document.getElementById('camera-img');if(img)img.style.display='none';
}
function _camRenderFallback(fid,buf){
  return new Promise(resolve=>{
    const img=document.getElementById('camera-img');if(!img){resolve();return;}
    const blob=new Blob([buf],{type:'image/jpeg'}),url=URL.createObjectURL(blob),prevUrl=_camCurrentBlobUrl;
    _camCurrentBlobUrl=url;
    img.onload=()=>{
      if(prevUrl)URL.revokeObjectURL(prevUrl);
      img.style.display='';
      const cv=document.getElementById('camera-canvas');if(cv)cv.style.display='none';
      _camUpdateStatus(fid,img.naturalWidth,img.naturalHeight);
      resolve();
    };
    img.onerror=()=>{URL.revokeObjectURL(url);if(_camCurrentBlobUrl===url)_camCurrentBlobUrl=null;resolve();};
    img.src=url;
  });
}
async function _camRenderFrame(fid,buf){
  _camLastBuf=buf;
  if(typeof createImageBitmap==='function'){
    try{
      const bitmap=await createImageBitmap(new Blob([buf],{type:'image/jpeg'}));
      try{
        if(!_camActive||!_camMode)return;
        _camDrawBitmap(bitmap);
        _camUpdateStatus(fid,bitmap.width,bitmap.height);
        return;
      }finally{
        if(bitmap.close)bitmap.close();
      }
    }catch(_e){}
  }
  await _camRenderFallback(fid,buf);
}
function _camQueueFrame(fid,buf){
  _camPendingFrame={fid,buf};
  if(_camRenderBusy)return;
  void _camDrainFrames();
}
async function _camDrainFrames(){
  while(_camActive&&_camMode&&_camPendingFrame){
    const frame=_camPendingFrame;
    _camPendingFrame=null;
    _camRenderBusy=true;
    try{await _camRenderFrame(frame.fid,frame.buf);}catch(_e){}finally{_camRenderBusy=false;}
  }
}
function switchMode(mode){
  const toCam=mode==='cam';
  const toFusion=mode==='fusion';
  const toCalibration=mode==='calibration';
  const toGs=mode==='gs';
  const toPcd=!toCam&&!toFusion&&!toCalibration&&!toGs;
  if(_camMode===toCam&&_fusionMode===toFusion&&_calibrationMode===toCalibration&&!toGs){if(!toPcd)return;}
  _camMode=toCam;
  _fusionMode=toFusion;
  _calibrationMode=toCalibration;
  if(!toFusion&&_fusionActive)fusionStop();
  // Fusion defaults to Intensity color; remember the prior mode to restore on exit.
  const _cmSel=document.getElementById('color-mode');
  if(toFusion&&_fusionPrevColorMode===null&&_cmSel){
    _fusionPrevColorMode=_cmSel.value;
    _cmSel.value='intensity';applyColorMode('intensity');
  }else if(!toFusion&&_fusionPrevColorMode!==null){
    if(_cmSel){_cmSel.value=_fusionPrevColorMode;applyColorMode(_fusionPrevColorMode);}
    _fusionPrevColorMode=null;
  }
  document.getElementById('tab-pcd').classList.toggle('active',toPcd);
  document.getElementById('tab-cam').classList.toggle('active',toCam);
  document.getElementById('tab-fusion').classList.toggle('active',toFusion);
  document.getElementById('tab-calibration')?.classList.toggle('active',toCalibration);
  const tabGs=document.getElementById('tab-gs');if(tabGs)tabGs.classList.toggle('active',toGs);
  _CAM_PCD_SECTIONS.forEach(id=>{const el=document.getElementById(id);if(el)el.style.display=(toCam||toFusion||toCalibration||toGs)?'none':'';});
  // View/Edit Cloud/Trajectory toolbar also works in 3DGS mode (same camera/scene),
  // just not in Camera mode (no 3D scene there at all).
  const vpToolbar=document.getElementById('viewport-toolbar');if(vpToolbar)vpToolbar.style.display=(toCam||toCalibration)?'none':'';
  if(toCam||toCalibration)closeViewportPanel();
  if(toCam||toFusion||toCalibration||toGs){
    _stopPlay();               // stop PCD playback loop so it can't keep re-adding the cloud
    if(_smActive)streamingStop();
    if(_ddsActive)ddsStop();
  }
  const secCam=document.getElementById('sec-camera');if(secCam)secCam.style.display=toCam?'':'none';
  const secFusion=document.getElementById('sec-fusion');if(secFusion)secFusion.style.display=toFusion?'':'none';
  const secCalibration=document.getElementById('sec-calibration');if(secCalibration)secCalibration.style.display=toCalibration?'':'none';
  if(toFusion)_fusionRefreshJsonList(document.getElementById('fusion-json-select')?.value||'');
  const secGs=document.getElementById('sec-gs');if(secGs)secGs.style.display=toGs?'':'none';
  const camWrap=document.getElementById('camera-wrap');if(camWrap)camWrap.classList.toggle('active',toCam);
  const fusionWrap=document.getElementById('fusion-wrap');if(fusionWrap)fusionWrap.classList.toggle('active',toFusion);
  const calibrationWrap=document.getElementById('calibration-wrap');if(calibrationWrap)calibrationWrap.classList.toggle('active',toCalibration);
  if(!toCalibration)calibCaptureStop(true);
  ['cv','lasso-canvas'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display=(toCam||toFusion||toCalibration)?'none':'';});
  const axesLabel=document.getElementById('axes-label');if(axesLabel)axesLabel.style.display=(toCam||toFusion||toCalibration)?'none':'';
  const ovl=document.getElementById('overlay');if(ovl)ovl.style.display=(toCam||toFusion||toCalibration||toGs)?'none':'';
  const ovlText=ovl?.querySelector('span:last-child');if(ovlText)ovlText.textContent=toGs?'':'Select a PCD file';
  setGsOverlay(toGs?'idle':'hidden');
  if(!toCam){
    _camActive=false;
    if(_camAbortCtrl){_camAbortCtrl.abort();_camAbortCtrl=null;}
    _camResetRender();
    const noSig=document.getElementById('cam-no-signal');if(noSig)noSig.style.display='';
    const btnC=document.getElementById('btn-cam-connect');if(btnC){btnC.innerHTML='&#128279; Connect';btnC.style.background='';}
    const stEl=document.getElementById('cam-status');if(stEl){stEl.textContent='off';stEl.style.color='';}
    const bsEl=document.getElementById('cam-bind-status');if(bsEl)bsEl.textContent='bind: 127.0.0.1:'+(document.getElementById('cam-port')?.value||'9870');
  }
  if(toGs){
    window._three?.clearCloud?.();
    window._three?.setSceneAxesVisible?.(true);
    const info=document.getElementById('info');if(info)info.textContent='';
    const status=document.getElementById('status');if(status)status.textContent='3DGS mode';
  }else{
    window._three?.setSceneAxesVisible?.(true);
  }
  if(!toGs&&window._gaussian){window._gaussian.dispose();}
}

let _calibImageDir='',_calibImageDirSelected=false,_calibCaptureDir='',_calibCaptureTimer=null,_calibAutoStatusTimer=null;
async function calibPickFolder(purpose){
  const current=purpose==='capture'?_calibCaptureDir:_calibImageDir;
  const r=await fetch('/api/calibration_pick_dir?purpose='+purpose+'&dir='+encodeURIComponent(current||''));
  const d=await r.json(); if(d.error){calibSetStatus(d.error,true);return false;} if(!d.path)return false;
  if(purpose==='capture'){
    _calibCaptureDir=d.path;document.getElementById('calib-capture-dir').textContent=d.path;document.getElementById('calib-capture-dir').style.display='';
    document.getElementById('calib-capture-status').textContent='Save folder selected';
  }else{
    _calibImageDir=d.path;_calibImageDirSelected=true;document.getElementById('calib-image-dir').textContent=d.path;document.getElementById('calib-image-dir').style.display='';calibSetStatus('Image folder selected');
  }
  return true;
}
function calibSetStatus(text,error=false){const el=document.getElementById('calib-status');if(el){el.textContent=text;el.classList.toggle('error',error);}}
async function calibRun(){
  const model=document.getElementById('calib-camera-type').value;
  if(!model){calibSetStatus('Select a camera model before calibration.',true);return;}
  if(!_calibImageDirSelected&&!await calibPickFolder('images'))return;
  const btn=document.getElementById('calib-run-btn');btn.disabled=true;btn.textContent='Detecting corners and calibrating…';calibSetStatus('Processing, please wait');
  const payload={folder:_calibImageDir,output_dir:_calibImageDir,model,
    rows:+document.getElementById('calib-rows').value,cols:+document.getElementById('calib-cols').value,
    square_mm:+document.getElementById('calib-square').value,min_images:+document.getElementById('calib-min-images').value};
  try{
    const d=await (await fetch('/api/calibration_run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})).json();
    if(!d.ok)throw new Error(d.error||'Calibration failed');
    const coeffNames=d.model.startsWith('fisheye')?['k1','k2','k3','k4']:['k1','k2','p1','p2','k3','k4','k5','k6'];
    const coeff=d.distortion_coefficients.map((v,i)=>`${coeffNames[i]} = ${Number(v).toPrecision(10)}`).join('\n');
    const fx=d.camera_matrix[0][0],fy=d.camera_matrix[1][1],cx=d.camera_matrix[0][2],cy=d.camera_matrix[1][2];
    const offsetCx=cx-d.image_size[0]/2,offsetCy=cy-d.image_size[1]/2;
    const warnings=(d.diagnostics?.warnings||[]).map(x=>'Warning: '+x).join('\n');
    const metric=d.display_reprojection||{value_px:d.mean_reprojection_error,source:'estimated_pose',file:null};
    const isReference=metric.source==='reference_pose';
    const metricLabel=metric.label||(isReference?'Single-Image Reprojection RMS (Reference Pose)':'Single-Image Reprojection RMS (Estimated Extrinsics)');
    const metricNote=metric.note||(isReference?'Uses the distance encoded in the filename and assumes the board is centered and perpendicular to the optical axis.':'No valid named preview image was found; uses the first valid image and its estimated extrinsics.');
    const metricFile=metric.file?`\nValidation Image: ${metric.file}`:'';
    const meanPixelError=Number(metric.mean_pixel_error_px);
    const meanPixelLine=Number.isFinite(meanPixelError)?`\nMean Pixel Error: ${meanPixelError.toFixed(6)} px`:'';
    const relativeDistanceError=Number(metric.distance_relative_error_percent);
    const distanceLines=Number.isFinite(relativeDistanceError)?`\nRelative Distance Error: ${relativeDistanceError.toFixed(6)} %`:'';
    const reprojectionMetrics=`${metricLabel}: ${Number(metric.value_px).toFixed(6)} px${meanPixelLine}${distanceLines}${metricFile}`;
    const out=`Model: ${d.model}\nValid Images: ${d.valid_images.length} / ${d.valid_images.length+d.rejected_images.length}${warnings?'\n'+warnings:''}\n\nFocal Length Fx = ${fx.toFixed(6)}\nFocal Length Fy = ${fy.toFixed(6)}\nPrincipal Point cx (absolute pixel) = ${cx.toFixed(6)}\nPrincipal Point cy (absolute pixel) = ${cy.toFixed(6)}\nCenter Offset Cx = ${offsetCx.toFixed(6)}\nCenter Offset Cy = ${offsetCy.toFixed(6)}\n\nDistortion Coefficients D:\n${coeff}\n\n${reprojectionMetrics}\n\nNote: ${metricNote}\n\nReprojection Image: ${d.reprojection_file}\nResult: ${d.json_file}`;
    const result=document.getElementById('calib-result');result.textContent=out;result.style.display='block';
    calibSetStatus('Calibration complete. JSON, NPY, and preview files were saved to the image folder.');calibShowPreview(d.undistorted_url,'Undistortion Preview');
  }catch(e){calibSetStatus(e.message,true);}finally{btn.disabled=false;btn.textContent='Start Offline Calibration';}
}
function calibShowPreview(url,label){
  const img=document.getElementById('calib-preview'),empty=document.getElementById('calib-empty');
  img.src=url+(url.includes('?')?'&':'?')+'_t='+Date.now();img.style.display='block';empty.style.display='none';
  document.getElementById('calib-preview-label').textContent=label;
}
async function calibCaptureStart(){
  const payload={host:document.getElementById('calib-udp-host').value.trim()||'127.0.0.1',port:+document.getElementById('calib-udp-port').value};
  const d=await (await fetch('/api/calibration_capture_start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})).json();
  if(!d.ok){document.getElementById('calib-capture-status').textContent=d.error;return;}
  document.getElementById('calib-capture-status').textContent='UDP receiver started · Waiting for image stream';
  document.getElementById('calib-receive-btn').textContent='Restart Receiver';
  clearInterval(_calibCaptureTimer);_calibCaptureTimer=setInterval(()=>calibShowPreview('/api/calibration_capture_frame','Live Camera Feed'),120);
}
async function calibCaptureSave(){
  if(!await calibPickFolder('capture'))return;
  const d=await (await fetch('/api/calibration_capture_save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder:_calibCaptureDir})})).json();
  document.getElementById('calib-capture-status').textContent=d.ok?'Saved: '+d.file:(d.error||'Save failed');
}
async function calibAutoCaptureStart(){
  if(!await calibPickFolder('capture'))return;
  const d=await (await fetch('/api/calibration_auto_capture_start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder:_calibCaptureDir})})).json();
  const el=document.getElementById('calib-capture-status');
  if(!d.ok){el.textContent=d.error||'Failed to start auto capture';return;}
  document.getElementById('calib-auto-btn').disabled=true;
  el.textContent='Auto capture running · 0 images saved';
  clearInterval(_calibAutoStatusTimer);_calibAutoStatusTimer=setInterval(async()=>{
    try{
      const s=await (await fetch('/api/calibration_capture_status')).json();
      el.textContent=s.auto_error?'Auto capture stopped: '+s.auto_error:(s.auto_capture?'Auto capture running · '+s.auto_saved+' images saved':'Auto capture stopped · '+s.auto_saved+' images saved');
      if(!s.auto_capture){clearInterval(_calibAutoStatusTimer);_calibAutoStatusTimer=null;document.getElementById('calib-auto-btn').disabled=false;}
    }catch(_e){}
  },500);
}
async function calibAutoCaptureStop(silent=false){
  clearInterval(_calibAutoStatusTimer);_calibAutoStatusTimer=null;
  let d={};try{d=await (await fetch('/api/calibration_auto_capture_stop',{method:'POST'})).json();}catch(_e){}
  const btn=document.getElementById('calib-auto-btn');if(btn)btn.disabled=false;
  if(!silent){const el=document.getElementById('calib-capture-status');if(el)el.textContent='Auto capture stopped · '+(d.auto_saved||0)+' images saved';}
}
async function calibCaptureStop(silent=false){
  await calibAutoCaptureStop(true);
  clearInterval(_calibCaptureTimer);_calibCaptureTimer=null;
  try{await fetch('/api/calibration_capture_stop',{method:'POST'});}catch(_e){}
  const btn=document.getElementById('calib-receive-btn');if(btn)btn.textContent='Start Receiver';
  if(!silent){const el=document.getElementById('calib-capture-status');if(el)el.textContent='UDP receiver stopped';}
}

function _fusionWalkSensors(value,path='',out=[]){
  if(!value||typeof value!=='object')return out;
  if(Array.isArray(value)){value.forEach((v,i)=>_fusionWalkSensors(v,path+'['+i+']',out));return out;}
  const text=[value.category,value.type,value.classId,value.sensorClass,value.sensorType,value.name,value.id]
    .filter(v=>v!==undefined&&v!==null).join(' ').toLowerCase();
  let category='';
  if(/camera|image|rgb/.test(text))category='camera';
  else if(/lidar|laser|point.?cloud/.test(text))category='lidar';
  const hasPose=['x','y','z','roll','pitch','yaw','position','rotation','extrinsic','mounting_pose_relative_to_agent']
    .some(k=>Object.prototype.hasOwnProperty.call(value,k));
  const hasParams=['params','intrinsics','camera_matrix','distortion','capture','scan']
    .some(k=>Object.prototype.hasOwnProperty.call(value,k));
  if(category&&(hasPose||hasParams)){
    out.push({category,path,id:String(value.id??value.sensorId??path),name:String(value.name??value.sensorName??value.id??path),data:value});
  }
  Object.entries(value).forEach(([k,v])=>_fusionWalkSensors(v,path?(path+'.'+k):k,out));
  return out;
}
function _fusionFillSelect(id,category){
  const el=document.getElementById(id);if(!el)return;
  const sensors=_fusionSensors.filter(s=>s.category===category);
  el.innerHTML='<option value="">— select '+category+' —</option>';
  sensors.forEach((s,i)=>{const o=document.createElement('option');o.value=s.path;o.textContent=s.name;o.dataset.index=String(i);el.appendChild(o);});
  if(sensors.length){el.value=sensors[0].path;}
}
function _fusionApplyParsedJson(parsed,label){
  const parameterList=document.getElementById('fusion-parameters');
  if(parameterList)parameterList.open=false;
  _fusionVehicleJson=parsed;
  const found=_fusionWalkSensors(parsed);
  const seen=new Set();
  _fusionSensors=found.filter(s=>{const key=s.category+'|'+s.path;if(seen.has(key))return false;seen.add(key);return true;});
  _fusionFillSelect('fusion-camera-select','camera');
  _fusionFillSelect('fusion-lidar-select','lidar');
  const cameras=_fusionSensors.filter(s=>s.category==='camera').length;
  const lidars=_fusionSensors.filter(s=>s.category==='lidar').length;
  document.getElementById('fusion-json-name').textContent=label+' · '+cameras+' camera · '+lidars+' lidar';
  fusionSelectionChanged();
}
async function _fusionRefreshJsonList(selectName){
  try{
    const r=await fetch('/api/vehicle_json_files',{cache:'no-store'});
    const j=await r.json();
    const sel=document.getElementById('fusion-json-select');if(!sel)return;
    const files=(j&&j.files)||[];
    sel.innerHTML='<option value="">\u2014 saved vehicle JSON \u2014</option>';
    files.forEach(n=>{const o=document.createElement('option');o.value=n;o.textContent=n;sel.appendChild(o);});
    if(selectName&&files.includes(selectName))sel.value=selectName;
  }catch(_e){}
}
async function fusionLoadSavedJson(name){
  if(!name)return;
  try{
    const r=await fetch('/api/vehicle_json?name='+encodeURIComponent(name),{cache:'no-store'});
    if(!r.ok)throw new Error('not found on server');
    _fusionApplyParsedJson(await r.json(),name);
    setStatus('Loaded vehicle JSON: '+name,'ok');
  }catch(e){setStatus('Load vehicle JSON failed: '+e.message,'err');}
}
async function fusionImportVehicleJson(file){
  if(!file)return;
  try{
    const text=await file.text();
    _fusionApplyParsedJson(JSON.parse(text),file.name);
    // Persist to the server cache so it can be re-selected without re-importing.
    try{
      const r=await fetch('/api/upload_vehicle_json',{method:'POST',headers:{'X-Filename':encodeURIComponent(file.name)},body:text});
      const j=await r.json();
      if(j&&j.ok)await _fusionRefreshJsonList(j.name);
    }catch(_e){}
    setStatus('Vehicle JSON imported','ok');
  }catch(e){
    _fusionVehicleJson=null;_fusionSensors=[];
    document.getElementById('fusion-json-name').textContent='Import failed: '+e.message;
    document.getElementById('fusion-calibration-summary').textContent='Invalid vehicle JSON.';
    setStatus('Vehicle JSON import failed','err');
  }finally{
    const input=document.getElementById('fusion-json-file');if(input)input.value='';
  }
}
function _fusionSelectedSensor(category){
  const id=category==='camera'?'fusion-camera-select':'fusion-lidar-select';
  const path=document.getElementById(id)?.value||'';
  return _fusionSensors.find(s=>s.category===category&&s.path===path)||null;
}
function _fusionRelevant(sensor){
  if(!sensor)return null;
  const d=sensor.data;
  return {
    id:sensor.id,name:sensor.name,json_path:sensor.path,
    extrinsic:d.extrinsic??d.mounting_pose_relative_to_agent??d.pose??{
      x:d.x,y:d.y,z:d.z,roll:d.roll,pitch:d.pitch,yaw:d.yaw
    },
    intrinsic:d.intrinsics??d.params??d.camera_matrix??d.capture??d.scan??null
  };
}
function _fusionParseUdp(url){
  const m=/(?:udp|dds):\/\/([^:/]+):(\d+)/i.exec(String(url||''));
  return m?{ip:m[1],port:m[2]}:null;
}
// Best image-stream subscriptionChannel inside a camera sensor node.
function _fusionCameraChannel(node){
  let best=null,fallback=null;
  (function walk(n){
    if(!n||typeof n!=='object')return;
    if(Array.isArray(n)){n.forEach(walk);return;}
    if(typeof n.subscriptionChannel==='string'){
      const fmt=String(n.format||'').toLowerCase();
      const isImg=/jpeg|jpg|rgb|yuv|h26|nv12|image/.test(fmt);
      if(isImg&&n.checked!==false&&!best)best=n.subscriptionChannel;
      if(!fallback)fallback=n.subscriptionChannel;
    }
    Object.values(n).forEach(walk);
  })(node);
  return best||fallback;
}
// LiDAR point-cloud + DIFOP channels (the node that carries deviceInfoChannel).
function _fusionLidarChannels(node){
  let sub=null,info=null;
  (function walk(n){
    if(!n||typeof n!=='object')return;
    if(Array.isArray(n)){n.forEach(walk);return;}
    if(typeof n.deviceInfoChannel==='string'){
      info=info||n.deviceInfoChannel;
      if(typeof n.subscriptionChannel==='string')sub=sub||n.subscriptionChannel;
    }
    Object.values(n).forEach(walk);
  })(node);
  if(!sub){(function walk(n){if(!n||typeof n!=='object')return;if(Array.isArray(n)){n.forEach(walk);return;}if(typeof n.subscriptionChannel==='string')sub=sub||n.subscriptionChannel;Object.values(n).forEach(walk);})(node);}
  return {sub,info};
}
function fusionSelectionChanged(){
  const camera=_fusionSelectedSensor('camera'),lidar=_fusionSelectedSensor('lidar');
  // Auto-fill receiver endpoints from the selected sensors' subscription channels
  // so switching between multiple cameras/lidars updates the ports to match.
  if(camera){
    const cc=_fusionParseUdp(_fusionCameraChannel(camera.data));
    if(cc){
      const cp=document.getElementById('fusion-camera-port');if(cp)cp.value=cc.port;
      const ip=document.getElementById('fusion-lidar-ip');if(ip&&cc.ip)ip.value=cc.ip;
    }
  }
  if(lidar){
    const lc=_fusionLidarChannels(lidar.data);
    const sub=_fusionParseUdp(lc.sub),info=_fusionParseUdp(lc.info);
    if(sub){
      const lp=document.getElementById('fusion-lidar-port');if(lp)lp.value=sub.port;
      const ip=document.getElementById('fusion-lidar-ip');if(ip&&sub.ip)ip.value=sub.ip;
    }
    if(info){const ipr=document.getElementById('fusion-info-port');if(ipr)ipr.value=info.port;}
  }
  const box=document.getElementById('fusion-calibration-summary');if(!box)return;
  if(!camera||!lidar){
    box.textContent='JSON imported, but both a camera and a LiDAR sensor are required.';
    return;
  }
  box.textContent='Camera\n'+JSON.stringify(_fusionRelevant(camera),null,2)
    +'\n\nLiDAR\n'+JSON.stringify(_fusionRelevant(lidar),null,2)
    +'\n\nReady for display.py calibration.';
  // If fusion is already running, live-recompute the projection matrix and
  // rebind receivers to the newly selected camera/LiDAR (ports + calibration).
  if(_fusionActive){
    _fusionApply(camera,lidar).then(()=>{
      _fusionLastSequence=-1;
      setStatus('Fusion re-applied: '+camera.name+' + '+lidar.name,'ok');
    }).catch(e=>setStatus('Fusion re-apply failed: '+e.message,'err'));
  }
}
async function _fusionApply(camera,lidar){
  // Recompute the projection matrix (server-side) for the given sensors and
  // (re)bind the receivers to their ports — shared by start and live re-select.
  const configResponse=await fetch('/api/fusion_config',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({camera:camera.data,lidar:lidar.data})
  });
  const configured=await configResponse.json();
  if(!configured.ok)throw new Error(configured.error||'configuration failed');
  const ip=(document.getElementById('fusion-lidar-ip')?.value||'127.0.0.1').trim();
  const q=new URLSearchParams({
    lidar_ip:ip,lidar_port:document.getElementById('fusion-lidar-port')?.value||'6699',
    info_port:document.getElementById('fusion-info-port')?.value||'7788',
    camera_ip:ip,camera_port:document.getElementById('fusion-camera-port')?.value||'13956'
  });
  const started=await fetch('/api/fusion_ensure?'+q).then(r=>r.json());
  if(!started.ok)throw new Error(started.error||'receiver start failed');
}
async function fusionStart(){
  if(_fusionActive){fusionStop();return;}
  const camera=_fusionSelectedSensor('camera'),lidar=_fusionSelectedSensor('lidar');
  if(!camera||!lidar){setStatus('Select one camera and one LiDAR','err');return;}
  const status=document.getElementById('fusion-run-status');
  try{
    status.textContent='applying calibration…';
    await _fusionApply(camera,lidar);
    _fusionSyncViewOptions();
    _fusionActive=true;_fusionLastSequence=-1;
    status.textContent='waiting for camera/LiDAR frames…';
    document.getElementById('fusion-start-btn').textContent='⏹ Stop Fusion';
    void _fusionPoll();
  }catch(e){status.textContent='error: '+e.message;setStatus('Fusion start failed','err');}
}
// Push the View panel's current Size/Color to the server so fused frames match
// the same controls that drive PCD/3DGS rendering.
function _fusionSyncViewOptions(){
  const sz=document.getElementById('pt-size')?.value;
  const cm=document.getElementById('color-mode')?.value;
  const q=new URLSearchParams();
  if(sz!=null)q.set('point_size',String(Math.max(0,Math.min(8,Math.round(parseFloat(sz))))));
  if(cm)q.set('color_mode',cm);
  if([...q.keys()].length)fetch('/api/fusion_render_options?'+q).catch(()=>{});
}
function fusionStop(){
  _fusionActive=false;
  if(_fusionAbort){_fusionAbort.abort();_fusionAbort=null;}
  // Keep the last fused frame on screen (don't clear img / revoke blob / show
  // the empty placeholder) so the result stays visible after stopping.
  document.getElementById('fusion-start-btn').textContent='🔗 Apply & Start Fusion';
  document.getElementById('fusion-run-status').textContent='stopped · last frame retained';
}
async function _fusionPoll(){
  while(_fusionActive&&_fusionMode){
    _fusionAbort=new AbortController();
    try{
      const r=await fetch('/api/fusion_frame?after='+_fusionLastSequence,{signal:_fusionAbort.signal,cache:'no-store'});
      const ct=r.headers.get('content-type')||'';
      if(ct.includes('json')){await new Promise(resolve=>setTimeout(resolve,100));continue;}
      const seq=parseInt(r.headers.get('x-fusion-sequence')||'-1',10);
      const cameraFrame=r.headers.get('x-camera-frame')||'-1';
      const lidarFrame=r.headers.get('x-lidar-frame')||'-1';
      const projected=r.headers.get('x-projected-points')||'0';
      const renderFps=r.headers.get('x-render-fps')||'-1';
      const renderAvgMs=r.headers.get('x-render-avg-ms')||'-1';
      const buffer=await r.arrayBuffer();
      if(!buffer.byteLength)continue;
      _fusionLastSequence=seq;
      const next=URL.createObjectURL(new Blob([buffer],{type:'image/jpeg'}));
      const previous=_fusionBlobUrl;_fusionBlobUrl=next;
      const img=document.getElementById('fusion-img');
      img.onload=()=>{if(previous)URL.revokeObjectURL(previous);img.style.display='block';document.querySelector('#fusion-wrap .fusion-empty')?.style.setProperty('display','none');};
      img.src=next;
      const badge=document.getElementById('fusion-badge');
      const perfLabel=renderFps!=='-1'?(' · render '+renderFps+' fps ('+renderAvgMs+'ms/frame)'):'';
      badge.style.display='block';badge.textContent='Camera '+cameraFrame+' · LiDAR '+lidarFrame+' · '+projected+' projected pts'+perfLabel;
      document.getElementById('fusion-run-status').textContent='running · sequence '+seq;
    }catch(e){
      if(e.name==='AbortError'||!_fusionActive||!_fusionMode)break;
      await new Promise(resolve=>setTimeout(resolve,250));
    }
  }
  _fusionAbort=null;
}
// ── Viewport toolbar (View / Trajectory / Edit Cloud floating panel) ───────
const _VP_TITLES={view:'View',traj:'Trajectory',edit:'Edit Cloud'};
let _vpActiveTab=null;
function toggleViewportPanel(tab){
  const panel=document.getElementById('viewport-panel');if(!panel)return;
  if(panel.classList.contains('open')&&_vpActiveTab===tab){closeViewportPanel();return;}
  _vpActiveTab=tab;
  ['view','traj','edit'].forEach(t=>{
    const page=document.getElementById('sec-'+t);if(page)page.style.display=(t===tab)?'':'none';
    const btn=document.querySelector('.vp-tool-btn[data-tool="'+t+'"]');if(btn)btn.classList.toggle('active',t===tab);
  });
  const title=document.getElementById('vp-panel-title');if(title)title.textContent=_VP_TITLES[tab]||'';
  panel.classList.add('open');
}
function closeViewportPanel(){
  const panel=document.getElementById('viewport-panel');if(panel)panel.classList.remove('open');
  document.querySelectorAll('.vp-tool-btn').forEach(b=>b.classList.remove('active'));
  _vpActiveTab=null;
}
async function camConnect(){
  if(_camActive){
    _camActive=false;
    if(_camAbortCtrl){_camAbortCtrl.abort();_camAbortCtrl=null;}
    _camResetRender();
    const noSig=document.getElementById('cam-no-signal');if(noSig)noSig.style.display='';
    const btnC=document.getElementById('btn-cam-connect');if(btnC){btnC.innerHTML='&#128279; Connect';btnC.style.background='';}
    const stEl=document.getElementById('cam-status');if(stEl){stEl.textContent='off';stEl.style.color='';}
    document.getElementById('cam-bind-status').textContent='bind: 127.0.0.1:'+(document.getElementById('cam-port')?.value||'9870');
    setStatus('Camera stopped','ok');
    return;
  }
  const ip=(document.getElementById('cam-ip')?.value||'127.0.0.1').trim()||'127.0.0.1';
  const port=parseInt(document.getElementById('cam-port')?.value||'13956',10);
  if(!(port>=1&&port<=65535)){setStatus('Camera port invalid','err');return;}
  try{
    const r=await fetch('/api/camera_ensure?ip='+encodeURIComponent(ip)+'&port='+port);
    const d=await r.json();
    if(!d.started){setStatus('Camera connect failed: '+(d.error||'unknown'),'err');return;}
    _camActive=true;_camLastId=-1;_camDisplayFrameId=-1;
    _camResetRender();
    const btnC=document.getElementById('btn-cam-connect');if(btnC){btnC.innerHTML='&#9209; Stop';btnC.style.background='#dc2626';}
    const stEl=document.getElementById('cam-status');if(stEl){stEl.textContent='listening\u2026';stEl.style.color='#facc15';}
    document.getElementById('cam-bind-status').textContent='udp: '+ip+':'+port+' (listening)';
    setStatus('Camera listening on port '+port,'ok');
    _logUI('camera','started udp:'+port,'ok');
    _camPollLoop();
  }catch(e){setStatus('Camera error: '+e.message,'err');}
}
async function _camPollLoop(){
  while(_camActive&&_camMode){
    if(_camAbortCtrl)_camAbortCtrl.abort();
    _camAbortCtrl=new AbortController();
    try{
      const r=await fetch('/api/camera_frame?after='+_camLastId,{signal:_camAbortCtrl.signal,cache:'no-store'});
      if(!r.ok){await new Promise(res=>setTimeout(res,300));continue;}
      const ct=r.headers.get('content-type')||'';
      if(ct.includes('json'))continue;
      const fid=parseInt(r.headers.get('x-frame-id')||'-1',10);
      const sourceFid=parseInt(r.headers.get('x-source-frame-id')||String(fid),10);
      const displayFid=parseInt(r.headers.get('x-display-frame-id')||String(sourceFid),10);
      const buf=await r.arrayBuffer();
      if(buf.byteLength>0){
        _camLastId=fid;_camSourceFrameId=sourceFid;_camDisplayFrameId=displayFid;
        // Show source_frame_id normally, but fall back to the GVSP block_id when
        // source_frame_id is implausibly large (e.g. a mis-decoded simone3.x sender).
        _camQueueFrame(displayFid,buf);
      }
    }catch(e){
      if(e.name==='AbortError')break;
      if(!_camActive||!_camMode)break;
      await new Promise(res=>setTimeout(res,300));
    }
  }
  _camAbortCtrl=null;
}
// end Camera mode
(function(){
  const wrap=document.getElementById('camera-wrap');
  if(!wrap||typeof ResizeObserver==='undefined')return;
  new ResizeObserver(()=>{
    if(!_camMode||!_camLastBuf)return;
    _camQueueFrame(_camDisplayFrameId>=0?_camDisplayFrameId:_camLastId,_camLastBuf);
  }).observe(wrap);
})();

// ── Gaussian Splatting UI ────────────────────────────────────────────────────
function setGsOverlay(mode, line1, line2){
  const ov=document.getElementById('gs-overlay');
  if(!ov)return;
  const s1=ov.children[0],s2=ov.children[1];
  if(mode==='hidden'){ov.style.display='none';return;}
  ov.style.display='flex';
  if(mode==='loading'){
    ov.style.opacity='0.90';
    if(s1)s1.textContent=line1||'Loading 3DGS scene...';
    if(s2)s2.textContent=line2||'Please wait until parsing and sorting finish';
  }else if(mode==='error'){
    ov.style.opacity='0.90';
    if(s1)s1.textContent=line1||'Load failed';
    if(s2)s2.textContent=line2||'Please select another .ply file';
  }else{
    ov.style.opacity='0.35';
    if(s1)s1.textContent='Drop a .ply file here to load';
    if(s2)s2.textContent='or select a file from the left panel';
  }
}

async function refreshGsList(){
  try{
    const r=await fetch('/api/gaussian_files');
    const d=await r.json();
    const sel=document.getElementById('gs-file-select');
    if(!sel)return;
    sel.innerHTML='<option value="">&#8212; select .ply file &#8212;</option>';
    (d.files||[]).forEach(f=>{const o=document.createElement('option');o.value=f;o.textContent=f;sel.appendChild(o);});
    _logUI('gs','listed '+d.files.length+' ply files','ok');
  }catch(e){setStatus('GS list error: '+e.message,'err');}
}
async function onGsFileSelect(path){
  if(!path)return;
  await _gsLoadFromUrl('/api/ply?file='+encodeURIComponent(path), path);
}
async function onGsFileSelectAbs(path){
  if(!path)return;
  await _gsLoadFromUrl('/api/ply_abs?file='+encodeURIComponent(path), path);
}
async function _gsLoadFromUrl(url, label){
  setGsOverlay('loading','Loading 3DGS scene...','Parsing '+label);
  setStatus('Loading '+label+'\u2026','loading');
  const infoEl=document.getElementById('gs-info');
  const loadEl=document.getElementById('gs-load-ms');
  const loadingEl=document.getElementById('gs-loading');
  const t0=performance.now();
  if(infoEl)infoEl.textContent='loading\u2026';
  if(loadingEl)loadingEl.style.display='block';
  try{
    const shDegree=Math.max(0,Math.min(3,parseInt(document.getElementById('gs-sh-level')?.value||'0',10)||0));
    const maxSplats=Math.max(500000,Math.min(20000000,parseInt(document.getElementById('gs-max-pts')?.value||'20000000',10)||20000000));
    const roll = parseFloat(document.getElementById('gs-roll')?.value || '0') || 0;
    const pitch = parseFloat(document.getElementById('gs-pitch')?.value || '0') || 0;
    const yaw = parseFloat(document.getElementById('gs-yaw')?.value || '0') || 0;
    const res=await window._gaussian.load(url, label, {
      shDegree,
      maxSplats,
      modelRotationDeg: { roll, pitch, yaw }
    });
    const n=window._gaussian.getSplatCount();
    _refreshGsInfo();
    if(loadEl)loadEl.textContent='load: '+Math.round((res?.totalMs??(performance.now()-t0)))+' ms';
    if(res?.textureError){
      setStatus('已加载 '+n.toLocaleString()+' 个 Gaussians，但显卡纹理分配报错，画面可能不完整——请调低 Max pts 后重新加载','err');
      setGsOverlay('error','GPU 纹理分配失败','场景可能超出显卡纹理容量限制，请调低 3DGS 面板里的 Max pts 滑块后重新加载该文件');
      _logUI('gs','loaded '+label+' ('+n+' splats) but GPU texture allocation failed — lower Max pts and reload','err');
    }else{
      setStatus('Loaded '+n.toLocaleString()+' Gaussians','ok');
      setGsOverlay('hidden');
      _logUI('gs','loaded '+label+' ('+n+' splats)','ok');
    }
  }catch(e){
    if(infoEl)infoEl.textContent='error';
    setStatus('GS load error: '+e.message,'err');
    setGsOverlay('error','Load failed',e.message||'Unknown error');
    _logUI('gs','load error: '+e.message,'err');
  }finally{
    if(loadingEl)loadingEl.style.display='none';
  }
}
function setGsShLevel(v){
  const lv=Math.max(0,Math.min(3,parseInt(v,10)||0));
  window._gaussian?.setShDegree?.(lv);
}
function gsSetMaxPointsFromUI(v){
  const n=Math.max(500000,Math.min(20000000,parseInt(v,10)||20000000));
  const el=document.getElementById('gs-max-pts-val');
  if(el)el.textContent=(n/1000000).toFixed(1)+'M';
}
function gsSetRenderFpsFromUI(v){
  const fps=Math.max(1,Math.min(60,parseInt(v,10)||30));
  const el=document.getElementById('gs-render-fps-val');if(el)el.textContent=String(fps);
  window._three?.setGsRenderFpsCap?.(fps);
}

function setGsRotationFromUi(){
  const roll = parseFloat(document.getElementById('gs-roll')?.value || '0') || 0;
  const pitch = parseFloat(document.getElementById('gs-pitch')?.value || '0') || 0;
  const yaw = parseFloat(document.getElementById('gs-yaw')?.value || '0') || 0;
  window._gaussian?.setModelRotationDeg?.(roll, pitch, yaw);
  _logUI('gs-rot', `r=${roll}, p=${pitch}, y=${yaw}`, 'ok');
}

function resetGsRotation(){
  const er=document.getElementById('gs-roll');
  const ep=document.getElementById('gs-pitch');
  const ey=document.getElementById('gs-yaw');
  if(er)er.value='0';
  if(ep)ep.value='0';
  if(ey)ey.value='0';
  window._gaussian?.setModelRotationDeg?.(0,0,0);
  _logUI('gs-rot', 'reset to 0,0,0', 'ok');
}

// ── GS Color Adjustment ──
function setGsColor(key, rawVal) {
  const valEl = document.getElementById('gs-' + (key === 'hueShift' ? 'hue' : key) + '-val');
  let glVal;
  switch (key) {
    case 'brightness':   glVal = parseFloat(rawVal) / 100;   if(valEl) valEl.textContent = rawVal; break;
    case 'contrast':     glVal = parseFloat(rawVal) / 100;   if(valEl) valEl.textContent = rawVal; break;
    case 'saturation':   glVal = parseFloat(rawVal) / 100;   if(valEl) valEl.textContent = rawVal; break;
    case 'temperature':  glVal = parseFloat(rawVal) / 100;   if(valEl) valEl.textContent = rawVal; break;
    case 'hueShift':     glVal = parseFloat(rawVal) * Math.PI / 180; if(valEl) valEl.textContent = rawVal + '°'; break;
    default: return;
  }
  window._gaussian?.setColorAdjust?.(key, glVal);
}

function resetGsColor() {
  window._gaussian?.resetColorAdjust?.();
  const defs = { brightness: 0, contrast: 100, saturation: 100, temperature: 0, hue: 0 };
  for (const [k, v] of Object.entries(defs)) {
    const el = document.getElementById('gs-' + k);
    const valEl = document.getElementById('gs-' + k + '-val');
    if (el) el.value = v;
    if (valEl) valEl.textContent = k === 'hue' ? v + '°' : String(v);
  }
}

function _refreshGsInfo(){
  const tabGs=document.getElementById('tab-gs');
  if(!tabGs||!tabGs.classList.contains('active'))return;
  const infoEl=document.getElementById('gs-info');
  const loadingEl=document.getElementById('gs-loading');
  if(!infoEl||!window._gaussian)return;
  const n=window._gaussian.getSplatCount?.()||0;
  const fps=window._gaussian.getFps?.()||0;
  const visible=window._gaussian.getVisibleSplatCount?.()??n;
  const countStr=(n>0&&visible<n)?(visible.toLocaleString()+' / '+n.toLocaleString()+' splats'):(n.toLocaleString()+' splats');
  infoEl.textContent=countStr+' | '+fps+' fps';
  if(loadingEl&&loadingEl.style.display!=='none'){
    const t=((Date.now()/300)|0)%4;
    loadingEl.textContent='loading'+'.'.repeat(t);
  }
}
setInterval(_refreshGsInfo,300);

// ── Drag & drop .pcd/.ply files or folders onto the canvas ─────────────────────────────
(function(){
  const wrap=document.getElementById('canvas-wrap');
  const ov=document.createElement('div');
  ov.id='drop-ov';
  ov.style.cssText='position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(14,116,144,.18);border:3px dashed #22d3ee;color:#cffafe;font-size:1.1rem;font-weight:600;pointer-events:none;z-index:30;text-align:center;padding:20px;text-shadow:0 1px 4px #000';
  ov.innerHTML='\u2935\ufe0f  Drop .pcd / .ply file(s) or folder to load';
  wrap.appendChild(ov);
  let _depth=0;
  function show(on){ov.style.display=on?'flex':'none';}
  function _isSupported(name){const n=(name||'').toLowerCase();return n.endsWith('.pcd')||n.endsWith('.ply');}
  wrap.addEventListener('dragenter',e=>{e.preventDefault();_depth++;show(true);});
  wrap.addEventListener('dragover', e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';});
  wrap.addEventListener('dragleave',e=>{e.preventDefault();_depth=Math.max(0,_depth-1);if(_depth===0)show(false);});

  // recursively traverse a webkit FileSystem entry, collecting {file, relpath} for supported files
  function _readEntries(reader){return new Promise((res,rej)=>reader.readEntries(res,rej));}
  async function _walkEntry(entry, prefix, out){
    if(entry.isFile){
      if(!_isSupported(entry.name))return;
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
      }catch(err){}
    }
    if(!collected.length){
      // fallback: plain files only
      for(const f of (e.dataTransfer.files||[])){
        if(_isSupported(f.name)) collected.push({file:f, relpath:f.name});
      }
    }
    if(!collected.length){setStatus('drop ignored: no .pcd/.ply files','warn');return;}
    // Browsers never expose a dropped file's real filesystem path, so large .ply
    // scenes can't be symlinked — they'd have to be fully uploaded/copied into
    // _dropped/, which is slow and memory-heavy for multi-GB 3DGS files. Skip those
    // and point the user at the native picker (zero-copy, loads straight from disk).
    const LARGE_PLY_BYTES = 100*1024*1024; // 100MB
    const isTooLargePly = ({file})=>file.name.toLowerCase().endsWith('.ply') && file.size > LARGE_PLY_BYTES;
    const tooLarge = collected.filter(isTooLargePly);
    const toUpload = collected.filter(f=>!isTooLargePly(f));
    if(tooLarge.length){
      const names=tooLarge.map(({file})=>file.name+' ('+(file.size/1024/1024).toFixed(0)+'MB)').join(', ');
      setStatus(tooLarge.length+' large .ply skipped (>100MB): '+names+' \u2014 use File \u2192 Open PLY (3DGS)\u2026 instead','warn');
      _logUI('gs','skipped large .ply drop(s): '+names,'warn');
    }
    if(!toUpload.length)return;
    setStatus('uploading '+toUpload.length+' file'+(toUpload.length>1?'s':'')+'\u2026','loading');
    _stopPlay();
    let firstPcd='', firstPly='', okN=0;
    for(const {file, relpath} of toUpload){
      const lower=file.name.toLowerCase();
      const isPly=lower.endsWith('.ply');
      const api=isPly?'/api/upload_ply':'/api/upload_pcd';
      try{
        const r=await fetch(api,{method:'POST',
          headers:{
            'X-Filename':encodeURIComponent(file.name),
            'X-Relpath' :encodeURIComponent(relpath),
            'Content-Type':'application/octet-stream'},
          body:file});
        const d=await r.json();
        if(d.ok){
          okN++;
          if(isPly){if(!firstPly)firstPly=d.file;}
          else{if(!firstPcd)firstPcd=d.file;}
        }
        else setStatus('upload error: '+(d.error||'?'),'err');
      }catch(err){setStatus('upload failed','err');}
    }
    if(!firstPcd&&!firstPly)return;
    _frameCache.clear(); _fetchPromises.clear();
    await refreshList();
    await refreshGsList();

    if(firstPly){
      switchMode('gs');
      const selGs=document.getElementById('gs-file-select');
      if(selGs){
        for(let i=0;i<selGs.options.length;i++){if(selGs.options[i].value===firstPly){selGs.selectedIndex=i;break;}}
      }
      setStatus('uploaded '+okN+' \u2192 '+firstPly,'ok');
      onGsFileSelect(firstPly);
      return;
    }

    const sel=document.getElementById('file-select');
    if(sel){
      for(let i=0;i<sel.options.length;i++){if(sel.options[i].value===firstPcd){sel.selectedIndex=i;break;}}
    }
    setStatus('uploaded '+okN+' \u2192 '+firstPcd,'ok');
    loadFile(firstPcd);
  });
})();
// 鈹€鈹€ Sidebar resize & collapse 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
const _sidebar=document.getElementById('sidebar');
const _handle=document.getElementById('resize-handle');
const _toggle=document.getElementById('sidebar-toggle');
let _sidebarW=360,_collapsed=false;
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
    const w=Math.max(280,Math.min(700,startW+(e.clientX-startX)));
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

// ── Top menu bar (File/Help) ────────────────────────────────────────────────
function closeTopbarMenus(){document.querySelectorAll('.topbar-item.open').forEach(el=>el.classList.remove('open'));}
function toggleTopbarMenu(btn){
  const item=btn.closest('.topbar-item');if(!item)return;
  const wasOpen=item.classList.contains('open');
  closeTopbarMenus();
  if(!wasOpen)item.classList.add('open');
}
document.addEventListener('click',e=>{if(!e.target.closest('.topbar-item'))closeTopbarMenus();});
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape')return;
  closeTopbarMenus();
  closeAboutModal();
  closeHelpModal();
  closeWelcomeModal();
});

async function openPlyFromMenu(){
  setStatus('opening PLY picker\u2026','loading');
  try{
    const r=await fetch('/api/pick_ply');
    const d=await r.json();
    if(d.error){setStatus('Picker: '+d.error,'err');return;}
    if(!d.path){setStatus('cancelled','idle');return;}
    // Load directly from its original location on disk — no upload/copy needed,
    // which matters a lot for large 3DGS scenes (hundreds of MB to several GB).
    switchMode('gs');
    await onGsFileSelectAbs(d.path);
  }catch(e){setStatus('Picker error','err');}
}

// ── About modal ──────────────────────────────────────────────────────────────
async function showAboutModal(){
  const el=document.getElementById('about-modal-overlay');if(!el)return;
  el.classList.add('open');
  const body=document.getElementById('about-body');
  if(body)body.textContent='loading\u2026';
  try{
    const r=await fetch('/api/app_info');
    const d=await r.json();
    if(body)body.innerHTML=
      '<div><b>'+d.app_name+'</b></div>'+
      '<div>Version: '+d.version+'</div>'+
      '<div>Git commit: '+d.git_commit+'</div>'+
      '<div>Build time: '+d.build_time+'</div>'+
      '<div>Platform: '+d.platform+'</div>';
  }catch(e){
    if(body)body.textContent='Failed to load app info.';
  }
}
function closeAboutModal(){const el=document.getElementById('about-modal-overlay');if(el)el.classList.remove('open');}

// ── Help / User Guide modal (Lidar / Camera / 3DGS tabs) ────────────────────
function showHelpModal(){
  const el=document.getElementById('help-modal-overlay');if(!el)return;
  el.classList.add('open');
}
function closeHelpModal(){const el=document.getElementById('help-modal-overlay');if(el)el.classList.remove('open');}
function helpShowTab(tab){
  ['lidar','camera','gs'].forEach(t=>{
    const btn=document.getElementById('help-tab-'+t);if(btn)btn.classList.toggle('active',t===tab);
    const page=document.getElementById('help-page-'+t);if(page)page.style.display=(t===tab)?'':'none';
  });
}

// ── Welcome modal (shortcuts + startup preference) ──────────────────────────
function showWelcomeModal(){
  const el=document.getElementById('welcome-modal-overlay');if(!el)return;
  el.classList.add('open');
}
function closeWelcomeModal(){const el=document.getElementById('welcome-modal-overlay');if(el)el.classList.remove('open');}
function saveWelcomePref(){
  const cb=document.getElementById('welcome-dont-show');if(!cb)return;
  const show=!cb.checked;
  fetch('/api/welcome_pref',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({show_welcome_on_startup:show})}).catch(()=>{});
}
async function _initWelcomeOnStartup(){
  try{
    const r=await fetch('/api/welcome_pref');
    const d=await r.json();
    const cb=document.getElementById('welcome-dont-show');
    if(cb)cb.checked=!d.show_welcome_on_startup;
    if(d.show_welcome_on_startup)showWelcomeModal();
  }catch(e){/* ignore: keep welcome modal hidden if the backend is unreachable */}
}
