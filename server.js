#!/usr/bin/env node
// Test Hub - server không phụ thuộc thư viện ngoài (chỉ cần Node 18+, git).
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const ROOT = __dirname;
const expand = (p) => p.replace(/^~(?=$|\/)/, os.homedir());
let cfg = { apps: null, port: 4777, workspace: '~/TestHubWorkspace', githubToken: '', owner: '', timeoutMinutes: 10 };
try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')) }; } catch {}
cfg.githubToken = process.env.GITHUB_TOKEN || cfg.githubToken;
const DEFAULT_APPS = [
  { id: 'build', name: 'S Build Hub', icon: '🛠', type: 'web', titleMatch: 'Build Hub', url: '', startCommand: '', desc: 'Build app Mac / Win / Android / iOS từ repo GitHub' },
  { id: 'test', name: 'S Test Hub', icon: '🧪', type: 'internal', path: '/test.html', desc: 'Lint, build, test, bảo mật, giao diện cho repo GitHub' },
  { id: 'vps', name: 'S VPS', icon: '🖥', type: 'internal', path: '/vps.html', desc: 'Quản lý VPS: deploy từ GitHub, tự cập nhật, dọn rác tự động' },
  { id: 'chat', name: 'S Chat', icon: '💬', type: 'launch', command: 'open -a "S Chat"', desc: 'Chat Telegram đa tài khoản' },
  { id: 'vpn', name: 'S VPN', icon: '🔒', type: 'launch', command: 'open -a "S VPN"', desc: 'VPN riêng WireGuard' },
  { id: 'clean', name: 'S Clean', icon: '🧹', type: 'launch', command: 'open -a "S Clean"', desc: 'Dọn dẹp MacBook' },
  { id: 'terminal', name: 'Terminal Socin', icon: '⌨️', type: 'launch', command: 'open -a "Terminal Socin"', desc: 'Terminal riêng có menu lệnh nhanh' },
];
const APPS = Array.isArray(cfg.apps) && cfg.apps.length ? [...cfg.apps] : [...DEFAULT_APPS];
if (!APPS.some((a) => a.id === 'vps')) APPS.splice(2, 0, DEFAULT_APPS.find((a) => a.id === 'vps'));
const appById = (id) => APPS.find((a) => a.id === id);
const WS = expand(cfg.workspace);
const REPOS = path.join(WS, 'repos');
const REPORTS = path.join(WS, 'reports');
fs.mkdirSync(REPOS, { recursive: true });
fs.mkdirSync(REPORTS, { recursive: true });

const sh = (cmd, opts = {}) => spawnSync(cmd, { shell: true, encoding: 'utf8', ...opts });
const has = (bin) => sh(`command -v ${bin}`).status === 0;
const safeName = (s) => String(s).replace(/[^a-zA-Z0-9._-]/g, '_');

// ---------- Danh sách repo ----------
async function listRepos() {
  if (cfg.githubToken) {
    const out = [];
    for (let page = 1; page <= 5; page++) {
      const r = await fetch(`https://api.github.com/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator`, {
        headers: { Authorization: `Bearer ${cfg.githubToken}`, 'User-Agent': 'test-hub', Accept: 'application/vnd.github+json' },
      });
      if (!r.ok) throw new Error('GitHub API lỗi ' + r.status + ' - kiểm tra githubToken');
      const j = await r.json();
      out.push(...j.map((x) => ({ name: x.full_name, url: x.clone_url, private: x.private, pushed: x.pushed_at })));
      if (j.length < 100) break;
    }
    return out;
  }
  if (has('gh')) {
    const r = sh(`gh repo list ${cfg.owner || ''} --limit 100 --json nameWithOwner,url,isPrivate,pushedAt`);
    if (r.status === 0) {
      return JSON.parse(r.stdout).map((x) => ({ name: x.nameWithOwner, url: x.url + '.git', private: x.isPrivate, pushed: x.pushedAt }));
    }
  }
  return [];
}

// ---------- Chạy lệnh có stream ----------
function run(cmd, cwd, emit, { timeoutMs = cfg.timeoutMinutes * 60000, env = {} } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, { shell: true, cwd, env: { ...process.env, CI: '1', FORCE_COLOR: '0', ...env }, detached: true });
    let out = '';
    const feed = (d) => { const s = d.toString(); out += s; emit(s); };
    p.stdout.on('data', feed); p.stderr.on('data', feed);
    const t = setTimeout(() => { emit('\n[Test Hub] Quá thời gian, dừng lệnh\n'); try { process.kill(-p.pid, 'SIGKILL'); } catch {} }, timeoutMs);
    p.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? 1, out }); });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: 1, out: out + String(e) }); });
  });
}

// ---------- Nhận diện dự án ----------
function detect(dir) {
  const f = (n) => fs.existsSync(path.join(dir, n));
  const types = [];
  let pkg = null;
  if (f('package.json')) { try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch {} types.push('node'); }
  if (f('requirements.txt') || f('pyproject.toml') || f('setup.py')) types.push('python');
  if (f('go.mod')) types.push('go');
  const pm = f('pnpm-lock.yaml') ? 'pnpm' : f('yarn.lock') ? 'yarn' : f('bun.lockb') ? 'bun' : 'npm';
  return { types, pkg, pm, ts: f('tsconfig.json') };
}

// ---------- Quét secret ----------
const SECRET_RULES = [
  ['AWS Access Key', /AKIA[0-9A-Z]{16}/g],
  ['GitHub token', /gh[pousr]_[A-Za-z0-9]{36,}/g],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['Telegram bot token', /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/g],
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/g],
  ['Slack token', /xox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['Stripe live key', /sk_live_[0-9a-zA-Z]{20,}/g],
  ['Gán khóa/mật khẩu cứng', /(?:api[_-]?key|secret|passwd|password|token)\s*[:=]\s*['"][A-Za-z0-9_\-\/+=]{16,}['"]/gi],
];
function scanSecrets(dir) {
  const skip = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'vendor', 'venv', '.venv', 'coverage', '__pycache__']);
  const findings = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.isFile()) continue;
      const rel = path.relative(dir, p);
      if (/^\.env(\.|$)/.test(e.name) && !/example|sample|template/.test(e.name))
        findings.push({ file: rel, line: 0, rule: 'File .env nằm trong repo', sample: '' });
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.size > 1024 * 1024 || /\.(png|jpe?g|gif|ico|pdf|zip|woff2?|ttf|mp[34]|lock|map|min\.js)$/i.test(e.name)) continue;
      let txt; try { txt = fs.readFileSync(p, 'utf8'); } catch { continue; }
      if (txt.includes('\u0000')) continue;
      txt.split('\n').forEach((ln, i) => {
        if (ln.length > 2000) return;
        for (const [rule, re] of SECRET_RULES) {
          re.lastIndex = 0;
          const m = re.exec(ln);
          if (m) findings.push({ file: rel, line: i + 1, rule, sample: m[0].slice(0, 6) + '…' + m[0].slice(-3) });
        }
      });
    }
  };
  walk(dir);
  return findings;
}

// ---------- UI smoke test ----------
async function uiTest(dir, info, emit, reportDir) {
  const scripts = (info.pkg && info.pkg.scripts) || {};
  const start = ['preview', 'start', 'dev'].find((s) => scripts[s]);
  if (!start) return { status: 'skip', note: 'Không có script preview/start/dev' };
  emit(`[UI] Khởi động: ${info.pm} run ${start}\n`);
  const p = spawn(`${info.pm} run ${start}`, { shell: true, cwd: dir, env: { ...process.env, BROWSER: 'none', CI: '', PORT: '0' }, detached: true });
  let buf = '';
  let port = null;
  const onData = (d) => { buf += d.toString(); const m = buf.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{2,5})/); if (m && !port) port = m[1]; };
  p.stdout.on('data', onData); p.stderr.on('data', onData);
  const kill = () => { try { process.kill(-p.pid, 'SIGKILL'); } catch {} };
  try {
    for (let i = 0; i < 60 && !port; i++) await new Promise((r) => setTimeout(r, 1000));
    if (!port) { emit(buf.slice(-1500)); return { status: 'fail', note: 'Server không báo cổng sau 60 giây' }; }
    const url = `http://127.0.0.1:${port}/`;
    emit(`[UI] Server chạy tại ${url}\n`);
    let res;
    for (let i = 0; i < 20; i++) {
      try { res = await fetch(url); break; } catch { await new Promise((r) => setTimeout(r, 1000)); }
    }
    if (!res) return { status: 'fail', note: 'Không kết nối được ' + url };
    const html = await res.text();
    const issues = [];
    if (res.status >= 400) issues.push('HTTP ' + res.status);
    if (!/<title>[^<]+<\/title>/i.test(html)) issues.push('Thiếu thẻ <title>');
    let shot = null;
    let pw = null;
    try { pw = require('playwright'); } catch {}
    if (pw) {
      try {
        const br = await pw.chromium.launch();
        const pg = await br.newPage({ viewport: { width: 1280, height: 800 } });
        const errs = [];
        pg.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
        pg.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
        pg.on('requestfailed', (r) => errs.push('request lỗi: ' + r.url()));
        await pg.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        shot = 'screenshot.png';
        await pg.screenshot({ path: path.join(reportDir, shot), fullPage: true });
        await br.close();
        errs.slice(0, 20).forEach((e) => issues.push(e));
        emit('[UI] Đã chụp màn hình bằng Playwright\n');
      } catch (e) { emit('[UI] Playwright lỗi: ' + e.message + '\n'); issues.push('Playwright: ' + e.message.split('\n')[0]); }
    } else emit('[UI] Chưa cài Playwright, chỉ kiểm tra HTTP (chạy: npm i playwright && npx playwright install chromium)\n');
    return { status: issues.length ? 'fail' : 'pass', note: issues.join(' | ') || (pw ? 'Trang tải sạch, không lỗi console' : 'HTTP OK (chưa có Playwright)'), screenshot: shot };
  } finally { kill(); }
}

// ---------- Chạy toàn bộ kiểm tra ----------
const runs = new Map(); // id -> {log:[], clients:Set, done}
async function runChecks(repo, id, opts) {
  const R = runs.get(id);
  const emit = (s) => { R.log.push(s); R.clients.forEach((c) => c.write(`data: ${JSON.stringify({ t: 'log', s })}\n\n`)); };
  const step = (name, status, note) => { const e = { t: 'step', name, status, note: note || '' }; R.steps.push(e); R.clients.forEach((c) => c.write(`data: ${JSON.stringify(e)}\n\n`)); };
  const results = [];
  const record = (name, status, note, extra = {}) => { results.push({ name, status, note, ...extra }); step(name, status, note); };
  const reportDir = path.join(REPORTS, id);
  fs.mkdirSync(reportDir, { recursive: true });
  const started = Date.now();
  try {
    const dir = path.join(REPOS, safeName(repo.name));
    const url = repo.url.includes('github.com') && cfg.githubToken && !/^git@/.test(repo.url)
      ? repo.url.replace('https://', `https://x-access-token:${cfg.githubToken}@`) : repo.url;
    step('Tải mã nguồn', 'running');
    let r;
    if (fs.existsSync(path.join(dir, '.git'))) {
      r = await run(`git remote set-url origin '${url}' && git fetch --all --prune && git reset --hard ${opts.branch ? 'origin/' + opts.branch : '@{u}'} && git clean -fdx -e node_modules`, dir, emit);
    } else {
      r = await run(`git clone --depth 50 ${opts.branch ? '-b ' + opts.branch : ''} '${url}' '${dir}'`, REPOS, emit);
    }
    if (r.code !== 0) { record('Tải mã nguồn', 'fail', 'git lỗi, kiểm tra quyền truy cập repo'); return; }
    const head = sh('git log -1 --pretty=%h\\ %s', { cwd: dir }).stdout.trim();
    record('Tải mã nguồn', 'pass', head);

    const info = detect(dir);
    emit(`\n[Test Hub] Loại dự án: ${info.types.join(', ') || 'không rõ'}\n`);
    const checks = opts.checks;
    const scripts = (info.pkg && info.pkg.scripts) || {};
    const pm = info.pm;

    if (info.types.includes('node')) {
      const rr = (s) => (pm === 'npm' ? `npm run ${s}` : `${pm} run ${s}`);
      step('Cài thư viện', 'running');
      const inst = await run(pm === 'npm' ? (fs.existsSync(path.join(dir, 'package-lock.json')) ? 'npm ci --no-audit --no-fund' : 'npm install --no-audit --no-fund') : `${pm} install`, dir, emit);
      record('Cài thư viện', inst.code === 0 ? 'pass' : 'fail', inst.code === 0 ? '' : 'Cài thất bại');
      if (inst.code === 0) {
        if (checks.lint) {
          const s = ['lint', 'eslint'].find((x) => scripts[x]);
          if (!s) record('Lint', 'skip', 'Không có script lint');
          else { step('Lint', 'running'); const x = await run(rr(s), dir, emit); record('Lint', x.code === 0 ? 'pass' : 'fail', x.code === 0 ? '' : tail(x.out)); }
        }
        if (checks.typecheck) {
          const s = ['typecheck', 'type-check', 'tsc'].find((x) => scripts[x]);
          if (s) { step('Type-check', 'running'); const x = await run(rr(s), dir, emit); record('Type-check', x.code === 0 ? 'pass' : 'fail', x.code === 0 ? '' : tail(x.out)); }
          else if (info.ts) { step('Type-check', 'running'); const x = await run('npx --no-install tsc --noEmit', dir, emit); record('Type-check', x.code === 0 ? 'pass' : 'fail', x.code === 0 ? '' : tail(x.out)); }
          else record('Type-check', 'skip', 'Không dùng TypeScript');
        }
        if (checks.build) {
          if (!scripts.build) record('Build', 'skip', 'Không có script build');
          else { step('Build', 'running'); const x = await run(rr('build'), dir, emit); record('Build', x.code === 0 ? 'pass' : 'fail', x.code === 0 ? '' : tail(x.out)); }
        }
        if (checks.test) {
          if (!scripts.test || /no test specified/.test(scripts.test)) record('Unit/API test', 'skip', 'Chưa có test. Gợi ý: nhờ Claude viết test cho các route chính');
          else { step('Unit/API test', 'running'); const x = await run(rr('test'), dir, emit, { env: { CI: '1' } }); record('Unit/API test', x.code === 0 ? 'pass' : 'fail', x.code === 0 ? summarize(x.out) : tail(x.out)); }
        }
      }
    }
    if (info.types.includes('python') && checks.test) {
      step('Python test', 'running');
      const req = fs.existsSync(path.join(dir, 'requirements.txt')) ? 'pip install -q -r requirements.txt && ' : '';
      const x = await run(`python3 -m venv .thvenv && . .thvenv/bin/activate && ${req}pip install -q pytest && pytest -q`, dir, emit);
      record('Python test', x.code === 0 ? 'pass' : x.code === 5 ? 'skip' : 'fail', x.code === 5 ? 'Không có test' : tail(x.out));
    }
    if (info.types.includes('go') && checks.build) {
      step('Go vet + test', 'running');
      const x = await run('go vet ./... && go test ./...', dir, emit);
      record('Go vet + test', x.code === 0 ? 'pass' : 'fail', x.code === 0 ? '' : tail(x.out));
    }
    if (checks.security) {
      if (info.types.includes('node')) {
        step('Lỗ hổng thư viện (npm audit)', 'running');
        const x = await run(`${pm === 'npm' ? 'npm' : 'npm'} audit --json --omit=dev`, dir, () => {});
        try {
          const j = JSON.parse(x.out); const v = (j.metadata && j.metadata.vulnerabilities) || {};
          const bad = (v.high || 0) + (v.critical || 0);
          const note = `critical ${v.critical || 0}, high ${v.high || 0}, moderate ${v.moderate || 0}, low ${v.low || 0}`;
          record('Lỗ hổng thư viện (npm audit)', bad ? 'fail' : 'pass', note);
        } catch { record('Lỗ hổng thư viện (npm audit)', 'skip', 'Không chạy được npm audit (cần package-lock.json)'); }
      }
      step('Quét khóa bí mật', 'running');
      const f = scanSecrets(dir);
      record('Quét khóa bí mật', f.length ? 'fail' : 'pass', f.length ? `${f.length} chỗ nghi lộ khóa` : 'Không thấy khóa lộ', { findings: f.slice(0, 100) });
      f.slice(0, 30).forEach((x) => emit(`[SECRET] ${x.file}:${x.line} ${x.rule} ${x.sample}\n`));
    }
    if (checks.ui && info.types.includes('node')) {
      step('Test giao diện', 'running');
      const u = await uiTest(dir, info, emit, reportDir);
      record('Test giao diện', u.status, u.note, u.screenshot ? { screenshot: u.screenshot } : {});
    }
  } catch (e) {
    emit('\n[Test Hub] Lỗi: ' + (e.stack || e) + '\n');
    record('Hệ thống', 'fail', String(e.message || e));
  } finally {
    const failed = results.filter((x) => x.status === 'fail').length;
    const report = { id, repo: repo.name, at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), results, failed, passed: results.filter((x) => x.status === 'pass').length };
    fs.writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(reportDir, 'log.txt'), R.log.join(''));
    R.done = report;
    R.clients.forEach((c) => { c.write(`data: ${JSON.stringify({ t: 'done', report })}\n\n`); c.end(); });
  }
}
const tail = (s) => s.trim().split('\n').slice(-12).join('\n').slice(-1500);
const summarize = (s) => (s.match(/(Tests?:.*|\d+ passed.*|ok\s+\S+.*)/i) || [''])[0].slice(0, 200);

// ---------- Hub: phát hiện app web đang chạy ----------
let scanCache = { at: 0, map: [] };
async function scanLocalApps() {
  if (Date.now() - scanCache.at < 8000) return scanCache.map;
  const r = sh('lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | awk \'NR>1{print $9}\' | sed \'s/.*://\' | sort -un');
  const ports = (r.stdout || '').split('\n').map(Number).filter((p) => p >= 1024 && p !== cfg.port).slice(0, 60);
  const map = [];
  await Promise.all(ports.map(async (p) => {
    try {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 900);
      const x = await fetch(`http://127.0.0.1:${p}/`, { signal: c.signal }); clearTimeout(t);
      const m = (await x.text()).slice(0, 20000).match(/<title>([^<]*)<\/title>/i);
      map.push({ port: p, title: m ? m[1].trim() : '' });
    } catch {}
  }));
  scanCache = { at: Date.now(), map };
  return map;
}
async function appStatus(a) {
  if (a.type === 'internal') return { online: true, url: a.path };
  if (a.type === 'launch') return { online: null, url: null };
  let url = a.url;
  if (!url && a.titleMatch) { const f = (await scanLocalApps()).find((x) => x.title.toLowerCase().includes(a.titleMatch.toLowerCase())); if (f) url = `http://127.0.0.1:${f.port}/`; }
  if (!url) return { online: false, url: null };
  try { const c = new AbortController(); setTimeout(() => c.abort(), 1500); await fetch(url, { signal: c.signal }); return { online: true, url }; } catch { return { online: false, url }; }
}

// ---------- HTTP ----------
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain; charset=utf-8' };

const vpsHandle = require('./vps')({ WS, json, body });
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  // Chặn truy cập từ trang web lạ / DNS rebinding: chỉ nhận Host và Origin là local
  const hostOk = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '');
  const origin = req.headers.origin;
  const originOk = !origin || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
  if (!hostOk || (req.method !== 'GET' && !originOk)) return json(res, 403, { error: 'forbidden' });
  try {
    if (await vpsHandle(req, res, u)) return;
    if (u.pathname === '/api/apps') {
      const out = await Promise.all(APPS.map(async (a) => ({ id: a.id, name: a.name, icon: a.icon, type: a.type, desc: a.desc, canStart: !!a.startCommand, ...(await appStatus(a)) })));
      return json(res, 200, { apps: out });
    }
    if (u.pathname === '/api/launch' && req.method === 'POST') {
      const a = appById((await body(req)).id);
      const cmd = a && (a.type === 'launch' ? a.command : a.startCommand);
      if (!cmd) return json(res, 400, { error: 'App chưa cấu hình lệnh khởi động trong config.json' });
      spawn(cmd, { shell: true, detached: true, stdio: 'ignore' }).unref();
      scanCache.at = 0;
      return json(res, 200, { ok: true });
    }
    if (u.pathname === '/api/repos') return json(res, 200, { repos: await listRepos(), hasToken: !!cfg.githubToken, hasGh: has('gh') });
    if (u.pathname === '/api/env') return json(res, 200, { node: process.version, git: has('git'), python: has('python3'), go: has('go'), gh: has('gh'), playwright: (() => { try { require.resolve('playwright'); return true; } catch { return false; } })(), workspace: WS });
    if (u.pathname === '/api/run' && req.method === 'POST') {
      const b = await body(req);
      if (!b.url || !b.name) return json(res, 400, { error: 'Thiếu name/url' });
      if (!/^(https:\/\/|git@|\/)/.test(b.url)) return json(res, 400, { error: 'URL phải là https hoặc git@' });
      const id = new Date().toISOString().replace(/[:.]/g, '-') + '_' + safeName(b.name);
      runs.set(id, { log: [], steps: [], clients: new Set(), done: null });
      runChecks({ name: b.name, url: b.url }, id, { branch: b.branch && safeName(b.branch), checks: { lint: 1, typecheck: 1, build: 1, test: 1, security: 1, ui: 1, ...(b.checks || {}) } });
      return json(res, 200, { id });
    }
    if (u.pathname === '/api/stream') {
      const R = runs.get(u.searchParams.get('id'));
      if (!R) return json(res, 404, {});
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      R.steps.forEach((e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
      res.write(`data: ${JSON.stringify({ t: 'log', s: R.log.join('') })}\n\n`);
      if (R.done) { res.write(`data: ${JSON.stringify({ t: 'done', report: R.done })}\n\n`); return res.end(); }
      R.clients.add(res); req.on('close', () => R.clients.delete(res)); return;
    }
    if (u.pathname === '/api/reports') {
      const list = fs.readdirSync(REPORTS).sort().reverse().slice(0, 50).map((d) => { try { return JSON.parse(fs.readFileSync(path.join(REPORTS, d, 'report.json'), 'utf8')); } catch { return null; } }).filter(Boolean);
      return json(res, 200, { reports: list });
    }
    if (u.pathname.startsWith('/reports/')) {
      const p = path.join(REPORTS, path.normalize(u.pathname.slice(9)).replace(/^(\.\.[\/\\])+/, ''));
      if (!p.startsWith(REPORTS) || !fs.existsSync(p)) return json(res, 404, {});
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); return fs.createReadStream(p).pipe(res);
    }
    const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const p = path.join(ROOT, 'public', path.normalize(f));
    if (p.startsWith(path.join(ROOT, 'public')) && fs.existsSync(p)) { res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'text/plain' }); return fs.createReadStream(p).pipe(res); }
    json(res, 404, { error: 'not found' });
  } catch (e) { json(res, 500, { error: String(e.message || e) }); }
}).listen(cfg.port, '127.0.0.1', () => console.log(`Test Hub chạy tại http://127.0.0.1:${cfg.port}\nWorkspace: ${WS}`));
