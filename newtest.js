// Test cho S GitHub (API giả), Kho file và S Claude (HOME giả).
const { spawn } = require('child_process'); const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'shubn-')); const HOME = path.join(T, 'home'); const WS = path.join(T, 'ws'); fs.mkdirSync(HOME, { recursive: true });
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL', m)); if (c) console.log('ok  ', m); };
// GitHub giả
const repos = [{ name: 'a', full_name: 'me/a', owner: { login: 'me' }, private: true, language: 'Go', stargazers_count: 2, size: 10, pushed_at: '2026-11-01T00:00:00Z', created_at: '2024-01-01T00:00:00Z', html_url: 'u', default_branch: 'main' }];
const fake = http.createServer((q, r) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => { const j = (c, o) => { r.writeHead(c, { 'Content-Type': 'application/json', 'x-oauth-scopes': 'repo' }); r.end(JSON.stringify(o)); };
  if (q.url === '/user') return j(200, { login: 'me' }); if (q.url.startsWith('/user/orgs')) return j(200, [{ login: 'org1' }]);
  if (q.url.startsWith('/user/repos') && q.method === 'GET') return j(200, repos);
  if (q.url === '/user/repos' && q.method === 'POST') { const p = JSON.parse(b); const x = { ...repos[0], name: p.name, full_name: 'me/' + p.name, private: p.private }; repos.push(x); return j(201, x); }
  if (q.method === 'PATCH') { const p = JSON.parse(b); Object.assign(repos[0], p.private !== undefined ? { private: p.private } : {}); return j(200, repos[0]); }
  if (q.url.includes('/zipball')) { r.writeHead(200); return r.end('PK-fake'); }
  j(404, { message: 'nf' }); }); });
const get = (p, port) => new Promise((res) => http.get({ host: '127.0.0.1', port, path: p }, (r) => { let d = ''; r.on('data', (x) => (d += x)); r.on('end', () => res({ s: r.statusCode, t: d })); }));
const post = (p, o, port) => new Promise((res) => { const rq = http.request({ host: '127.0.0.1', port, path: p, method: 'POST' }, (r) => { let d = ''; r.on('data', (x) => (d += x)); r.on('end', () => res({ s: r.statusCode, j: JSON.parse(d || '{}') })); }); rq.end(JSON.stringify(o)); });
fake.listen(0, async () => {
  const fp = fake.address().port;
  fs.writeFileSync(path.join(T, 'config.json'), '{}');
  // dữ liệu Claude giả
  const mk = (p, c = 'x'.repeat(1000), age = 0) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); if (age) { const t = (Date.now() - age * 864e5) / 1000; fs.utimesSync(p, t, t); } };
  mk(path.join(HOME, '.claude/shell-snapshots/old.sh'), 'x'.repeat(5000), 10); mk(path.join(HOME, '.claude/shell-snapshots/new.sh'), 'y'.repeat(100), 0);
  mk(path.join(HOME, '.claude/projects/-Users-me-app/s1.jsonl'), 'z'.repeat(2000), 90); mk(path.join(HOME, '.claude/projects/-Users-me-app/s2.jsonl'), 'z'.repeat(300), 1);
  mk(path.join(HOME, '.claude/CLAUDE.md'), '# Hướng dẫn');
  mk(path.join(HOME, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'p1@m': true } })); mk(path.join(HOME, '.claude/plugins/installed_plugins.json'), JSON.stringify({ plugins: { 'p1@m': [{ version: '1.0', scope: 'user' }] } }));
  mk(path.join(HOME, '.claude.json'), JSON.stringify({ mcpServers: { gh: { command: 'npx', args: ['gh'], env: { GITHUB_TOKEN: 'secret123' } } } }));
  const env = { ...process.env, SHUB_HOME: HOME, SHUB_GH_API: 'http://127.0.0.1:' + fp, GITHUB_TOKEN: 'tkn', SHUB_NO_TIMER: '1', SHUB_CLAUDE_BIN: path.join(T, 'fakeclaude') };
  fs.writeFileSync(path.join(T, 'fakeclaude'), '#!/bin/bash\nif echo "$2" | grep -q "YES hoặc NO"; then echo YES; else echo "KQ: $2" | head -c 80; fi\n', { mode: 0o755 });
  fs.writeFileSync(path.join(T, 'config.json'), JSON.stringify({ port: 4797, workspace: WS }));
  const srv = spawn('node', [path.join(__dirname, 'server.js')], { env: { ...env, SHUB_CONFIG: path.join(T, 'config.json') }, cwd: __dirname, stdio: 'ignore' });
  // server đọc config.json trong thư mục repo: ghi tạm
  await new Promise((r) => setTimeout(r, 900));
  const P = 4797;
  try {
    const me = JSON.parse((await get('/api/gh/me', P)).t); ok(me.ok && me.login === 'me' && me.orgs[0] === 'org1', 'gh me + orgs');
    const rl = JSON.parse((await get('/api/gh/repos', P)).t); ok(rl.repos.length === 1 && rl.repos[0].private, 'gh list repos');
    ok((await post('/api/gh/create', { name: 'bad name' }, P)).s === 400, 'gh tạo repo: chặn tên sai');
    ok((await post('/api/gh/create', { name: 'newone', private: true }, P)).j.repo.full === 'me/newone', 'gh tạo repo');
    ok((await post('/api/gh/update', { full: 'me/a', private: false }, P)).s === 400, 'gh public cần gõ tên xác nhận');
    ok((await post('/api/gh/update', { full: 'me/a', private: false, confirmName: 'a' }, P)).j.ok, 'gh chuyển public khi xác nhận đúng');
    ok((await post('/api/gh/delete', { full: 'me/a', confirmName: 'x' }, P)).s === 400, 'gh xóa cần xác nhận');
    const dl = await post('/api/gh/download', { full: 'me/a' }, P); ok(dl.j.ok && fs.existsSync(path.join(WS, 'downloads/ma-nguon', dl.j.file)), 'gh tải ZIP vào Kho file');
    const fl = JSON.parse((await get('/api/files?category=ma-nguon', P)).t); ok(fl.total === 1 && fl.categories.some((c) => c.key === 'ma-nguon' && c.count === 1), 'kho file thấy file ZIP trong danh mục');
    const id = fl.items[0].id; ok((await post('/api/files/category', { label: 'Tài liệu mới' }, P)).j.key === 'tai-lieu-moi', 'tạo danh mục');
    ok((await post('/api/files/move', { id, category: 'tai-lieu-moi' }, P)).j.ok, 'chuyển file sang danh mục khác');
    ok((await post('/api/files/move', { id: Buffer.from('{"c":"x","r":"../../etc/passwd"}').toString('base64url'), category: 'khac' }, P)).s === 400, 'chặn path traversal');
    const f2 = JSON.parse((await get('/api/files?category=tai-lieu-moi', P)).t); ok(f2.total === 1, 'file nằm ở danh mục mới');
    ok((await get('/files/dl/' + f2.items[0].id, P)).t === 'PK-fake', 'tải file về');
    ok((await post('/api/files/delete', { id: f2.items[0].id }, P)).j.ok, 'xóa file');
    // S Claude
    const ov = JSON.parse((await get('/api/cl/overview', P)).t); ok(ov.ok && ov.plugins === 1 && ov.mcp === 1 && ov.cacheBytes > 0, 'S Claude tổng quan');
    const mc = JSON.parse((await get('/api/cl/mcp', P)).t); ok(mc.items[0].env.GITHUB_TOKEN === '••••' && !JSON.stringify(mc).includes('secret123'), 'MCP: che token');
    const ca = JSON.parse((await get('/api/cl/cache', P)).t); ok(ca.items.find((c) => c.id === 'shell').files === 1, 'cache: chỉ tính file cũ');
    ok((await post('/api/cl/cache/clean', { ids: ['sessions'] }, P)).s === 400, 'cache: transcript cần xác nhận XOA');
    const cl = await post('/api/cl/cache/clean', { ids: ['shell', 'sessions'], confirm: 'XOA' }, P); ok(cl.j.ok && !fs.existsSync(path.join(HOME, '.claude/shell-snapshots/old.sh')) && fs.existsSync(path.join(HOME, '.claude/shell-snapshots/new.sh')), 'cache: xóa file cũ, giữ file mới');
    ok(!fs.existsSync(path.join(HOME, '.claude/projects/-Users-me-app/s1.jsonl')) && fs.existsSync(path.join(HOME, '.claude/projects/-Users-me-app/s2.jsonl')), 'cache: xóa phiên cũ, giữ phiên mới');
    ok(fs.existsSync(path.join(HOME, '.claude/CLAUDE.md')) && fs.existsSync(path.join(HOME, '.claude/settings.json')), 'cache: không đụng cấu hình');
    const flow = { name: 'Test flow', nodes: [{ id: 't', type: 'trigger', name: 'In', cfg: { text: 'xin chào' } }, { id: 'c', type: 'claude', name: 'Hỏi', cfg: { prompt: 'Tóm tắt: {{input}}' } }, { id: 'o', type: 'output', name: 'Ra', cfg: {} }], edges: [{ from: 't', to: 'c' }, { from: 'c', to: 'o' }] };
    const sv = await post('/api/cl/flow/save', { flow }, P); ok(sv.j.ok && sv.j.id === 'test-flow', 'workflow lưu');
    ok((await post('/api/cl/flow/save', { flow: { name: 'x', nodes: [{ id: 'a', type: 'evil' }] } }, P)).s === 400, 'workflow: chặn loại node lạ');
    const rn = await post('/api/cl/flow/run', { id: 'test-flow' }, P); ok(rn.j.ok && rn.j.logs.find((l) => l.id === 'o').out.includes('KQ:'), 'workflow chạy qua claude (giả)');
    fs.writeFileSync(path.join(T, 'fakeclaude'), '#!/bin/bash\nif echo "$2" | grep -q "thiết kế workflow"; then echo \'Đây: {"name":"Gợi ý","nodes":[{"id":"a","type":"trigger","name":"In","cfg":{"text":"x"}},{"id":"b","type":"output","name":"Out"}],"edges":[{"from":"a","to":"b"}]}\'; else echo "KQ: $2" | head -c 80; fi\n', { mode: 0o755 });
    const sg = await post('/api/cl/flow/suggest', { request: 'tạo flow thử nghiệm' }, P); ok(sg.j.ok && sg.j.flow.nodes.length === 2 && sg.j.flow.edges.length === 1, 'đề xuất flow từ yêu cầu (claude giả)');
    ok((await post('/api/cl/flow/suggest', { request: 'a' }, P)).s === 400, 'đề xuất flow: chặn yêu cầu quá ngắn');
    const md = JSON.parse((await get('/api/cl/flow?id=test-flow&md=1', P)).t); ok(/## 2\. Hỏi/.test(md.markdown), 'workflow xuất Markdown');
    ok((await post('/api/cl/artifact/save', { name: 'A1', url: 'javascript:alert(1)' }, P)).s === 400, 'artifact: chặn link không phải https');
    ok((await post('/api/cl/artifact/save', { name: 'A1', url: 'https://claude.ai/artifact/x', category: 'Báo cáo' }, P)).j.ok, 'artifact lưu');
    ok(JSON.parse((await get('/api/cl/projects', P)).t).items.some((x) => x.name.includes('app')), 'liệt kê dự án Claude Code');
    ok((await post('/api/cl/flow/delete', { id: 'test-flow', confirm: 'sai' }, P)).s === 400, 'workflow: xóa cần xác nhận');
    const rp = JSON.parse((await get('/api/reports?page=1&size=5', P)).t); ok(Array.isArray(rp.reports) && rp.total === 0, 'reports phân trang');
    for (const pg of ['github', 'files', 'claude', 'test']) ok((await get('/' + pg + '.html', P)).s === 200, 'trang ' + pg + '.html phục vụ được');
  } catch (e) { fail++; console.log('LỖI', e); }
  srv.kill(); fake.close(); console.log(`\n${pass} đạt, ${fail} lỗi`); process.exit(fail ? 1 : 0);
});
