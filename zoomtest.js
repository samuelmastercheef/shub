// Test S Zoom worker: repo git giả chứa zoom-worker giả, npm giả, Socin giả. Không cần mạng, không cần Chrome.
const { spawn, execSync } = require('child_process'); const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'shubz-')); const WS = path.join(T, 'ws');
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL', m)); if (c) console.log('ok  ', m); };
let TOKEN = 'zwk_' + 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'; const SPCR = 'spcr_admin_key_0123456789abcdef'; let linkMode = 'ok', linkHits = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// repo Socin giả: zoom-worker/worker.mjs gọi /claim như worker thật, cố tình in khoá để thử che
const R = path.join(T, 'social'); fs.mkdirSync(path.join(R, 'zoom-worker'), { recursive: true });
fs.writeFileSync(path.join(R, 'zoom-worker', 'package.json'), JSON.stringify({ name: 'socin-zoom-worker', version: '0.1.0', type: 'module' }));
fs.writeFileSync(path.join(R, 'zoom-worker', 'worker.mjs'), `
const u = process.env.SOCIN_URL, t = process.env.ZOOM_WORKER_TOKEN;
console.log('zoom-worker ' + process.env.WORKER_ID + ' → ' + u + ' token=' + t + ' fake=' + (process.env.ZOOM_FAKE || ''));
for (;;) {
  try { const r = await fetch(u + '/api/integration/zoom-worker/claim', { method: 'POST', headers: { authorization: 'Bearer ' + t } }); if (r.status !== 204 && !r.ok) console.log('claim lỗi: /claim → HTTP ' + r.status); }
  catch (e) { console.log('claim lỗi:', e.message); }
  await new Promise((r) => setTimeout(r, 300));
}`);
fs.mkdirSync(path.join(R, 'src')); fs.writeFileSync(path.join(R, 'src', 'app.ts'), 'không được lấy');
execSync('git init -q -b main && git add -A && git -c user.email=t@t -c user.name=t commit -qm init', { cwd: R });
const npm = path.join(T, 'fakenpm'); fs.writeFileSync(npm, '#!/bin/bash\nmkdir -p node_modules/playwright-core node_modules/@zoom/meetingsdk && echo "added 2 packages"\n', { mode: 0o755 });

let claims = 0, seenAuth = '';
const socin = http.createServer((q, r) => {
  if (q.url === '/api/integration/creator/zoom-worker' && q.method === 'POST') { linkHits++; const j = (c, o) => { r.writeHead(c, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(o)); }; if (q.headers.authorization !== 'Bearer ' + SPCR) return j(401, { error: 'unauthorized' }); if (linkMode === 'forbidden') return j(403, { error: 'forbidden' }); return j(200, { token: TOKEN, configured: true }); }
  if (q.url === '/api/integration/zoom-worker/claim') { claims++; seenAuth = q.headers.authorization; r.writeHead(q.headers.authorization === 'Bearer ' + TOKEN ? 204 : 401); return r.end(); } r.writeHead(404); r.end(); });
const P = 4795;
const req = (p, o) => new Promise((res) => { const rq = http.request({ host: '127.0.0.1', port: P, path: p, method: o ? 'POST' : 'GET', headers: o ? { Origin: 'http://127.0.0.1:' + P } : {} }, (r) => { let d = ''; r.on('data', (x) => (d += x)); r.on('end', () => res({ s: r.statusCode, t: d, j: (() => { try { return JSON.parse(d || '{}'); } catch { return {}; } })() })); }); rq.end(o ? JSON.stringify(o) : undefined); });

socin.listen(0, async () => {
  const SU = 'http://127.0.0.1:' + socin.address().port;
  fs.writeFileSync(path.join(T, 'c.json'), JSON.stringify({ port: P, workspace: WS }));
  const srv = spawn('node', ['server.js'], { cwd: __dirname, env: { ...process.env, SHUB_CONFIG: path.join(T, 'c.json'), SHUB_NO_TIMER: '1', SHUB_ZOOM_REPO: R, SHUB_NPM_BIN: npm, SHUB_ZOOM_SKIP_BROWSER: '1', ZOOM_FAKE: '1', GITHUB_TOKEN: '' }, stdio: 'ignore' });
  await sleep(900);
  try {
    const apps = (await req('/api/apps')).j.apps; ok(apps.some((a) => a.id === 'zoom' && a.type === 'internal'), 'S Zoom worker có trong danh sách tool');
    ok((await req('/zoom.html')).s === 200, 'trang zoom.html mở được');
    let st = (await req('/api/zoom/status')).j; ok(!st.running && !st.settings.hasToken && !st.worker.present, 'ban đầu: tắt, chưa khoá, chưa cài');
    ok((await req('/api/zoom/start', {})).s === 400, 'chưa khoá/chưa cài thì không bật được');
    ok((await req('/api/zoom/settings', { socinUrl: 'ftp://x' })).s === 400, 'địa chỉ Socin sai dạng bị chặn');
    ok((await req('/api/zoom/settings', { token: 'ngắn' })).s === 400, 'khoá quá ngắn bị chặn');
    ok((await req('/api/zoom/settings', { token: 'zwk_wrongwrongwrongwrong', socinUrl: SU + '/' })).s === 200, 'lưu cài đặt');
    const raw = fs.readFileSync(path.join(WS, 'zoom', 'settings.json'), 'utf8');
    ok((fs.statSync(path.join(WS, 'zoom', 'settings.json')).mode & 0o777) === 0o600, 'file cài đặt mode 600');
    ok(!/"token"/.test((await req('/api/zoom/status')).t) && /zwk_wrong/.test(raw), 'API không bao giờ trả khoá, khoá chỉ nằm trong file 600');
    ok((await req('/api/zoom/status')).j.settings.socinUrl === SU, 'bỏ dấu / cuối địa chỉ Socin');

    await req('/api/zoom/install', {});
    for (let i = 0; i < 50 && (st = (await req('/api/zoom/status')).j).job.running; i++) await sleep(200);
    ok(st.job.ok && st.worker.present && st.worker.deps, 'cài worker từ repo (sparse) + npm install: ' + (st.job.error || 'ok'));
    ok(!fs.existsSync(path.join(WS, 'zoom', 'social', 'src')), 'chỉ lấy thư mục zoom-worker');
    ok(/init/.test(st.worker.commit), 'hiện commit của worker');

    ok((await req('/api/zoom/start', {})).s === 200, 'bật worker');
    await sleep(1500); st = (await req('/api/zoom/status')).j;
    ok(st.running && st.health.state === 'error' && /401/.test(st.health.error) && /khoá worker/.test(st.health.hint), 'khoá sai → báo lỗi 401 kèm cách sửa');
    await req('/api/zoom/settings', { token: TOKEN }); ok((await req('/api/zoom/restart', {})).s === 200, 'đổi khoá + khởi động lại');
    const c0 = claims; await sleep(1500); st = (await req('/api/zoom/status')).j;
    ok(st.running && st.health.state === 'ok' && claims > c0 && seenAuth === 'Bearer ' + TOKEN, 'khoá đúng → worker liên lạc với Socin, trạng thái tốt');
    const lg = (await req('/api/zoom/logs')).t; const file = fs.readFileSync(path.join(WS, 'zoom', 'worker.log'), 'utf8');
    ok(!lg.includes(TOKEN) && !file.includes(TOKEN) && lg.includes('token=••••'), 'khoá bị che trong nhật ký (API và file)');
    ok(!/fake=1/.test(lg), 'không truyền ZOOM_FAKE sang worker');

    const pid = st.pid; process.kill(pid, 'SIGKILL'); await sleep(800); st = (await req('/api/zoom/status')).j;
    ok(!st.running && st.lastExit && !st.lastExit.planned, 'worker chết bất ngờ được ghi nhận');
    await sleep(5600); st = (await req('/api/zoom/status')).j; ok(st.running && st.pid !== pid, 'tự bật lại sau khi chết bất ngờ');
    ok((await req('/api/zoom/stop', {})).s === 200 && !(await req('/api/zoom/status')).j.running, 'tắt worker');
    await sleep(6000); ok(!(await req('/api/zoom/status')).j.running, 'tắt chủ động thì không tự bật lại');

    // ---- tự liên kết theo tài khoản Socin (kết nối của S Creator) ----
    await req('/api/zoom/settings', { clearToken: true, socinUrl: '' });
    fs.mkdirSync(path.join(WS, 'creator'), { recursive: true }); fs.writeFileSync(path.join(WS, 'creator', 'settings.json'), JSON.stringify({ socin: { baseUrl: SU + '/', token: SPCR } }));
    st = (await req('/api/zoom/status')).j; ok(st.link && st.link.baseUrl === SU && st.effectiveSocinUrl === SU && !st.settings.hasToken, 'thấy kết nối Socin của S Creator, dùng địa chỉ đó');
    ok((await req('/api/zoom/link-test', {})).j.linkTest.ok, 'kiểm tra liên kết: Socin giao khoá');
    let c1 = claims; ok((await req('/api/zoom/start', {})).s === 200, 'bật worker không cần dán khoá');
    await sleep(1200); st = (await req('/api/zoom/status')).j;
    ok(st.health.state === 'ok' && claims > c1 && seenAuth === 'Bearer ' + TOKEN, 'worker dùng khoá tự nhận, liên lạc tốt');
    ok(!fs.readFileSync(path.join(WS, 'zoom', 'settings.json'), 'utf8').includes(TOKEN), 'khoá tự nhận không ghi xuống đĩa');
    TOKEN = 'zwk_' + 'rotated-rotated-rotated-0001'; const h0 = linkHits; await sleep(3500); st = (await req('/api/zoom/status')).j;
    ok(linkHits > h0 && st.running && st.health.state === 'ok' && seenAuth === 'Bearer ' + TOKEN, 'admin tạo khoá mới → S Hub tự lấy lại khoá và khởi động lại');
    let lg2 = (await req('/api/zoom/logs')).t; ok(!lg2.includes(TOKEN) && !lg2.includes(SPCR), 'nhật ký không lộ khoá worker và khoá S Creator');
    await req('/api/zoom/stop', {}); linkMode = 'forbidden';
    const f = await req('/api/zoom/start', {}); ok(f.s === 400 && /admin/.test(f.j.error), 'khoá S Creator không phải admin → báo rõ, không bật');
    await req('/api/zoom/settings', { token: TOKEN }); ok((await req('/api/zoom/start', {})).s === 200, 'không liên kết được thì dùng khoá đã dán');
    await req('/api/zoom/stop', {}); linkMode = 'ok';

    await req('/api/zoom/start', {}); await sleep(500); const wp = (await req('/api/zoom/status')).j.pid;
    srv.kill('SIGTERM'); await sleep(800); let alive = true; try { if (fs.existsSync('/proc/self')) alive = !/^\d+ \(.*\) Z/.test(fs.readFileSync(`/proc/${wp}/stat`, 'utf8')); else process.kill(wp, 0); } catch { alive = false; } // Linux: tiến trình zombie coi như đã tắt
    ok(!alive, 'tắt S Hub thì worker cũng tắt');
    const bad = await new Promise((res) => { const rq = http.request({ host: '127.0.0.1', port: P, path: '/api/zoom/start', method: 'POST', headers: { Origin: 'http://evil.com' } }, (r) => res(r.statusCode)); rq.on('error', () => res('down')); rq.end('{}'); });
    ok(bad === 'down' || bad === 403, 'chặn trang web lạ');
  } catch (e) { fail++; console.log('FAIL exception', e); }
  finally { try { srv.kill('SIGKILL'); } catch {} socin.close(); fs.rmSync(T, { recursive: true, force: true }); console.log(`\n${pass} đạt, ${fail} lỗi`); process.exit(fail ? 1 : 0); }
});
