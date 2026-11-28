// Socin Studio gọi máy chủ MCP khác (S Draw, Blender, GitHub, Playwright...): Streamable HTTP (trả JSON hoặc SSE) và stdio.
// Cấu hình lưu ở <workspace>/socin-studio/mcp-servers.json (mode 600). Mã khoá của máy chủ không bao giờ trả về trình duyệt.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const PROTOCOL = '2025-06-18';
const expand = (p) => String(p || '').replace(/^~(?=$|\/)/, os.homedir());
const safeId = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 24) || 'mcp';

/** Thư mục dữ liệu của S Draw (Electron userData) để tự dò cổng MCP của S Draw. */
function sdrawDirs() {
  const h = os.homedir();
  const bases = process.platform === 'darwin' ? [path.join(h, 'Library', 'Application Support')] : process.platform === 'win32' ? [process.env.APPDATA || path.join(h, 'AppData', 'Roaming')] : [process.env.XDG_CONFIG_HOME || path.join(h, '.config')];
  const names = ['Sdraw AI', 'S Draw', 'sdrawai', 'SDraw'];
  return [process.env.SDRAW_USERDATA, ...bases.flatMap((b) => names.map((n) => path.join(b, n)))].filter(Boolean);
}
/** Địa chỉ + mã khoá cổng MCP của S Draw (S Draw ghi khi bật "Cho AI kết nối"). null nếu S Draw chưa bật. */
function sdrawTarget() {
  for (const d of sdrawDirs()) {
    try {
      const run = JSON.parse(fs.readFileSync(path.join(d, 'ai-gateway.run.json'), 'utf8'));
      const cfg = JSON.parse(fs.readFileSync(path.join(d, 'ai-gateway.json'), 'utf8'));
      if (typeof run.url === 'string' && /^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(run.url) && typeof cfg.token === 'string' && cfg.token) return { url: run.url, token: cfg.token };
    } catch {}
  }
  return null;
}

/** Đọc trả lời JSON-RPC từ thân HTTP: JSON thường hoặc luồng SSE (lấy dòng data có id cần tìm). */
function parseRpcBody(text, contentType, id) {
  if (/text\/event-stream/.test(contentType || '')) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (!data) continue;
      try { const j = JSON.parse(data); const arr = Array.isArray(j) ? j : [j]; const hit = arr.find((x) => x && x.id === id); if (hit) return hit; } catch {}
    }
    return null;
  }
  try { const j = JSON.parse(text); return Array.isArray(j) ? j.find((x) => x && x.id === id) || null : j; } catch { return null; }
}

class HttpConn {
  constructor(srv, fetchImpl) { this.srv = srv; this.fetch = fetchImpl || fetch; this.session = null; this.ready = false; this.n = 1; }
  target() {
    if (this.srv.url === 'auto' && this.srv.pluginId === 'sdraw') { const t = sdrawTarget(); if (!t) throw new Error('S Draw chưa mở hoặc chưa bật "Cho AI kết nối (MCP)" (màn Dựng 3D, bảng AI và Skill).'); return t; }
    return { url: this.srv.url, token: this.srv.token || '' };
  }
  async post(msg, timeout = 60000) {
    const t = this.target();
    if (this.lastUrl && this.lastUrl !== t.url) { this.session = null; this.ready = false; }
    this.lastUrl = t.url;
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTOCOL };
    if (t.token) headers.authorization = 'Bearer ' + t.token;
    if (this.session) headers['mcp-session-id'] = this.session;
    let r;
    try { r = await this.fetch(t.url, { method: 'POST', headers, body: JSON.stringify(msg), signal: AbortSignal.timeout(timeout) }); }
    catch (e) { throw new Error(`Không kết nối được ${this.srv.name} (${(e && e.message) || e})`); }
    const sid = r.headers && r.headers.get && r.headers.get('mcp-session-id'); if (sid) this.session = sid;
    if (r.status === 202 || msg.id === undefined) return null;
    if (r.status === 401 || r.status === 403) throw new Error(`${this.srv.name} từ chối mã khoá (${r.status}). Kiểm tra mã khoá trong Plugin.`);
    if (r.status === 404 && this.session) { this.session = null; this.ready = false; throw new Error('Phiên MCP hết hạn, thử lại.'); }
    const text = await r.text();
    if (!r.ok) throw new Error(`${this.srv.name} trả lỗi ${r.status}`);
    const j = parseRpcBody(text, r.headers && r.headers.get ? r.headers.get('content-type') : '', msg.id);
    if (!j) throw new Error(`${this.srv.name} trả lời không đúng MCP`);
    if (j.error) throw new Error(j.error.message || 'Lỗi MCP');
    return j.result;
  }
  async request(method, params, timeout) {
    if (!this.ready) {
      await this.post({ jsonrpc: '2.0', id: this.n++, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'socin-studio', title: 'Socin Studio (S Hub)', version: '1.0.0' } } }, 15000);
      await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => {});
      this.ready = true;
    }
    try { return await this.post({ jsonrpc: '2.0', id: this.n++, method, params }, timeout); }
    catch (e) { if (/hết hạn/.test(e.message)) { return this.request(method, params, timeout); } throw e; }
  }
  close() { this.ready = false; this.session = null; }
}

class StdioConn {
  constructor(srv) { this.srv = srv; this.proc = null; this.pending = new Map(); this.n = 1; this.buf = ''; this.ready = null; this.err = ''; }
  start() {
    if (this.proc && this.proc.exitCode === null) return;
    const PATH = [process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.cargo', 'bin')].filter(Boolean).join(path.delimiter);
    const env = { ...process.env, PATH, ...(this.srv.token && this.srv.tokenEnv ? { [this.srv.tokenEnv]: this.srv.token } : {}) };
    const p = spawn(expand(this.srv.command), (this.srv.args || []).map(expand), { stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: true });
    this.proc = p; this.ready = null; this.err = '';
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d) => {
      this.buf += d; let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        let j; try { j = JSON.parse(line); } catch { continue; }
        const w = j && j.id !== undefined && this.pending.get(j.id);
        if (w) { this.pending.delete(j.id); clearTimeout(w.t); j.error ? w.reject(new Error(j.error.message || 'Lỗi MCP')) : w.resolve(j.result); }
      }
    });
    p.stderr.on('data', (d) => { this.err = (this.err + d).slice(-800); });
    const fail = (why) => { for (const [, w] of this.pending) { clearTimeout(w.t); w.reject(new Error(why)); } this.pending.clear(); this.proc = null; this.ready = null; };
    p.on('error', (e) => fail(`Không chạy được "${this.srv.command}" (${e.code === 'ENOENT' ? 'chưa cài trên máy' : e.message}).`));
    p.on('close', (c) => fail(`${this.srv.name} đã dừng (mã ${c})${this.err ? ': ' + this.err.trim().split('\n').pop() : ''}`));
  }
  send(msg, timeout = 60000) {
    this.start();
    if (msg.id === undefined) { try { this.proc.stdin.write(JSON.stringify(msg) + '\n'); } catch {} return Promise.resolve(null); }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(msg.id); reject(new Error(`${this.srv.name} không trả lời sau ${Math.round(timeout / 1000)} giây`)); }, timeout);
      this.pending.set(msg.id, { resolve, reject, t });
      try { this.proc.stdin.write(JSON.stringify(msg) + '\n'); } catch (e) { clearTimeout(t); this.pending.delete(msg.id); reject(e); }
    });
  }
  async request(method, params, timeout) {
    if (!this.ready) {
      this.ready = this.send({ jsonrpc: '2.0', id: this.n++, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'socin-studio', version: '1.0.0' } } }, 90000)
        .then(() => this.send({ jsonrpc: '2.0', method: 'notifications/initialized' }));
      this.ready.catch(() => { this.ready = null; });
    }
    await this.ready;
    return this.send({ jsonrpc: '2.0', id: this.n++, method, params }, timeout);
  }
  close() { if (this.proc) { try { this.proc.kill(); } catch {} } this.proc = null; this.ready = null; }
}

/** Tên lệnh gửi cho model: mcp_<máy chủ>__<lệnh>, tối đa 64 ký tự. */
const toolKey = (sid, name) => `mcp_${sid}__${String(name).replace(/[^a-zA-Z0-9_-]/g, '_')}`.slice(0, 64);
const accessOf = (t) => (t.annotations && t.annotations.readOnlyHint ? 'read' : t.annotations && t.annotations.destructiveHint ? 'files' : 'edit');

module.exports = function mcpClients({ dir, fetchImpl }) {
  const FILE = path.join(dir, 'mcp-servers.json');
  const conns = new Map();
  const cache = new Map(); // id → { at, tools, error }
  const read = () => { try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; } };
  const write = (list) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(list, null, 2), { mode: 0o600 }); };
  // S Draw có sẵn (tự dò cổng của S Draw), người dùng tắt được
  const servers = () => { const l = read(); if (!l.some((s) => s.id === 'sdraw')) l.unshift({ id: 'sdraw', pluginId: 'sdraw', name: 'S Draw', kind: 'mcp-http', url: 'auto', enabled: true, builtin: true }); return l; };
  const pub = (s) => ({ id: s.id, pluginId: s.pluginId || null, name: s.name, kind: s.kind, url: s.kind === 'mcp-http' ? s.url : undefined, command: s.kind === 'mcp-stdio' ? s.command : undefined, args: s.kind === 'mcp-stdio' ? s.args : undefined, enabled: s.enabled !== false, hasToken: !!s.token, builtin: !!s.builtin, tools: (cache.get(s.id) || {}).error ? null : (cache.get(s.id) || {}).tools?.length ?? null, error: (cache.get(s.id) || {}).error || '' });
  const connOf = (s) => {
    let c = conns.get(s.id);
    if (!c || c.srv !== s) { if (c) c.close(); c = s.kind === 'mcp-stdio' ? new StdioConn(s) : new HttpConn(s, fetchImpl); conns.set(s.id, c); }
    return c;
  };
  function clean(b, old) {
    const kind = b.kind === 'mcp-stdio' ? 'mcp-stdio' : 'mcp-http';
    const name = String(b.name || '').trim().slice(0, 60);
    if (!name) throw new Error('Thiếu tên máy chủ MCP');
    const s = { id: old ? old.id : safeId(b.id || name), pluginId: b.pluginId ? String(b.pluginId).slice(0, 40) : old?.pluginId || null, name, kind, enabled: b.enabled !== false };
    if (kind === 'mcp-http') {
      const url = String(b.url || '').trim();
      if (!(url === 'auto' && s.pluginId === 'sdraw') && !/^https:\/\/[^\s]+$/.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/[^\s]*$/.test(url)) throw new Error('Địa chỉ MCP phải là https://… hoặc http://127.0.0.1:cổng/…');
      s.url = url;
    } else {
      const command = String(b.command || '').trim();
      if (!/^[\w.\/~@+-]{1,200}$/.test(command)) throw new Error('Lệnh chạy không hợp lệ (ví dụ npx, uvx, node)');
      const args = Array.isArray(b.args) ? b.args.map((a) => String(a).slice(0, 300)).slice(0, 30) : String(b.args || '').match(/(?:[^\s"]+|"[^"]*")+/g)?.map((a) => a.replace(/^"|"$/g, '')) || [];
      Object.assign(s, { command, args });
      if (b.tokenEnv && /^[A-Z_][A-Z0-9_]{1,60}$/.test(b.tokenEnv)) s.tokenEnv = b.tokenEnv; else if (old?.tokenEnv) s.tokenEnv = old.tokenEnv;
    }
    s.token = b.clearToken ? '' : b.token ? String(b.token).trim().slice(0, 500) : old?.token || '';
    return s;
  }

  async function toolsOf(s, fresh) {
    const c0 = cache.get(s.id);
    if (!fresh && c0 && Date.now() - c0.at < (c0.error ? 15000 : 120000)) return c0.tools;
    try {
      const r = await connOf(s).request('tools/list', {}, 30000);
      const tools = (r && Array.isArray(r.tools) ? r.tools : []).slice(0, 80);
      cache.set(s.id, { at: Date.now(), tools, error: '' });
      return tools;
    } catch (e) { cache.set(s.id, { at: Date.now(), tools: [], error: e.message }); return []; }
  }

  return {
    list: () => servers().map(pub),
    save(b) {
      const list = servers(); const i = list.findIndex((s) => s.id === b.id);
      const s = clean(b, i >= 0 ? list[i] : null);
      if (i < 0 && list.some((x) => x.id === s.id)) s.id = s.id + '_' + Math.random().toString(36).slice(2, 5);
      if (i >= 0) { s.builtin = list[i].builtin; list[i] = s; } else list.push(s);
      const c = conns.get(s.id); if (c) { c.close(); conns.delete(s.id); } cache.delete(s.id);
      write(list); return pub(s);
    },
    toggle(id, enabled) { const list = servers(); const s = list.find((x) => x.id === id); if (!s) throw new Error('Không có máy chủ này'); s.enabled = !!enabled; if (!enabled) { const c = conns.get(id); if (c) { c.close(); conns.delete(id); } } write(list); return pub(s); },
    remove(id) { const list = servers(); const s = list.find((x) => x.id === id); if (!s) return; if (s.builtin) { s.enabled = false; write(list); } else write(list.filter((x) => x.id !== id)); const c = conns.get(id); if (c) c.close(); conns.delete(id); cache.delete(id); },
    async test(id) { const s = servers().find((x) => x.id === id); if (!s) throw new Error('Không có máy chủ này'); const tools = await toolsOf(s, true); const c = cache.get(id); if (c.error) throw new Error(c.error); return { tools: tools.map((t) => ({ name: t.name, title: t.title || '', description: String(t.description || '').slice(0, 200), access: accessOf(t) })) }; },
    /** Lệnh của mọi máy chủ đang bật, dạng gửi model (tên có tiền tố) + access. Máy chủ lỗi bỏ qua. */
    async allTools() {
      const on = servers().filter((s) => s.enabled !== false);
      const lists = await Promise.all(on.map(async (s) => ({ s, tools: await toolsOf(s) })));
      return lists.flatMap(({ s, tools }) => tools.map((t) => ({ name: toolKey(s.id, t.name), title: `${s.name}: ${t.title || t.name}`, description: `[${s.name}] ${String(t.description || t.title || t.name).slice(0, 1500)}`, inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} }, access: accessOf(t), server: s.id, remoteName: t.name })));
    },
    async call(key, args) {
      const m = /^mcp_([a-z0-9_-]+?)__/.exec(key);
      const s = m && servers().find((x) => x.id === m[1] && x.enabled !== false);
      if (!s) return { text: `Không có lệnh "${key}" (máy chủ MCP đã tắt?)`, isError: true };
      const tools = await toolsOf(s);
      const t = tools.find((x) => toolKey(s.id, x.name) === key);
      if (!t) return { text: `${s.name} không có lệnh này`, isError: true };
      const r = await connOf(s).request('tools/call', { name: t.name, arguments: args || {} }, 300000);
      const content = (r && r.content) || [];
      const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') || (r && r.structuredContent ? JSON.stringify(r.structuredContent) : '(xong)');
      const img = content.find((c) => c.type === 'image' && c.data);
      return { text, isError: !!(r && r.isError), ...(img ? { image: `data:${img.mimeType || 'image/png'};base64,${img.data}` } : {}) };
    },
    closeAll() { for (const c of conns.values()) c.close(); conns.clear(); },
    sdrawTarget,
  };
};
module.exports.parseRpcBody = parseRpcBody;
module.exports.toolKey = toolKey;
