// Tự kiểm tra S VPS: dùng shim ssh chạy bash cục bộ (HOME giả) làm "VPS".
const { execSync, spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-'));
const fakeHome = path.join(tmp, 'home'); fs.mkdirSync(fakeHome);
const bin = path.join(tmp, 'bin'); fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, 'ssh'), `#!/bin/bash\nexport HOME=${fakeHome}\nlast="\${@: -1}"\nif [ "$last" = "bash -s" ]; then exec bash -s; else exec bash -c "$last"; fi\n`, { mode: 0o755 });
fs.writeFileSync(path.join(bin, 'crontab'), `#!/bin/bash\nF=${tmp}/cron.txt\nif [ "$1" = "-l" ]; then cat $F 2>/dev/null; else cat > $F; fi\n`, { mode: 0o755 });
fs.writeFileSync(path.join(bin, 'flock'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/bash
case "$1" in
 info) exit 0;; version) exit 0;;
 ps) echo '{"ID":"abc123","Names":"web","Image":"nginx","Status":"Up 2 hours","State":"running","Ports":"80/tcp","Labels":"com.docker.compose.project=shop"}'; echo '{"ID":"def456","Names":"old","Image":"redis","Status":"Exited (0)","State":"exited","Ports":"","Labels":""}';;
 stats) echo '{"Name":"web","CPUPerc":"0.1%","MemUsage":"10MiB / 1GiB"}';;
 images) echo '{"Repository":"nginx","Tag":"latest","ID":"i1","Size":"140MB","CreatedSince":"2 weeks ago"}';;
 volume) echo '{"Name":"pgdata","Driver":"local"}';;
 system) echo '{"Type":"Images","TotalCount":"3","Size":"500MB","Reclaimable":"200MB (40%)"}';;
 restart|start|stop) echo "$2";;
 logs) echo "log line for $4";;
 *) echo "docker $*";;
esac
`, { mode: 0o755 });
// repo "GitHub" cục bộ
const origin = path.join(tmp, 'origin.git'), work = path.join(tmp, 'work');
execSync(`git init -q --bare -b main ${origin} && git clone -q ${origin} ${work}`);
const git = (c) => execSync(`cd ${work} && git -c user.email=a@b -c user.name=t ${c}`, { stdio: 'pipe' }).toString();
fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'x', scripts: { build: 'echo building > built.txt' } }));
git('add -A'); git('commit -qm v1'); git('push -q origin HEAD:main');
const ws = path.join(tmp, 'ws'); fs.mkdirSync(ws);
fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify({ port: 4798, workspace: ws }));
const srv = spawn('node', ['server.js'], { cwd: __dirname, env: { ...process.env, SHUB_NO_TIMER: '1', PATH: bin + ':' + process.env.PATH, SHUB_SSH_BIN: path.join(bin, 'ssh') }, stdio: 'inherit' });
const P = (p, b) => fetch('http://127.0.0.1:4798/api/vps/' + p, { method: 'POST', body: JSON.stringify(b) }).then((r) => r.json());
const runJob = async (route, b) => { const { id, error } = await P(route, b); if (error) throw new Error(error); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 500)); const t = await (await fetch('http://127.0.0.1:4798/api/vps/stream?id=' + id)).text(); if (t.includes('"t":"done"')) return t.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5))).map((e) => e.s || '#' + e.code).join(''); } throw new Error('timeout'); };
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  await new Promise((r) => setTimeout(r, 800));
  console.log('guard:', (await fetch('http://127.0.0.1:4798/api/vps/servers', { headers: { Host: 'evil.com' } })).status);
  await P('servers', { name: 'Test', host: 'localhost', user: 'root', keyPath: '' });
  const bad = await P('projects', { server: 'test', name: 'a;rm -rf', repo: origin });
  ok(!!bad.error, 'từ chối tên dự án nguy hiểm');
  const pr = await P('projects', { server: 'test', name: 'app1', repo: origin.replace(/^\//, 'https://x.local/'), branch: 'main', pm: 'none' });
  ok(!!pr.error === false, 'repo https hợp lệ được chấp nhận'); await P('projects/delete', { server: 'test', id: 'app1' });
  // repo cục bộ: validator yêu cầu git@/https; dùng file:// qua https? -> ghi trực tiếp vào vps.json
  const f = path.join(ws, 'vps.json'); const d = JSON.parse(fs.readFileSync(f));
  d.servers[0].projects = [{ id: 'app1', name: 'app1', repo: origin, branch: 'main', dir: '~/apps/app1', pm: 'none', installCmd: '', buildCmd: '', startCmd: '', auto: true, intervalMin: 5 }];
  fs.writeFileSync(f, JSON.stringify(d));
  let o = await runJob('deploy', { server: 'test', project: 'app1', force: true });
  ok(/Clone/.test(o) && /✅ Xong/.test(o) && fs.existsSync(path.join(fakeHome, 'apps/app1/built.txt')), 'deploy lần đầu: clone + build');
  o = await runJob('deploy', { server: 'test', project: 'app1' });
  ok(/Không có thay đổi/.test(o), 'không đổi thì bỏ qua');
  fs.writeFileSync(path.join(work, 'v2.txt'), '2'); git('add -A'); git('commit -qm v2'); git('push -q origin HEAD:main');
  o = await runJob('deploy', { server: 'test', project: 'app1' });
  ok(/v2/.test(o) && /✅/.test(o), 'cập nhật lên v2');
  o = await runJob('rollback', { server: 'test', project: 'app1' });
  ok(/Quay về/.test(o) && !fs.existsSync(path.join(fakeHome, 'apps/app1/v2.txt')), 'rollback về v1');
  // build lỗi -> tự về bản cũ
  fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'x', scripts: { build: 'exit 1' } })); git('add -A'); git('commit -qm broken'); git('push -q origin HEAD:main');
  o = await runJob('deploy', { server: 'test', project: 'app1' });
  ok(/❌/.test(o) && /bản cũ/.test(o), 'build lỗi -> tự về bản cũ');
  o = await runJob('cleanup', { server: 'test', dry: true });
  ok(/XEM TRƯỚC/.test(o) && /Hết xem trước/.test(o), 'dọn rác xem trước');
  o = await runJob('cleanup', { server: 'test', dry: false });
  ok(/Xong:/.test(o), 'dọn rác thật chạy xong');
  // agent: cần crontab
  o = await runJob('agent', { server: 'test', project: 'app1', auto: true, cleanupEnabled: true });
  ok(/shub-deploy-app1/.test(o) && /shub-cleanup/.test(o), 'cài cron tự cập nhật + dọn rác');
  const ct = fs.readFileSync(path.join(tmp, 'cron.txt'), 'utf8'); console.log(ct);
  const ag = execSync(`HOME=${fakeHome} bash ${fakeHome}/.shub/deploy-app1.sh`, { stdio: 'pipe' }).toString();
  ok(/đã build lỗi trước đó/.test(ag), 'agent không lặp lại bản build lỗi');
  const cl = execSync(`HOME=${fakeHome} bash ${fakeHome}/.shub/cleanup.sh 99`, { stdio: 'pipe' }).toString();
  ok(true, 'cleanup agent với ngưỡng 99% thoát êm: [' + cl.trim().slice(0, 40) + ']');
  o = await runJob('agent', { server: 'test', project: 'app1', auto: false, cleanupEnabled: false });
  ok(!/shub-deploy-app1/.test(fs.readFileSync(path.join(tmp, 'cron.txt'), 'utf8')), 'tắt tự động gỡ cron');
  // ---- Backup ----
  const srcDir = path.join(tmp, 'site'); fs.mkdirSync(path.join(srcDir, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'index.html'), 'v1'); fs.writeFileSync(path.join(srcDir, 'node_modules/big.js'), 'x');
  let r = await P('backup/config', { server: 'test', config: { paths: [srcDir, path.join(tmp, 'khong-ton-tai')], keepDaily: 2, keepWeekly: 0, keepMonthly: 0, mirror: true, mirrorKeep: 5 } });
  ok(r.ok, 'lưu cấu hình backup');
  r = await P('backup/config', { server: 'test', config: { paths: ['/'] } }); ok(!!r.error, 'từ chối backup thư mục gốc /');
  r = await P('backup/config', { server: 'test', config: { paths: ['/tmp/a;b'] } }); ok(!!r.error, 'từ chối đường dẫn có ký tự lạ');
  o = await runJob('backup/run', { server: 'test' });
  ok(/Backup xong/.test(o) && /bỏ qua \(không tồn tại\)/.test(o), 'tạo backup, bỏ qua đường dẫn không tồn tại');
  let L = await P('backup/list', { server: 'test' });
  ok(L.ok && L.list.length === 1 && L.list[0].label === 'manual', 'liệt kê 1 phiên bản');
  const nm = L.list[0].name;
  o = await runJob('backup/act', { server: 'test', name: nm, act: 'contents' });
  ok(/index\.html/.test(o) && !/node_modules/.test(o) && /MANIFEST/.test(o), 'nội dung: có mã nguồn, loại trừ node_modules');
  o = await runJob('backup/act', { server: 'test', name: nm, act: 'verify' }); ok(/toàn vẹn/.test(o), 'kiểm tra toàn vẹn');
  fs.writeFileSync(path.join(srcDir, 'index.html'), 'v2-BROKEN');
  await new Promise((r) => setTimeout(r, 1100));
  o = await runJob('backup/act', { server: 'test', name: nm, act: 'restore', mode: 'tmp' });
  ok(/Đã giải nén/.test(o), 'khôi phục vào thư mục tạm');
  o = await runJob('backup/act', { server: 'test', name: nm, act: 'restore', mode: 'inplace' });
  ok(/Đã khôi phục/.test(o) && fs.readFileSync(path.join(srcDir, 'index.html'), 'utf8') === 'v1', 'khôi phục đè: file về v1');
  L = await P('backup/list', { server: 'test' });
  ok(L.list.some((x) => x.label === 'pre-restore' && x.pinned), 'tự tạo bản an toàn pre-restore và ghim');
  ok(!fs.existsSync(path.join(process.env.HOME, '__shub__')) && !fs.existsSync('/__shub__'), 'không rác __shub__ ra thư mục gốc');
  for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 1100)); await runJob('backup/run', { server: 'test' }); }
  L = await P('backup/list', { server: 'test' });
  const nonPinned = L.list.filter((x) => !x.pinned).length;
  ok(nonPinned === 2 && L.list.some((x) => x.pinned), 'giữ 2 bản mới nhất + bản ghim, xóa bản cũ (có ' + L.list.length + ' bản)');
  o = await runJob('backup/download', { server: 'test', name: L.list[0].name });
  ok(/toàn vẹn/.test(o) && fs.existsSync(path.join(ws, 'downloads', 'backup', 'test', L.list[0].name)), 'tải về Mac + kiểm tra checksum');
  o = await runJob('backup/act', { server: 'test', name: L.list[0].name, act: 'delete' }); ok(/Đã xóa/.test(o), 'xóa một phiên bản');
  r = await P('backup/act', { server: 'test', name: '../../etc/passwd', act: 'delete' }); ok(!!r.error, 'từ chối tên file backup nguy hiểm');
  o = await runJob('agent', { server: 'test', backupEnabled: true, backupHour: 2 });
  ok(/shub-backup/.test(o), 'cài cron backup');
  // ---- Dán private key ----
  const pem = '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAAfake\n-----END OPENSSH PRIVATE KEY-----';
  r = await P('servers', { name: 'KeyTest', host: 'example.com', user: 'root', keyPem: pem });
  const kp = path.join(ws, 'keys', 'keytest');
  ok(r.ok && fs.existsSync(kp) && (fs.statSync(kp).mode & 0o777) === 0o600, 'dán private key: lưu file quyền 600');
  const sv = await (await fetch('http://127.0.0.1:4798/api/vps/servers')).text();
  ok(sv.includes('keys/keytest') && !sv.includes('AAAAfake'), 'API không trả nội dung key');
  r = await P('servers', { name: 'BadKey', host: 'example.com', keyPem: 'khong phai key' }); ok(!!r.error, 'từ chối nội dung key sai');
  // ---- Docker ----
  const dk = await P('docker/list', { server: 'test' });
  ok(dk.ok && dk.containers.length === 2 && dk.images.length === 1 && dk.volumes.length === 1, 'docker: liệt kê container/image/volume');
  o = await runJob('docker/act', { server: 'test', act: 'restart', id: 'web' }); ok(/restart web/.test(o), 'docker: restart container');
  r = await P('docker/act', { server: 'test', act: 'restart', id: 'web; rm -rf /' }); ok(!!r.error, 'docker: từ chối id nguy hiểm');
  r = await P('docker/act', { server: 'test', act: 'bash', id: 'web' }); ok(!!r.error, 'docker: từ chối thao tác lạ');
  o = await runJob('docker/act', { server: 'test', act: 'prune-preview' }); ok(/Image không gắn thẻ/.test(o), 'docker: xem trước dọn');
  // ---- Hệ thống ----
  r = await P('sys/act', { server: 'test', act: 'disk', dir: '/etc' }); ok(!!r.error, 'sys: từ chối thư mục ngoài danh sách');
  o = await runJob('sys/act', { server: 'test', act: 'disk', dir: '/tmp' }); ok(/Dung lượng/.test(o), 'sys: phân tích dung lượng');
  const sl = await P('sys/list', { server: 'test' }); ok(sl.ok, 'sys: liệt kê tiến trình/cổng');
  console.log(fails ? 'VPSTEST FAIL' : 'VPSTEST OK'); srv.kill(); fs.unlinkSync(path.join(__dirname, 'config.json')); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('ERR', e); srv.kill(); try { fs.unlinkSync(path.join(__dirname, 'config.json')); } catch {} process.exit(1); });
