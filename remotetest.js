// Test S Remote: Socin giả, lệnh open/brew giả, thư mục Applications giả. Không cần mạng.
const { spawn } = require('child_process'); const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'shubr-')); const WS = path.join(T, 'ws'); const APPS = path.join(T, 'Applications'); fs.mkdirSync(APPS);
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL', m)); if (c) console.log('ok  ', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SPCR = 'spcr_owner_key_0123456789abcdef'; const OPENLOG = path.join(T, 'open.log'); const BREWLOG = path.join(T, 'brew.log');
fs.writeFileSync(path.join(T, 'open'), `#!/bin/bash\necho "$@" >> ${OPENLOG}\n`, { mode: 0o755 });
fs.writeFileSync(path.join(T, 'brew'), `#!/bin/bash\necho "$@" >> ${BREWLOG}\nif [ "$3" = "rustdesk" ]; then mkdir -p ${APPS}/RustDesk.app; fi\necho "installed $3"\n`, { mode: 0o755 });
const DEV = { id: '11111111-2222-3333-4444-555555555555', name: 'PC văn phòng', status: 'online', mode: 'tailscale', target: '100.101.102.103', hostname: 'DESKTOP-1', os: 'Windows 11', enrolled_at: '2026-11-26T00:00:00Z', last_seen_at: new Date().toISOString() };
const INST = { install_command: 'powershell ...', installer: { filename: 'Cai-dat-Socin-Remote-Laptop.cmd', content: '@echo off\r\nrem test\r\n' }, install_ttl_h: 24, uninstall_command: 'x' };
let lastBody = null;
const socin = http.createServer((q, r) => {
  let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => {
    const j = (c, o) => { r.writeHead(c, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(o)); };
    if (q.headers.authorization !== 'Bearer ' + SPCR) return j(401, { error: 'unauthorized' });
    const base = '/api/integration/creator/remote-devices';
    if (q.url === base && q.method === 'GET') return j(200, { devices: [DEV] });
    if (q.url === base && q.method === 'POST') { lastBody = JSON.parse(b); if (!lastBody.name) return j(400, { error: 'bad', message: 'Cần tên máy' }); return j(201, { device: { ...DEV, id: 'x', name: lastBody.name, status: 'pending' }, ...INST }); }
    if (q.url === base + '/' + DEV.id + '/install' && q.method === 'POST') return j(200, INST);
    j(404, { error: 'not_found' });
  });
});
const P = 4796;
const req = (p, o) => new Promise((res) => { const rq = http.request({ host: '127.0.0.1', port: P, path: p, method: o ? 'POST' : 'GET', headers: o ? { Origin: 'http://127.0.0.1:' + P } : {} }, (r) => { let d = ''; r.on('data', (x) => (d += x)); r.on('end', () => res({ s: r.statusCode, t: d, j: (() => { try { return JSON.parse(d || '{}'); } catch { return {}; } })() })); }); rq.end(o ? JSON.stringify(o) : undefined); });

socin.listen(0, async () => {
  const SU = 'http://127.0.0.1:' + socin.address().port;
  fs.writeFileSync(path.join(T, 'c.json'), JSON.stringify({ port: P, workspace: WS }));
  const srv = spawn('node', ['server.js'], { cwd: __dirname, env: { ...process.env, SHUB_CONFIG: path.join(T, 'c.json'), SHUB_NO_TIMER: '1', SHUB_OPEN_BIN: path.join(T, 'open'), SHUB_BREW_BIN: path.join(T, 'brew'), SHUB_APPS_DIR: APPS, GITHUB_TOKEN: '' }, stdio: 'ignore' });
  await sleep(900);
  try {
    ok((await req('/api/apps')).j.apps.some((a) => a.id === 'remote' && a.type === 'internal'), 'S Remote có trong danh sách tool');
    ok((await req('/remote.html')).s === 200, 'trang remote.html mở được');
    let st = (await req('/api/remote/status')).j; ok(st.link === null && st.tools.rustdesk === false, 'ban đầu: chưa liên kết, chưa có RustDesk');
    ok((await req('/api/remote/devices')).s === 409, 'chưa liên kết Socin → báo cần kết nối S Creator');
    fs.mkdirSync(path.join(WS, 'creator'), { recursive: true }); fs.writeFileSync(path.join(WS, 'creator', 'settings.json'), JSON.stringify({ socin: { baseUrl: SU + '/', token: SPCR } }));
    st = (await req('/api/remote/status')).j; ok(st.link && st.link.baseUrl === SU && !JSON.stringify(st).includes(SPCR), 'liên kết theo S Creator, không lộ khoá');
    const d = await req('/api/remote/devices'); ok(d.s === 200 && d.j.devices[0].target === DEV.target, 'lấy danh sách máy từ Socin');
    ok((await req('/api/remote/connect', { target: 'evil; rm -rf /' })).s === 400, 'địa chỉ kết nối lạ bị chặn');
    ok((await req('/api/remote/connect', { target: DEV.target })).s === 200, 'bấm Kết nối'); await sleep(300);
    ok(fs.readFileSync(OPENLOG, 'utf8').includes('rustdesk://connection/new/100.101.102.103'), 'mở RustDesk đúng địa chỉ');
    ok((await req('/api/remote/devices', { name: '' })).s === 400, 'Socin báo lỗi đầu vào → 400');
    const c = await req('/api/remote/devices', { name: 'Laptop', mode: 'tailscale' });
    ok(c.s === 201 && c.j.installer.filename === INST.installer.filename && lastBody.name === 'Laptop', 'thêm máy, nhận bộ cài');
    ok(c.j.saved && fs.readFileSync(c.j.saved, 'utf8') === INST.installer.content && (fs.statSync(c.j.saved).mode & 0o777) === 0o600, 'bộ cài lưu vào Kho file (mode 600)');
    ok((await req('/api/remote/devices/' + DEV.id + '/install', {})).s === 200, 'bộ cài mới cho máy có sẵn');
    ok((await req('/api/remote/reveal', { path: '/etc/passwd' })).s === 400, 'Mở trong Finder chỉ cho file trong Kho file');
    ok((await req('/api/remote/setup', { what: 'rustdesk' })).s === 200, 'bấm Cài RustDesk');
    for (let i = 0; i < 30 && (st = (await req('/api/remote/status')).j).job.running; i++) await sleep(100);
    ok(st.job.ok && st.tools.rustdesk && /install --cask rustdesk/.test(fs.readFileSync(BREWLOG, 'utf8')), 'cài RustDesk bằng brew');
    fs.writeFileSync(path.join(WS, 'creator', 'settings.json'), JSON.stringify({ socin: { baseUrl: SU, token: 'spcr_wrong_wrong_wrong_wrong' } }));
    ok((await req('/api/remote/devices')).s === 502 && /từ chối khoá/.test((await req('/api/remote/devices')).j.error), 'khoá sai → báo kiểm tra kết nối S Creator');
  } catch (e) { fail++; console.log('FAIL', e); }
  srv.kill(); socin.close(); fs.rmSync(T, { recursive: true, force: true });
  console.log(`\n${pass} đạt, ${fail} lỗi`); process.exit(fail ? 1 : 0);
});
