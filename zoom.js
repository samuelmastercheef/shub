// S Zoom worker: cài, cấu hình, bật/tắt zoom-worker của Socin (Zoom giữ phòng) ngay trên máy này.
// Mã worker lấy từ thư mục zoom-worker/ của repo Socin (social). Khoá worker lưu ở settings.json (mode 600), không bao giờ trả về trình duyệt, không ghi vào log.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

module.exports = function init({ WS, cfg, json, body }) {
  const DIR = path.join(WS, 'zoom'); fs.mkdirSync(DIR, { recursive: true });
  const SETF = path.join(DIR, 'settings.json'); const LOGF = path.join(DIR, 'worker.log');
  const SRC = path.join(DIR, 'social'); // bản sao thưa (sparse) chỉ thư mục zoom-worker
  const REPO = process.env.SHUB_ZOOM_REPO || 'https://github.com/samuelmastercheef/social';
  const BRANCH = process.env.SHUB_ZOOM_BRANCH || 'main';
  const bad = (m, s = 400) => { const e = new Error(m); e.status = s; throw e; };
  const rj = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
  const DEF = { useLink: true, socinUrl: '', token: '', workerId: 'shub-mac', concurrency: 1, rejoinMax: 0, chromePath: '', workerDir: '', autoStart: false, autoRestart: true };
  const getSet = () => ({ ...DEF, ...rj(SETF, {}) });
  const saveSet = (s) => { fs.writeFileSync(SETF + '.tmp', JSON.stringify(s, null, 2), { mode: 0o600 }); fs.renameSync(SETF + '.tmp', SETF); fs.chmodSync(SETF, 0o600); };
  const wdir = (s = getSet()) => s.workerDir ? s.workerDir.replace(/^~(?=$|\/)/, require('os').homedir()) : path.join(SRC, 'zoom-worker');
  const has = (bin) => spawnSync('which', [bin]).status === 0;

  // ---- liên kết theo tài khoản Socin: dùng kết nối Socin của S Creator (địa chỉ + khoá spcr_ của admin) để tự nhận khoá worker ----
  const CRF = path.join(WS, 'creator', 'settings.json');
  const link = () => { const c = (rj(CRF, {}) || {}).socin || {}; return c.baseUrl && c.token ? { baseUrl: String(c.baseUrl).replace(/\/+$/, ''), token: c.token } : null; };
  let linkState = { at: 0, ok: null, error: '' }; let linkToken = '';
  async function fetchLinkedToken() {
    const l = link(); if (!l || getSet().useLink === false) return '';
    try {
      const r = await fetch(l.baseUrl + '/api/integration/creator/zoom-worker', { method: 'POST', headers: { authorization: 'Bearer ' + l.token, 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = r.status === 403 ? 'Khoá S Creator không phải của admin hệ thống (hoặc đã tắt), nên Socin không giao khoá worker.' : r.status === 409 ? 'Socin chưa có khoá worker: vào Cài đặt → 🎥 Zoom bấm "Tạo khoá worker".' : r.status === 404 ? 'Bản Socin này chưa hỗ trợ tự liên kết (cần bản 0.154.0 trở lên).' : r.status === 401 ? 'Socin từ chối khoá S Creator: kiểm tra tab Kết nối của S Creator.' : `Socin trả lỗi HTTP ${r.status}${j.message ? ': ' + j.message : ''}`;
        linkState = { at: Date.now(), ok: false, error: msg }; return '';
      }
      if (!j.token || String(j.token).length < 24) { linkState = { at: Date.now(), ok: false, error: 'Socin không trả khoá worker hợp lệ.' }; return ''; }
      linkState = { at: Date.now(), ok: true, error: '' }; linkToken = String(j.token); return linkToken;
    } catch (e) { linkState = { at: Date.now(), ok: false, error: 'Không gọi được Socin để lấy khoá: ' + (e.message || e) }; return ''; }
  }

  // ---- nhật ký: bộ đệm vòng + file, luôn che khoá worker ----
  const LOG = []; const MAXL = 600; let relinkAt = 0;
  const redact = (t) => { let s = String(t); for (const k of [getSet().token, linkToken, (link() || {}).token]) if (k && k.length >= 6) s = s.split(k).join('••••'); return s.replace(/(Bearer\s+)[A-Za-z0-9._~+\/=-]{6,}/gi, '$1••••').replace(/x-access-token:[^@\s]+@/g, 'x-access-token:••••@'); };
  const log = (src, chunk) => {
    const lines = redact(chunk).split('\n').filter((l) => l.trim());
    for (const l of lines) { const e = { t: Date.now(), src, s: l.slice(0, 2000) }; LOG.push(e); if (LOG.length > MAXL) LOG.shift(); try { fs.appendFileSync(LOGF, `${new Date(e.t).toISOString()} [${src}] ${e.s}\n`); } catch {} }
    try { if (fs.statSync(LOGF).size > 5e6) fs.renameSync(LOGF, LOGF + '.1'); } catch {}
    // Khoá bị Socin từ chối (admin vừa tạo khoá mới) → nếu đang tự liên kết thì lấy khoá mới và khởi động lại, tối đa 1 lần / 5 phút
    if (src === 'worker' && proc && /claim lỗi.*HTTP 401/.test(lines.join('\n')) && link() && getSet().useLink !== false && Date.now() - relinkAt > 5 * 60e3) {
      relinkAt = Date.now(); log('shub', 'Socin từ chối khoá worker, thử lấy khoá mới từ tài khoản Socin…');
      stop().then(() => start()).catch((e) => log('shub', 'Không lấy lại được khoá: ' + e.message));
    }
  };

  // ---- trạng thái worker ----
  let proc = null, startedAt = 0, stopping = false, lastExit = null, crashes = [], restartTimer = null;
  let job = null; // { kind:'install', running, ok, error }
  const workerInfo = () => {
    const d = wdir(); const pkg = rj(path.join(d, 'package.json'), null);
    const commit = fs.existsSync(path.join(SRC, '.git')) && !getSet().workerDir ? (spawnSync('git', ['-C', SRC, 'log', '-1', '--format=%h %cs %s'], { encoding: 'utf8' }).stdout || '').trim() : '';
    return { dir: d, present: !!pkg && fs.existsSync(path.join(d, 'worker.mjs')), version: pkg && pkg.version, deps: fs.existsSync(path.join(d, 'node_modules', 'playwright-core')) && fs.existsSync(path.join(d, 'node_modules', '@zoom', 'meetingsdk')), commit };
  };
  // Suy ra kết nối với Socin từ nhật ký: worker im lặng khi không có việc, chỉ in khi lỗi hoặc có phiên.
  const health = () => {
    if (!proc) return { state: 'stopped' };
    const mine = LOG.filter((e) => e.t >= startedAt && e.src !== 'shub');
    const lastErr = [...mine].reverse().find((e) => /claim lỗi|heartbeat lỗi|finish lỗi|Thiếu SOCIN_URL/.test(e.s));
    const lastOk = [...mine].reverse().find((e) => /vào họp|xong:|Socin bảo rời/.test(e.s));
    if (lastErr && (!lastOk || lastErr.t > lastOk.t)) {
      const m = /HTTP (\d{3})/.exec(lastErr.s); const code = m && Number(m[1]);
      const hint = code === 401 ? 'Socin từ chối khoá worker: sao chép lại khoá ở Socin (Cài đặt → 🎥 Zoom → Tạo khoá worker) rồi lưu ở đây.'
        : code === 404 ? 'Không thấy cổng worker trên Socin: kiểm tra Địa chỉ Socin (vd https://app.socin.org) và bản Socin đã có Zoom giữ phòng.'
          : code === 503 ? 'Socin chưa cài đủ khoá Zoom (Client ID, Client Secret, khoá worker).'
            : /fetch failed|ENOTFOUND|ECONNREFUSED|timeout|aborted/i.test(lastErr.s) ? 'Không gọi được Socin: kiểm tra mạng và Địa chỉ Socin.' : '';
      return { state: 'error', error: lastErr.s, at: lastErr.t, hint };
    }
    const sessions = mine.filter((e) => /vào họp/.test(e.s)).length - mine.filter((e) => /xong:/.test(e.s)).length;
    return { state: 'ok', busy: sessions > 0, uptimeS: Math.round((Date.now() - startedAt) / 1000) };
  };
  const pub = () => { const s = getSet(); return { link: link() ? { baseUrl: link().baseUrl, enabled: s.useLink !== false, ok: linkState.ok, error: linkState.error, at: linkState.at || null } : null, effectiveSocinUrl: socinOf(s), settings: { useLink: s.useLink !== false, socinUrl: s.socinUrl, workerId: s.workerId, concurrency: s.concurrency, rejoinMax: s.rejoinMax, chromePath: s.chromePath, workerDir: s.workerDir, autoStart: !!s.autoStart, autoRestart: !!s.autoRestart, hasToken: !!s.token }, worker: workerInfo(), running: !!proc, pid: proc ? proc.pid : null, startedAt: startedAt || null, lastExit, health: health(), job: job && { kind: job.kind, running: job.running, ok: job.ok, error: job.error }, tools: { git: has('git'), npm: has('npm'), node: process.version } }; };

  // ---- cài / cập nhật mã worker ----
  const ghToken = () => { if (cfg.githubToken) return cfg.githubToken; const r = spawnSync('gh auth token', { shell: true, encoding: 'utf8', timeout: 5000 }); return r.status === 0 ? r.stdout.trim() : ''; };
  const run = (cmd, args, opts = {}) => new Promise((resolve) => {
    log('shub', '$ ' + [cmd, ...args].join(' '));
    const p = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d) => log('cài', d)); p.stderr.on('data', (d) => log('cài', d));
    p.on('error', (e) => { log('cài', String(e.message)); resolve(1); }); p.on('close', (c) => resolve(c));
  });
  async function install() {
    const s = getSet();
    if (!s.workerDir) {
      // Token GitHub chỉ đi qua biến môi trường của git (không nằm trong URL, .git/config hay danh sách tiến trình)
      const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' }; const t = /^https:\/\/github\.com\//.test(REPO) ? ghToken() : '';
      if (t) Object.assign(env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: 'Authorization: Basic ' + Buffer.from('x-access-token:' + t).toString('base64') });
      if (!fs.existsSync(path.join(SRC, '.git'))) {
        fs.rmSync(SRC, { recursive: true, force: true });
        if (await run('git', ['clone', '--depth', '1', '--filter=blob:none', '--sparse', '-b', BRANCH, REPO, SRC], { env })) bad('Tải mã worker thất bại (repo private thì cần githubToken trong config.json hoặc gh auth login).');
        if (await run('git', ['-C', SRC, 'sparse-checkout', 'set', 'zoom-worker'], { env })) bad('Không lấy được thư mục zoom-worker.');
      } else {
        if (await run('git', ['-C', SRC, 'fetch', '--depth', '1', 'origin', BRANCH], { env })) bad('Cập nhật mã worker thất bại.');
        if (await run('git', ['-C', SRC, 'reset', '--hard', 'FETCH_HEAD'], { env })) bad('Cập nhật mã worker thất bại.');
      }
    }
    const d = wdir(s); if (!fs.existsSync(path.join(d, 'worker.mjs'))) bad('Không thấy worker.mjs trong ' + d);
    const npm = process.env.SHUB_NPM_BIN || 'npm';
    if (await run(npm, ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: d })) bad('npm install lỗi, xem nhật ký.');
    if (!s.chromePath && !process.env.SHUB_ZOOM_SKIP_BROWSER) { if (await run(process.env.SHUB_NPX_BIN || 'npx', ['playwright-core', 'install', 'chromium'], { cwd: d })) bad('Tải Chromium lỗi. Có thể điền Đường dẫn Chrome có sẵn (vd /Applications/Google Chrome.app/Contents/MacOS/Google Chrome).'); }
  }

  // ---- bật / tắt ----
  const socinOf = (s) => (s.socinUrl || (link() || {}).baseUrl || 'https://app.socin.org').replace(/\/+$/, '');
  let starting = false;
  async function start(manual = true) {
    if (proc || starting) return;
    if (job && job.running) bad('Đang cài worker, chờ xong rồi bật.');
    const s = getSet(); const socin = socinOf(s);
    if (!/^https?:\/\/[^\s/]+/.test(socin)) bad('Chưa có Địa chỉ Socin hợp lệ.');
    const w = workerInfo(); if (!w.present) bad('Chưa cài worker: bấm "Cài / cập nhật worker".'); if (!w.deps) bad('Worker thiếu thư viện: bấm "Cài / cập nhật worker".');
    starting = true; let token = '', via = 'khoá đã dán';
    try { token = await fetchLinkedToken(); } finally { starting = false; }
    if (token) via = 'khoá tự nhận từ tài khoản Socin'; else { if (linkState.error && link() && s.useLink !== false) log('shub', 'Tự liên kết chưa được: ' + linkState.error + (s.token ? ' Dùng khoá đã dán.' : '')); token = s.token; }
    if (!token) bad(link() && s.useLink !== false ? 'Chưa lấy được khoá worker: ' + linkState.error : 'Chưa có khoá worker: kết nối Socin trong S Creator (khoá của admin) để tự liên kết, hoặc dán khoá worker.');
    if (proc) return;
    if (manual) crashes = [];
    const env = { ...process.env, SOCIN_URL: socin, ZOOM_WORKER_TOKEN: token, WORKER_ID: s.workerId || 'shub-mac', WORKER_CONCURRENCY: String(Math.max(1, Math.min(8, Number(s.concurrency) || 1))), REJOIN_MAX: String(Math.max(0, Math.min(5, Number(s.rejoinMax) || 0))) };
    if (s.chromePath) env.CHROME_PATH = s.chromePath; else delete env.CHROME_PATH;
    delete env.ZOOM_FAKE; delete env.ZOOM_FAKE_OPTS; // S Hub không bao giờ chạy chế độ giả lập với Socin thật
    stopping = false; startedAt = Date.now(); clearTimeout(restartTimer);
    const p = spawn(process.execPath, ['worker.mjs'], { cwd: wdir(s), env, stdio: ['ignore', 'pipe', 'pipe'] });
    proc = p; log('shub', `Bật worker ${env.WORKER_ID} → ${env.SOCIN_URL} bằng ${via} (pid ${p.pid})`);
    p.stdout.on('data', (d) => log('worker', d)); p.stderr.on('data', (d) => log('worker', d));
    p.on('error', (e) => log('shub', 'Không chạy được worker: ' + e.message));
    p.on('close', (code, sig) => {
      if (proc === p) proc = null;
      lastExit = { code, signal: sig, at: Date.now(), planned: stopping };
      log('shub', stopping ? 'Đã tắt worker.' : `Worker dừng bất ngờ (mã ${code ?? sig}).`);
      if (!stopping && getSet().autoRestart) {
        crashes = crashes.filter((t) => Date.now() - t < 10 * 60e3); crashes.push(Date.now());
        if (crashes.length > 5) { log('shub', 'Worker dừng quá 5 lần trong 10 phút, ngừng tự bật lại. Xem lỗi ở trên.'); return; }
        const wait = 5000 * crashes.length; log('shub', `Tự bật lại sau ${wait / 1000} giây…`);
        restartTimer = setTimeout(() => { start(false).catch((e) => log('shub', 'Không tự bật lại được: ' + e.message)); }, wait); restartTimer.unref && restartTimer.unref();
      }
    });
  }
  const stop = () => new Promise((resolve) => {
    clearTimeout(restartTimer);
    if (!proc) return resolve();
    stopping = true; const p = proc;
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 8000);
    p.once('close', () => { clearTimeout(t); resolve(); });
    try { p.kill('SIGTERM'); } catch { resolve(); }
  });
  const killNow = () => { if (proc) { stopping = true; try { proc.kill('SIGTERM'); } catch {} } };
  process.on('exit', killNow);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => { killNow(); process.exit(0); });

  if (getSet().autoStart && !process.env.SHUB_NO_TIMER) setTimeout(() => { start().catch((e) => log('shub', 'Không tự bật worker khi mở S Hub: ' + e.message)); }, 1500).unref();

  return async function handle(req, res, u) {
    if (!u.pathname.startsWith('/api/zoom/')) return false;
    const r = u.pathname.slice(10), post = req.method === 'POST';
    try {
      if (r === 'status') return json(res, 200, pub()), true;
      if (r === 'logs') { const since = Number(u.searchParams.get('since') || 0); return json(res, 200, { lines: LOG.filter((e) => e.t > since) }), true; }
      if (!post) return json(res, 404, { error: 'not found' }), true;
      const b = await body(req);
      if (r === 'settings') {
        const s = getSet();
        if (b.socinUrl !== undefined) { const v = String(b.socinUrl).trim().replace(/\/+$/, ''); if (v && !/^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(v)) bad('Địa chỉ Socin phải bắt đầu bằng https://'); s.socinUrl = v; }
        if (b.token !== undefined && String(b.token).trim()) { const v = String(b.token).trim(); if (v.length < 16 || /\s/.test(v)) bad('Khoá worker không đúng dạng (sao chép đủ từ Socin).'); s.token = v; }
        if (b.clearToken) s.token = '';
        if (b.workerId !== undefined) { const v = String(b.workerId).trim(); if (v && !/^[A-Za-z0-9._-]{1,40}$/.test(v)) bad('Tên worker chỉ gồm chữ, số, . _ -'); s.workerId = v || DEF.workerId; }
        if (b.concurrency !== undefined) s.concurrency = Math.max(1, Math.min(8, Number(b.concurrency) || 1));
        if (b.rejoinMax !== undefined) s.rejoinMax = Math.max(0, Math.min(5, Number(b.rejoinMax) || 0));
        if (b.chromePath !== undefined) s.chromePath = String(b.chromePath).trim();
        if (b.workerDir !== undefined) s.workerDir = String(b.workerDir).trim();
        if (b.autoStart !== undefined) s.autoStart = !!b.autoStart;
        if (b.autoRestart !== undefined) s.autoRestart = !!b.autoRestart;
        if (b.useLink !== undefined) s.useLink = !!b.useLink;
        saveSet(s); log('shub', 'Đã lưu cài đặt' + (b.token && String(b.token).trim() ? ' (có khoá worker mới)' : '') + (proc ? '. Bấm Khởi động lại để áp dụng.' : '.'));
        return json(res, 200, pub()), true;
      }
      if (r === 'install') {
        if (job && job.running) bad('Đang cài rồi.');
        const wasRunning = !!proc; job = { kind: 'install', running: true };
        (async () => { try { if (wasRunning) await stop(); await install(); job.ok = true; log('shub', 'Cài / cập nhật worker xong.'); if (wasRunning) await start(); } catch (e) { job.ok = false; job.error = e.message; log('shub', 'Lỗi: ' + e.message); } finally { job.running = false; } })();
        return json(res, 200, pub()), true;
      }
      if (r === 'start') { await start(); return json(res, 200, pub()), true; }
      if (r === 'stop') { await stop(); return json(res, 200, pub()), true; }
      if (r === 'restart') { await stop(); await start(); return json(res, 200, pub()), true; }
      if (r === 'link-test') { const t = await fetchLinkedToken(); return json(res, 200, { ...pub(), linkTest: { ok: !!t, error: t ? '' : (link() ? linkState.error : 'Chưa kết nối Socin trong S Creator.') } }), true; }
      if (r === 'clear-log') { LOG.length = 0; try { fs.writeFileSync(LOGF, ''); } catch {} return json(res, 200, { ok: true }), true; }
      return json(res, 404, { error: 'not found' }), true;
    } catch (e) { return json(res, e.status || 500, { ok: false, error: redact(e.message || e) }), true; }
  };
};
