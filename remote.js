// S Remote: điều khiển máy Windows của chính bạn từ Mac này bằng RustDesk, theo danh sách máy trong Socin (Điều khiển từ xa).
// Liên kết theo tài khoản Socin qua kết nối của S Creator (khoá spcr_ của admin hoặc chủ doanh nghiệp). Khoá không bao giờ trả về trình duyệt.
// Socin không giữ mật khẩu RustDesk: lần đầu kết nối RustDesk hỏi mật khẩu, tick "Remember password" là lần sau vào thẳng.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

module.exports = function init({ WS, json, body }) {
  const DL = path.join(WS, 'downloads', 'remote');
  const bad = (m, s = 400) => { const e = new Error(m); e.status = s; throw e; };
  const rj = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
  const CRF = path.join(WS, 'creator', 'settings.json');
  const link = () => { const c = (rj(CRF, {}) || {}).socin || {}; return c.baseUrl && c.token ? { baseUrl: String(c.baseUrl).replace(/\/+$/, ''), token: c.token } : null; };
  const OPEN = process.env.SHUB_OPEN_BIN || 'open';
  const BREW = process.env.SHUB_BREW_BIN || 'brew';
  const APPS = process.env.SHUB_APPS_DIR || '/Applications';
  const has = (bin) => spawnSync('which', [bin]).status === 0;

  async function socin(method, p, payload) {
    const l = link(); if (!l) bad('Chưa liên kết Socin: mở S Creator → Kết nối, nhập địa chỉ Socin và khoá S Creator của admin hoặc chủ doanh nghiệp.', 409);
    let r;
    try { r = await fetch(l.baseUrl + '/api/integration/creator/remote-devices' + p, { method, headers: { authorization: 'Bearer ' + l.token, 'content-type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(15000) }); }
    catch (e) { bad('Không gọi được Socin: ' + (e.message || e), 502); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) bad(r.status === 403 ? (j.message || 'Khoá S Creator không phải của admin hoặc chủ doanh nghiệp.') : r.status === 404 ? (p ? 'Không thấy máy này trên Socin.' : 'Bản Socin này chưa có Điều khiển từ xa cho S Hub (cần 0.161.0 trở lên).') : r.status === 401 ? 'Socin từ chối khoá S Creator: kiểm tra tab Kết nối của S Creator.' : (j.message || `Socin trả lỗi HTTP ${r.status}`), r.status === 400 ? 400 : 502);
    return j;
  }

  // ---- công cụ trên Mac ----
  const tsBin = () => { const p = path.join(APPS, 'Tailscale.app', 'Contents', 'MacOS', 'Tailscale'); return fs.existsSync(p) ? p : has('tailscale') ? 'tailscale' : ''; };
  const tailscale = () => {
    const b = tsBin(); if (!b) return { installed: false };
    const r = spawnSync(b, ['status', '--json'], { encoding: 'utf8', timeout: 4000 });
    try { const j = JSON.parse(r.stdout); return { installed: true, state: j.BackendState || '', ip: ((j.Self || {}).TailscaleIPs || []).find((x) => /^100\./.test(x)) || '' }; } catch { return { installed: true, state: 'unknown', ip: '' }; }
  };
  const tools = () => ({ rustdesk: fs.existsSync(path.join(APPS, 'RustDesk.app')), tailscale: tailscale(), brew: has(BREW) });

  // ---- cài RustDesk / Tailscale cho Mac bằng Homebrew ----
  let job = null; const LOG = [];
  const log = (s) => { for (const l of String(s).split('\n').filter((x) => x.trim())) { LOG.push({ t: Date.now(), s: l.slice(0, 1000) }); if (LOG.length > 300) LOG.shift(); } };
  const run = (args) => new Promise((resolve) => { log('$ brew ' + args.join(' ')); const p = spawn(BREW, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1' } }); p.stdout.on('data', log); p.stderr.on('data', log); p.on('error', (e) => { log(e.message); resolve(1); }); p.on('close', resolve); });
  async function setup(what) {
    if (!has(BREW)) bad('Chưa có Homebrew. Cài ở https://brew.sh, hoặc tải RustDesk ở rustdesk.com và Tailscale ở App Store.');
    if (what === 'rustdesk') { if (await run(['install', '--cask', 'rustdesk'])) bad('Cài RustDesk lỗi, xem nhật ký.'); }
    else if (what === 'tailscale') { if (await run(['install', '--cask', 'tailscale-app']) && await run(['install', '--cask', 'tailscale'])) bad('Cài Tailscale lỗi, xem nhật ký (hoặc cài từ App Store).'); }
    else bad('Không rõ cần cài gì.');
  }

  const TARGET = /^([0-9]{6,12}|100\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|[0-9a-f:]{3,45})$/i;
  const saveInstaller = (f) => {
    if (!f || !/^[A-Za-z0-9._-]{1,80}\.cmd$/.test(f.filename || '')) return null;
    fs.mkdirSync(DL, { recursive: true }); const p = path.join(DL, f.filename); fs.writeFileSync(p, f.content, { mode: 0o600 }); return p;
  };

  return async function handle(req, res, u) {
    if (!u.pathname.startsWith('/api/remote/')) return false;
    const r = u.pathname.slice(12), post = req.method === 'POST';
    try {
      if (r === 'status') return json(res, 200, { link: link() ? { baseUrl: link().baseUrl } : null, tools: tools(), job: job && { what: job.what, running: job.running, ok: job.ok, error: job.error } }), true;
      if (r === 'logs') return json(res, 200, { lines: LOG }), true;
      if (r === 'devices' && !post) return json(res, 200, await socin('GET', '')), true;
      if (!post) return json(res, 404, { error: 'not found' }), true;
      const b = await body(req);
      if (r === 'devices') { const out = await socin('POST', '', { name: b.name, mode: b.mode, server_host: b.server_host, server_key: b.server_key }); out.saved = saveInstaller(out.installer); return json(res, 201, out), true; }
      const m = /^devices\/([0-9a-f-]{36})\/install$/i.exec(r);
      if (m) { const out = await socin('POST', '/' + m[1] + '/install', {}); out.saved = saveInstaller(out.installer); return json(res, 200, out), true; }
      if (r === 'connect') {
        const t = String(b.target || '').trim(); if (!TARGET.test(t)) bad('Địa chỉ kết nối không hợp lệ.');
        if (!tools().rustdesk && !process.env.SHUB_APPS_DIR) bad('Mac này chưa có RustDesk: bấm "Cài RustDesk".');
        const p = spawn(OPEN, ['rustdesk://connection/new/' + encodeURIComponent(t)], { stdio: 'ignore', detached: true }); p.on('error', () => {}); p.unref();
        return json(res, 200, { ok: true }), true;
      }
      if (r === 'reveal') { const f = String(b.path || ''); if (!f.startsWith(DL + path.sep) || !fs.existsSync(f)) bad('Không thấy file.'); spawn(OPEN, ['-R', f], { stdio: 'ignore', detached: true }).unref(); return json(res, 200, { ok: true }), true; }
      if (r === 'open-app') { const a = b.app === 'tailscale' ? 'Tailscale' : 'RustDesk'; spawn(OPEN, ['-a', a], { stdio: 'ignore', detached: true }).unref(); return json(res, 200, { ok: true }), true; }
      if (r === 'setup') {
        if (job && job.running) bad('Đang cài, chờ xong.');
        job = { what: b.what, running: true };
        (async () => { try { await setup(b.what); job.ok = true; log('Cài xong.'); } catch (e) { job.ok = false; job.error = e.message; log('Lỗi: ' + e.message); } finally { job.running = false; } })();
        return json(res, 200, { ok: true }), true;
      }
      return json(res, 404, { error: 'not found' }), true;
    } catch (e) { return json(res, e.status || 500, { ok: false, error: e.message || String(e) }), true; }
  };
};
