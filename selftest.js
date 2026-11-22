// Tự kiểm tra: tạo repo mẫu cục bộ rồi chạy Test Hub qua API.
const { execSync, spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'th-'));
const repo = path.join(tmp, 'demo');
fs.mkdirSync(repo);
fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0', scripts: { build: 'node -e "console.log(1)"', test: 'node -e "process.exit(0)"', start: 'node app.js' } }));
fs.writeFileSync(path.join(repo, 'app.js'), `require('http').createServer((q,s)=>{s.setHeader('content-type','text/html');s.end('<title>Demo</title><h1>ok</h1>')}).listen(0,()=>console.log('http://localhost:'+this.address))`.replace('this.address', 'process.__p'));
fs.writeFileSync(path.join(repo, 'app.js'), `const s=require('http').createServer((q,r)=>{r.setHeader('content-type','text/html');r.end('<title>Demo</title><h1>ok</h1>')});s.listen(0,()=>console.log('Local: http://localhost:'+s.address().port));`);
fs.writeFileSync(path.join(repo, 'leak.js'), 'const k = "AKIAABCDEFGHIJKLMNOP";\n');
execSync('git init -q && git add -A && git -c user.email=a@b -c user.name=t commit -qm init', { cwd: repo });
const ws = path.join(tmp, 'ws');
fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify({ port: 4799, workspace: ws }));
const srv = spawn('node', ['server.js'], { cwd: __dirname, stdio: 'inherit' });
(async () => {
  await new Promise((r) => setTimeout(r, 800));
  const { id } = await (await fetch('http://127.0.0.1:4799/api/run', { method: 'POST', body: JSON.stringify({ name: 'demo', url: repo }) })).json();
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const rp = path.join(ws, 'reports', id, 'report.json');
    if (fs.existsSync(rp)) {
      const j = JSON.parse(fs.readFileSync(rp, 'utf8'));
      console.table(j.results.map((x) => ({ name: x.name, status: x.status, note: (x.note || '').slice(0, 60) })));
      const want = { 'Tải mã nguồn': 'pass', Build: 'pass', 'Unit/API test': 'pass', 'Quét khóa bí mật': 'fail', 'Test giao diện': 'pass' };
      const bad = Object.entries(want).filter(([k, v]) => (j.results.find((x) => x.name === k) || {}).status !== v);
      console.log(bad.length ? 'SELFTEST FAIL: ' + JSON.stringify(bad) : 'SELFTEST OK');
      srv.kill(); fs.unlinkSync(path.join(__dirname, 'config.json')); process.exit(bad.length ? 1 : 0);
    }
  }
  console.log('SELFTEST TIMEOUT'); srv.kill(); process.exit(1);
})();
