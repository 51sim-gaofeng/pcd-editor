let active = false;
let ws = null;
let wsUrl = '';
let reconnectDelayMs = 500;

// Compact WS payload header from backend (must match model/dds_model.py):
//   [magic 'PCL2'(4)][frame_id u32 LE(4)][npoints u32 LE(4)][t_store_ms u64 LE(8)]
// followed by N * 16B float32 (x, y, z, intensity). Header is 20 bytes.
const WS_HEADER_BYTES = 20;
const WS_FIELDS = ['x', 'y', 'z', 'intensity'];
const WS_NFIELDS = WS_FIELDS.length;
const WS_MAGIC_BYTES = [0x50, 0x43, 0x4c, 0x32]; // 'P','C','L','2'

function parseLiveFrame(buf) {
  const t0 = performance.now();
  const u8 = new Uint8Array(buf, 0, WS_HEADER_BYTES);
  if (u8[0] !== WS_MAGIC_BYTES[0] || u8[1] !== WS_MAGIC_BYTES[1]
      || u8[2] !== WS_MAGIC_BYTES[2] || u8[3] !== WS_MAGIC_BYTES[3]) {
    return null;
  }
  const dv = new DataView(buf, 0, WS_HEADER_BYTES);
  const frameId = dv.getUint32(4, true);
  const npoints = dv.getUint32(8, true);
  // 64-bit little-endian timestamp split into two 32-bit halves to avoid BigInt cost.
  const tLo = dv.getUint32(12, true);
  const tHi = dv.getUint32(16, true);
  const tStoreMs = tHi * 0x100000000 + tLo;
  return {
    fields: WS_FIELDS,
    frameId,
    npoints,
    nfields: WS_NFIELDS,
    dataOff: WS_HEADER_BYTES,
    fname: '',
    tStoreMs,
    parseMs: performance.now() - t0,
  };
}

function scheduleReconnect() {
  if (!active) {
    return;
  }
  const delay = reconnectDelayMs;
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, 3000);
  setTimeout(connect, delay);
}

function connect() {
  if (!active || !wsUrl) {
    return;
  }
  const startedAt = performance.now();
  try {
    ws = new WebSocket(wsUrl);
  } catch (error) {
    self.postMessage({ type: 'error', stage: 'connect', message: String(error && error.message ? error.message : error) });
    scheduleReconnect();
    return;
  }
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => {
    reconnectDelayMs = 500;
    self.postMessage({ type: 'ws-open', url: wsUrl, connectMs: performance.now() - startedAt });
  };
  ws.onmessage = (event) => {
    if (!active) {
      return;
    }
    const buf = event.data;
    if (!(buf instanceof ArrayBuffer)) {
      return;
    }
    const recvMs = Date.now();
    const parsed = parseLiveFrame(buf);
    if (!parsed) {
      self.postMessage({ type: 'error', stage: 'parse', message: 'bad WS frame magic' });
      return;
    }
    const transitMs = parsed.tStoreMs > 0 ? Math.max(0, recvMs - parsed.tStoreMs) : -1;
    self.postMessage({
      type: 'frame',
      fid: parsed.frameId,
      npoints: parsed.npoints,
      nfields: parsed.nfields,
      fields: parsed.fields,
      dataOff: parsed.dataOff,
      fname: parsed.fname,
      parseMs: parsed.parseMs,
      transitMs,
      buffer: buf,
    }, [buf]);
  };
  ws.onerror = () => {
    self.postMessage({ type: 'error', stage: 'socket', message: 'websocket error' });
  };
  ws.onclose = () => {
    ws = null;
    self.postMessage({ type: 'ws-close' });
    scheduleReconnect();
  };
}

self.onmessage = (event) => {
  const data = event.data || {};
  if (data.cmd === 'start') {
    if (active) {
      return;
    }
    wsUrl = String(data.wsUrl || '');
    active = true;
    reconnectDelayMs = 500;
    connect();
    return;
  }
  if (data.cmd === 'stop') {
    active = false;
    if (ws) {
      try { ws.close(); } catch (error) {}
      ws = null;
    }
  }
};
