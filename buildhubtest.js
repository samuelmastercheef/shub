// Test S Build Hub: S Hub tự tìm chỗ cài, tự khởi động khi bấm, và nhớ thư mục chọn từ giao diện.
const { spawn } = require('child_process'); const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL', m)); if (c) console.log('ok  ', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'bht-')); const P = 4793, BP = 4794;
const req = (p, o) => new Promise((res) => { const rq = http.request({ host: '127.0.0.1', port: P, path: p, method: o ? 'POST' : 'GET', headers: o ? { Origin: 'http://127.0.0.1:' + P } : {} }, (r) => { let d = ''; r.on('data', (x) => (d += x)); r.on('end', () => res({ s: r.statusCode, j: (() => { try { return JSON.parse(d || '{}'); } catch { return {}; } })() })); }); rq.end(o ? JSON.stringify(o) : undefined); });
const build = async () => (await req('/api/apps')).j.apps.find((a) => a.id === 'build');
(async () => {
  fs.writeFileSync(path.join(T, 'c.json'), JSON.stringify({ port: P, workspace: path.join(T, 'ws') }));
  const srv = spawn('node', ['server.js'], { cwd: __dirname, env: { ...process.env, HOME: T, SHUB_CONFIG: path.join(T, 'c.json'), SHUB_NO_TIMER: '1', SHUB_NO_SGAME_BOOT: '1', SHUB_OPEN_BIN: 'true', GITHUB_TOKEN: '' }, stdio: 'ignore' });
  await sleep(1000);
  try {
    let b = await build();
    ok(b && !b.canStart && !b.online, 'chưa cài S Build Hub: không khởi động được');
    ok((await req('/api/buildhub')).j.found === null, 'API báo chưa tìm thấy');
    ok((await req('/api/buildhub', { dir: path.join(T, 'khong-co') })).s === 400, 'từ chối thư mục không có S Build Hub');
    // Cài giả ở chỗ hay đặt: ~/SPrimeBuilds/build-hub
    const D = path.join(T, 'SPrimeBuilds', 'build-hub'); fs.mkdirSync(D, { recursive: true });
    fs.writeFileSync(path.join(D, 'server.js'), `require('fs').writeFileSync(${JSON.stringify(path.join(T, 'bh.pid'))}, String(process.pid));require('http').createServer((q,r)=>r.end('<title>S Build Hub</title>')).listen(${BP},'127.0.0.1');`);
    b = await build();
    ok(b.canStart, 'tự tìm thấy ~/SPrimeBuilds/build-hub, sẵn sàng khởi động');
    ok((await req('/api/launch', { id: 'build' })).j.ok, 'bấm build: S Hub chạy lệnh khởi động');
    let up = false; for (let i = 0; i < 20 && !up; i++) { await sleep(500); up = await new Promise((r) => http.get(`http://127.0.0.1:${BP}/`, (x) => r(x.statusCode === 200)).on('error', () => r(false))); }
    ok(up, 'S Build Hub đã lên');
    if (require('child_process').spawnSync('sh', ['-c', 'command -v lsof']).status === 0) { await sleep(8500); b = await build(); ok(b.online && b.url === `http://127.0.0.1:${BP}/`, 'S Hub nhận ra S Build Hub đang chạy để nhúng vào'); }
    ok(fs.readFileSync(path.join(T, 'ws', 'buildhub.log'), 'utf8').includes('khởi động'), 'ghi nhật ký khởi động');
    // Chọn file .app từ giao diện thì ưu tiên chỗ đã chọn
    const A = path.join(T, 'Khac', 'S Build Hub.app'); fs.mkdirSync(A, { recursive: true });
    const r = (await req('/api/buildhub', { dir: A })).j;
    ok(r.ok && r.found.dir === A && r.found.cmd.includes('.app'), 'lưu file .app đã chọn, lần sau dùng chỗ này');
    ok((await req('/api/buildhub')).j.saved === A, 'nhớ thư mục đã lưu');
    ok((await req('/api/buildhub', { dir: '' })).j.found.dir === D, 'xoá chỗ đã lưu thì quay về tự tìm');
  } finally {
    srv.kill(); try { process.kill(Number(fs.readFileSync(path.join(T, 'bh.pid'), 'utf8'))); } catch {}
    fs.rmSync(T, { recursive: true, force: true });
    console.log(`\n${pass} đạt, ${fail} lỗi`); process.exit(fail ? 1 : 0);
  }
})();
