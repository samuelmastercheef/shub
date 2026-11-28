// Test Socin Code: lõi (diff, quyền, lệnh an toàn, ngữ cảnh) và API /api/code/* trên server thật với repo git mẫu.
// Không cần mạng, không cần model.
const { spawn, execSync } = require('child_process'); const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
const K = require('./public/codecore.js');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'scode-')); const WS = path.join(T, 'ws'); const REPO = path.join(T, 'demo');
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL', m)); if (c) console.log('ok  ', m); };
const P = 4794;
const req = (p, o, headers = {}) => new Promise((res) => { const rq = http.request({ host: '127.0.0.1', port: P, path: p, method: o !== undefined ? 'POST' : 'GET', headers: { ...(o !== undefined ? { Origin: 'http://127.0.0.1:' + P, 'content-type': 'application/json' } : {}), ...headers } }, (r) => { let d = ''; r.on('data', (x) => (d += x)); r.on('end', () => res({ s: r.statusCode, j: (() => { try { return JSON.parse(d || '{}'); } catch { return {}; } })() })); }); rq.end(o !== undefined ? JSON.stringify(o) : undefined); });

(async () => {
  // ---- lõi ----
  const u = K.unified('a.js', 'a\nb\nc\nd\n', 'a\nB\nc\nd\ne\n');
  ok(u.added === 2 && u.removed === 1 && /@@ -1,4 \+1,5 @@/.test(u.text) && /\n-b\n\+B\n/.test(u.text), 'diff: khúc thay đổi đúng số dòng');
  ok(K.unified('n.js', null, 'x\ny\n').text.startsWith('--- /dev/null'), 'diff: file mới');
  const big = Array.from({ length: 3000 }, (_, i) => 'line ' + i).join('\n');
  const t0 = Date.now(); const ub = K.unified('big.txt', big, big.replace('line 1500', 'LINE 1500')); ok(ub.added === 1 && ub.removed === 1 && Date.now() - t0 < 500, 'diff: file 3000 dòng sửa 1 dòng nhanh');
  ok(K.isSafeCommand('git status') && K.isSafeCommand('ls -la src') && !K.isSafeCommand('npm test') && !K.isSafeCommand('cat a; rm -rf /') && !K.isSafeCommand('cat /etc/passwd') && !K.isSafeCommand('cat .env') && !K.isSafeCommand('find . -delete'), 'lệnh an toàn: chỉ lệnh đọc trong thư mục');
  ok(!K.needsAsk('ask', 'read') && K.needsAsk('ask', 'edit') && !K.needsAsk('edit', 'edit') && K.needsAsk('edit', 'run', { command: 'npm test' }) && !K.needsAsk('ask', 'run', { command: 'git diff' }), 'quyền: hỏi trước / tự sửa file / lệnh an toàn');
  ok(!K.allowed('plan', 'edit') && !K.allowed('plan', 'run') && K.allowed('plan', 'read'), 'chế độ Kế hoạch chỉ đọc');
  ok(K.isSecretPath('.env') && K.isSecretPath('config/prod.pem') && !K.isSecretPath('.env.example') && !K.isSecretPath('src/env.js'), 'nhận file bí mật');
  ok(K.localPlan('!npm test', { toolNames: ['run_command'] }).calls[0].input.command === 'npm test', 'không model: !lệnh → run_command');
  ok(K.localPlan('/read_file src/a.js', { toolNames: ['read_file'], parseArgs: require('./public/aicore.js').parseArgs }).calls[0].input.path === 'src/a.js', 'không model: /read_file tham số đầu');
  const ctx = K.contextText({ workspace: { name: 'demo', path: '/x/demo' }, git: { branch: 'main', status: ' M a.js' }, tree: ['src/', 'package.json'], memory: { file: 'SOCIN.md', text: 'Lệnh test: npm test' } });
  ok(/nhánh main/.test(ctx) && /SOCIN\.md/.test(ctx) && K.socinContext(ctx).length <= 6000 && K.socinContext('x'.repeat(9000)).length === 6000, 'ngữ cảnh gọn, vừa giới hạn AI Socin');
  ok(K.cleanTodos([{ content: 'a', status: 'in_progress' }, { content: '', status: 'todo' }, { content: 'b', status: 'completed' }]).map((t) => t.status).join() === 'doing,done', 'kế hoạch: nhận cả status kiểu Claude');

  // ---- server ----
  fs.mkdirSync(path.join(REPO, 'src'), { recursive: true });
  fs.writeFileSync(path.join(REPO, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'node test.js' } }));
  fs.writeFileSync(path.join(REPO, 'src', 'math.js'), 'function add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n');
  fs.writeFileSync(path.join(REPO, 'test.js'), "const { add } = require('./src/math');\nif (add(2, 3) !== 5) { console.error('add sai'); process.exit(1); }\nconsole.log('ok');\n");
  fs.writeFileSync(path.join(REPO, '.env'), 'SECRET=abc\n');
  fs.writeFileSync(path.join(REPO, 'SOCIN.md'), '# demo\nTest: npm test\n');
  execSync('git init -q -b main && git add -A && git -c user.email=a@b -c user.name=t commit -qm init', { cwd: REPO });
  fs.symlinkSync('/etc', path.join(REPO, 'ra-ngoai'));
  fs.writeFileSync(path.join(T, 'config.json'), JSON.stringify({ port: P, workspace: WS }));
  const srv = spawn('node', ['server.js'], { cwd: __dirname, env: { ...process.env, SHUB_CONFIG: path.join(T, 'config.json') }, stdio: ['ignore', 'ignore', 'inherit'] });
  try {
    for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 150)); const r = await req('/api/code/tools').catch(() => null); if (r && r.s === 200) break; }
    const tools = (await req('/api/code/tools')).j.tools || [];
    ok(['read_file', 'edit_file', 'write_file', 'run_command', 'search', 'git_diff', 'git_commit', 'todo_write'].every((n) => tools.some((t) => t.name === n)), 'sổ lệnh Socin Code đủ đọc/sửa/chạy/git/kế hoạch');
    ok((await req('/api/code/workspaces', { path: os.homedir() })).s === 400, 'không cho chọn cả thư mục nhà');
    const w = (await req('/api/code/workspaces', { path: REPO })).j.workspace; ok(w && w.name === 'demo', 'thêm thư mục dự án');
    const call = (name, input, o = {}) => req('/api/code/call', { name, input, ws: w.id, session: 'sess1', mode: 'ask', ...o }).then((r) => r.j);
    const ctxr = (await req('/api/code/context?ws=' + w.id)).j; ok(ctxr.git && ctxr.git.branch === 'main' && ctxr.memory.file === 'SOCIN.md' && ctxr.tree.includes('src/'), 'ngữ cảnh: nhánh git, SOCIN.md, cây thư mục');
    const rd = await call('read_file', { path: 'src/math.js' }); ok(/2→  return a - b;/.test(rd.text), 'read_file có số dòng');
    ok((await call('read_file', { path: '.env' })).isError, 'read_file từ chối .env');
    ok((await call('read_file', { path: '../../etc/passwd' })).isError && (await call('read_file', { path: '/etc/hosts' })).isError, 'chặn đường dẫn ra ngoài thư mục');
    ok((await call('read_file', { path: 'ra-ngoai/hosts' })).isError, 'chặn symlink trỏ ra ngoài');
    const ls = await call('list_files', { pattern: '**/*.js' }); ok(/src\/math\.js/.test(ls.text) && /test\.js/.test(ls.text) && !/package\.json/.test(ls.text), 'list_files lọc glob');
    const sr = await call('search', { pattern: 'a - b' }); ok(/src\/math\.js:2:/.test(sr.text), 'search tìm ra file:dòng');
    ok(!/SECRET/.test((await call('search', { pattern: 'SECRET' })).text), 'search bỏ qua .env');
    const t1 = await call('run_command', { command: 'npm test' }); ok(t1.isError && /cần người dùng đồng ý/.test(t1.text), 'run_command chưa đồng ý → bị chặn ở server');
    const t2 = await call('run_command', { command: 'git status' }); ok(!t2.isError && /mã thoát 0/.test(t2.text), 'lệnh chỉ đọc tự chạy');
    ok((await call('edit_file', { path: 'src/math.js', old_string: 'a - b', new_string: 'a + b' })).isError, 'edit_file ở "Hỏi trước" cần đồng ý');
    ok((await call('edit_file', { path: 'src/math.js', old_string: 'a - b', new_string: 'a + b' }, { mode: 'plan', confirmed: true })).isError, 'chế độ Kế hoạch chặn sửa kể cả khi đồng ý');
    const pv = (await req('/api/code/preview', { name: 'edit_file', input: { path: 'src/math.js', old_string: 'a - b', new_string: 'a + b' }, ws: w.id })).j;
    ok(pv.ok && pv.kind === 'diff' && pv.added === 1 && pv.removed === 1 && fs.readFileSync(path.join(REPO, 'src/math.js'), 'utf8').includes('a - b'), 'xem trước diff không ghi file');
    ok(!(await req('/api/code/preview', { name: 'edit_file', input: { path: 'src/math.js', old_string: 'khong co', new_string: 'x' }, ws: w.id })).j.ok, 'xem trước báo old_string không khớp');
    const ed = await call('edit_file', { path: 'src/math.js', old_string: 'a - b', new_string: 'a + b' }, { confirmed: true });
    ok(!ed.isError && ed.meta.kind === 'diff' && ed.meta.snap && fs.readFileSync(path.join(REPO, 'src/math.js'), 'utf8').includes('a + b'), 'edit_file sửa file, trả diff và bản lưu');
    const nx = await call('edit_file', { path: 'src/math.js', old_string: 'khong co', new_string: 'y' }, { mode: 'edit' });
    ok(nx.isError, 'old_string không có → lỗi rõ ràng');
    const wr = await call('write_file', { path: 'src/util.js', content: 'module.exports = 1;\n' }, { mode: 'edit' });
    ok(!wr.isError && wr.meta.isNew && fs.existsSync(path.join(REPO, 'src/util.js')), 'chế độ Tự sửa file: write_file tạo file không cần hỏi');
    ok((await call('write_file', { path: '.git/config', content: 'x' }, { mode: 'edit' })).isError, 'không ghi vào .git');
    const t3 = await call('run_command', { command: 'npm test' }, { confirmed: true }); ok(!t3.isError && /ok/.test(t3.text) && t3.meta.code === 0, 'run_command chạy test sau khi đồng ý');
    const ch = (await req('/api/code/changes?ws=' + w.id)).j; ok(ch.repo && ch.files.some((f) => f.file === 'src/math.js') && /\+  return a \+ b;/.test(ch.diff), 'bảng Thay đổi: file đổi và diff');
    const un = (await req('/api/code/undo', { session: 'sess1', snap: ed.meta.snap })).j;
    ok(un.ok && un.files.includes('src/util.js') && un.files.includes('src/math.js') && !fs.existsSync(path.join(REPO, 'src/util.js')) && fs.readFileSync(path.join(REPO, 'src/math.js'), 'utf8').includes('a - b'), 'hoàn tác về trước lần sửa (xoá file mới tạo)');
    await call('edit_file', { path: 'src/math.js', old_string: 'a - b', new_string: 'a + b' }, { confirmed: true });
    const gc = await call('git_commit', { message: 'Sửa phép cộng' }, { confirmed: true }); ok(!gc.isError && /Sửa phép cộng/.test(execSync('git log -1 --pretty=%s', { cwd: REPO }).toString()), 'git_commit sau khi đồng ý');
    const slow = call('run_command', { command: 'sleep 20' }, { confirmed: true });
    await new Promise((r) => setTimeout(r, 400)); await req('/api/code/kill', { session: 'sess1' });
    const sl = await slow; ok(sl.isError && /người dùng bấm Dừng/.test(sl.text), 'Dừng lệnh đang chạy');
    const td = await call('todo_write', { todos: [{ content: 'Đọc mã', status: 'done' }, { content: 'Sửa lỗi', status: 'doing' }] }); ok(td.meta.todos.length === 2, 'todo_write');
    const sv = await req('/api/code/sessions', { sessions: [{ id: 'k1', title: 'Phiên', workspaceId: w.id, todos: [{ content: 'x', status: 'todo' }], reverted: ['s1'], messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }] });
    const ss = (await req('/api/code/sessions')).j.sessions; ok(sv.s === 200 && ss[0].todos.length === 1 && ss[0].reverted[0] === 's1' && ss[0].workspaceId === w.id, 'lưu phiên kèm kế hoạch');
    ok((await req('/api/code/call', { name: 'git_status', input: {}, ws: w.id }, { Origin: 'https://evil.example' })).s === 403, 'chặn trang web lạ gọi API');
    ok((await new Promise((res) => { const rq = http.request({ host: '127.0.0.1', port: P, path: '/api/code/call', method: 'POST', headers: { 'content-type': 'text/plain' } }, (r) => res(r.statusCode)); rq.end('{}'); })) === 415, 'POST không phải JSON bị từ chối');
    const bw = (await req('/api/code/browse?path=' + encodeURIComponent(T))).j; ok(bw.dirs.includes('demo'), 'duyệt thư mục để chọn');
    const page = await new Promise((res) => http.get(`http://127.0.0.1:${P}/code.html`, (r) => { let d = ''; r.on('data', (x) => (d += x)); r.on('end', () => res(d)); }));
    ok(/codecore\.js/.test(page) && /Socin Code/.test(page), 'trang /code.html');
  } finally { srv.kill(); }
  console.log(`\n${pass} đạt, ${fail} lỗi`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
