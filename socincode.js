// Socin Code: lập trình kiểu Claude Code bên trong Socin Studio.
// Agent (AI Socin hoặc model trên máy, vòng lặp chạy ở trình duyệt bằng AICore.runTurn) dùng các lệnh dưới đây
// để đọc, tìm, sửa file và chạy lệnh trong MỘT thư mục dự án người dùng đã chọn.
// An toàn: mọi đường dẫn bị giữ trong thư mục dự án (realpath), không ghi vào .git, không đọc file bí mật (.env, khoá),
// sửa file/chạy lệnh cần người dùng đồng ý (trừ chế độ "Tự sửa file" và lệnh chỉ đọc), mỗi lần sửa có bản lưu để hoàn tác.
// Dữ liệu: <workspace>/socin-studio/code.json (thư mục dự án), code-sessions.json (phiên), code-snaps/ (bản lưu trước khi sửa).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const C = require('./public/codecore.js');

const IGNORE = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.cache', '__pycache__', '.venv', 'venv', 'target', '.turbo', 'coverage', '.DS_Store', 'Pods', 'DerivedData', '.gradle']);
const MAX_READ = 2 * 1024 * 1024, MAX_OUT = 30000;
const obj = (props = {}, required = []) => ({ type: 'object', properties: props, ...(required.length ? { required } : {}) });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });

module.exports = function socinCode({ WS, json, body }) {
  const DIR = path.join(WS, 'socin-studio');
  const SNAPS = path.join(DIR, 'code-snaps');
  fs.mkdirSync(SNAPS, { recursive: true });
  const F = { ws: path.join(DIR, 'code.json'), sessions: path.join(DIR, 'code-sessions.json'), clones: path.join(WS, 'code') };
  const rj = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const wj = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); };
  const bad = (m, code = 400) => { const e = new Error(m); e.code = code; throw e; };
  const ENV = { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin`, FORCE_COLOR: '0', NO_COLOR: '1', GIT_TERMINAL_PROMPT: '0', PAGER: 'cat', GIT_PAGER: 'cat', TERM: 'dumb' };
  const has = (b) => spawnSync('sh', ['-c', `command -v ${b}`], { env: ENV }).status === 0;
  const RG = has('rg');

  // ---------- thư mục dự án ----------
  const workspaces = () => (rj(F.ws, {}).workspaces || []).filter((w) => w && typeof w.id === 'string' && typeof w.path === 'string');
  const saveWs = (list) => wj(F.ws, { workspaces: list.slice(0, 50) });
  const wsById = (id) => workspaces().find((w) => w.id === id) || bad('Chưa chọn thư mục dự án (hoặc thư mục đã bị gỡ).', 404);
  const expand = (p) => String(p || '').trim().replace(/^~(?=$|[\/\\])/, os.homedir());
  function addWorkspace(p, name) {
    const abs = path.resolve(expand(p));
    let real; try { real = fs.realpathSync(abs); } catch { bad('Không thấy thư mục: ' + abs); }
    if (!fs.statSync(real).isDirectory()) bad('Đây không phải thư mục: ' + real);
    if (real === path.parse(real).root || real === fs.realpathSync(os.homedir())) bad('Chọn một thư mục dự án cụ thể, không chọn cả ổ đĩa hay cả thư mục nhà.');
    const list = workspaces(); const old = list.find((w) => w.path === real);
    if (old) return old;
    const w = { id: 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: String(name || path.basename(real)).slice(0, 60), path: real, addedAt: Date.now() };
    saveWs([w, ...list]); return w;
  }
  /** Đường dẫn tuyệt đối trong thư mục dự án; chặn thoát ra ngoài kể cả qua symlink. */
  function resolveIn(w, rel, { write = false } = {}) {
    const root = w.path;
    const r0 = String(rel ?? '.') || '.';
    const p = path.isAbsolute(r0) ? path.resolve(r0) : path.resolve(root, r0);
    const inside = (x) => x === root || x.startsWith(root + path.sep);
    if (!inside(p)) bad(`Đường dẫn "${rel}" nằm ngoài thư mục dự án.`);
    let probe = p; while (!fs.existsSync(probe) && probe !== root) probe = path.dirname(probe);
    let real; try { real = fs.realpathSync(probe); } catch { real = probe; }
    if (!inside(real)) bad(`Đường dẫn "${rel}" trỏ ra ngoài thư mục dự án (symlink).`);
    const relp = path.relative(root, p).split(path.sep).join('/');
    if (write && (relp === '.git' || relp.startsWith('.git/'))) bad('Không ghi trực tiếp vào thư mục .git.');
    return { abs: p, rel: relp || '.' };
  }
  const isBinary = (buf) => buf.subarray(0, 8000).includes(0);
  function readText(abs) {
    const st = fs.statSync(abs);
    if (st.size > MAX_READ) bad(`File quá lớn (${Math.round(st.size / 1024)} KB), đọc theo đoạn bằng run_command (head/sed) nếu cần.`);
    const b = fs.readFileSync(abs); if (isBinary(b)) bad('File nhị phân, không đọc dạng chữ được.');
    return b.toString('utf8');
  }
  const clip = (s, n = MAX_OUT) => { s = String(s || ''); return s.length <= n ? s : s.slice(0, Math.floor(n * 0.4)) + `\n… (lược ${s.length - n} ký tự) …\n` + s.slice(-Math.floor(n * 0.6)); };

  function walk(root, startAbs, { maxDepth = 12, max = 2000 } = {}) {
    const out = []; const stack = [[startAbs, 0]];
    while (stack.length && out.length < max) {
      const [d, depth] = stack.pop(); let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
      ents.sort((a, b) => b.name.localeCompare(a.name));
      for (const e of ents) {
        if (IGNORE.has(e.name)) continue;
        const abs = path.join(d, e.name); const rel = path.relative(root, abs).split(path.sep).join('/');
        if (e.isDirectory()) { out.push(rel + '/'); if (depth + 1 < maxDepth) stack.push([abs, depth + 1]); }
        else if (e.isFile() || e.isSymbolicLink()) out.push(rel);
        if (out.length >= max) break;
      }
    }
    return out.sort();
  }
  const globRe = (g) => { let re = ''; const s = String(g); for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '*' && s[i + 1] === '*') { if (s[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i++; } } else if (c === '*') re += '[^/]*'; else if (c === '?') re += '[^/]'; else if (c === '{') { const j = s.indexOf('}', i); if (j > i) { re += '(?:' + s.slice(i + 1, j).split(',').map((x) => x.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|') + ')'; i = j; } else re += '\\{'; } else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&'); } return new RegExp('^' + re + '$'); };

  function git(w, args, { timeout = 20000 } = {}) {
    const r = spawnSync('git', args, { cwd: w.path, encoding: 'utf8', env: ENV, timeout, maxBuffer: 20 * 1024 * 1024 });
    return { code: r.status ?? 1, out: (r.stdout || '') + (r.stderr ? (r.stdout ? '\n' : '') + r.stderr : '') };
  }
  const isRepo = (w) => git(w, ['rev-parse', '--is-inside-work-tree']).out.trim() === 'true';

  // ---------- bản lưu trước khi sửa (hoàn tác) ----------
  const snapFile = (sid) => path.join(SNAPS, String(sid || 'none').replace(/[^\w-]/g, '_').slice(0, 40) + '.json');
  const snaps = (sid) => rj(snapFile(sid), []);
  function addSnap(sid, w, rel, before, after) {
    const list = snaps(sid);
    const s = { id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ws: w.id, file: rel, before: (before || '').length + (after || '').length > 4e6 ? undefined : before, after, at: Date.now() };
    if (before !== null && s.before === undefined) s.tooBig = true;
    list.push(s); wj(snapFile(sid), list.slice(-80)); return s.id;
  }
  /** Hoàn tác từ lần sửa mới nhất lùi về đến snapId (gồm cả snapId). Dừng nếu file đã bị đổi sau đó. */
  function undo(sid, snapId) {
    const list = snaps(sid); const idx = list.findIndex((s) => s.id === snapId);
    if (idx < 0) bad('Không còn bản lưu để hoàn tác.');
    const done = [];
    for (let i = list.length - 1; i >= idx; i--) {
      const s = list[i]; if (s.reverted) continue;
      const w = wsById(s.ws); const { abs } = resolveIn(w, s.file, { write: true });
      const cur = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
      if (s.tooBig) bad(`File ${s.file} quá lớn, không có bản lưu.`);
      if (cur !== s.after) bad(`${s.file} đã bị thay đổi sau lần sửa này, không hoàn tác tự động được.${done.length ? ' Đã hoàn tác: ' + done.join(', ') : ''}`);
      if (s.before === null) fs.unlinkSync(abs); else fs.writeFileSync(abs, s.before);
      s.reverted = true; done.push(s.file);
    }
    wj(snapFile(sid), list);
    return { ok: true, files: [...new Set(done)], reverted: list.filter((s) => s.reverted).map((s) => s.id) };
  }

  // ---------- chạy lệnh ----------
  const running = new Map(); // phiên → tiến trình
  function runCommand(w, sid, command, timeoutSec) {
    const cmd = String(command || '').trim(); if (!cmd) bad('Thiếu lệnh.');
    const t = Math.min(600, Math.max(5, Number(timeoutSec) || 120)) * 1000;
    return new Promise((resolve) => {
      const shell = process.platform === 'win32' ? 'cmd.exe' : fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
      const p = spawn(shell, process.platform === 'win32' ? ['/d', '/s', '/c', cmd] : ['-c', cmd], { cwd: w.path, env: ENV, detached: process.platform !== 'win32' });
      running.set(sid, p);
      let out = ''; let killed = '';
      const feed = (d) => { out += d.toString(); if (out.length > 4 * MAX_OUT) out = out.slice(0, MAX_OUT) + '\n…\n' + out.slice(-2 * MAX_OUT); };
      p.stdout.on('data', feed); p.stderr.on('data', feed);
      const kill = (why) => { killed = why; try { process.kill(-p.pid, 'SIGKILL'); } catch { try { p.kill('SIGKILL'); } catch {} } };
      p.kill2 = kill;
      const timer = setTimeout(() => kill(`quá ${t / 1000} giây`), t);
      const t0 = Date.now();
      p.on('close', (code) => { clearTimeout(timer); running.delete(sid); resolve({ code: code ?? 1, out, killed, ms: Date.now() - t0 }); });
      p.on('error', (e) => { clearTimeout(timer); running.delete(sid); resolve({ code: 1, out: out + String(e.message || e), killed, ms: Date.now() - t0 }); });
    });
  }

  // ---------- sổ lệnh của agent ----------
  const editPreview = (w, a, name) => {
    const { abs, rel } = resolveIn(w, a.path, { write: true });
    if (C.isSecretPath(rel)) bad(`Không sửa file bí mật ${rel} qua agent.`);
    const exists = fs.existsSync(abs);
    if (exists && fs.statSync(abs).isDirectory()) bad(`${rel} là thư mục.`);
    const before = exists ? readText(abs) : null;
    let after;
    if (name === 'write_file') { if (typeof a.content !== 'string') bad('Thiếu content.'); after = a.content; }
    else {
      if (!exists) bad(`Chưa có file ${rel}. Dùng write_file để tạo file mới.`);
      const o = String(a.old_string ?? ''), n = String(a.new_string ?? '');
      if (!o) bad('old_string trống. Dùng write_file để viết lại cả file.');
      if (o === n) bad('old_string và new_string giống nhau.');
      const count = before.split(o).length - 1;
      if (!count) bad(`Không tìm thấy old_string trong ${rel}. Đọc lại file (read_file) và chép đúng từng ký tự, kể cả khoảng trắng.`);
      if (count > 1 && !a.replace_all) bad(`old_string xuất hiện ${count} lần trong ${rel}. Thêm vài dòng xung quanh cho duy nhất, hoặc đặt replace_all=true.`);
      after = a.replace_all ? before.split(o).join(n) : before.replace(o, () => n);
    }
    const d = C.unified(rel, before, after);
    return { abs, rel, before, after, isNew: !exists, diff: d.text, added: d.added, removed: d.removed };
  };

  const TOOLS = [
    { name: 'list_files', title: 'Liệt kê file', access: 'read', description: 'Liệt kê file và thư mục (bỏ qua node_modules, .git, dist...). Có pattern dạng glob (ví dụ "src/**/*.ts") thì chỉ trả file khớp.', inputSchema: obj({ path: str('thư mục con, mặc định gốc dự án'), pattern: str('glob lọc, ví dụ **/*.test.js') }),
      run(w, a) {
        const { abs, rel } = resolveIn(w, a.path || '.');
        if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) bad(`Không có thư mục ${rel}.`);
        let list = walk(w.path, abs, { maxDepth: a.pattern ? 14 : 3, max: a.pattern ? 5000 : 400 });
        if (a.pattern) { const re = globRe(a.pattern); const re2 = globRe('**/' + a.pattern); list = list.filter((x) => !x.endsWith('/') && (re.test(x) || (!String(a.pattern).includes('/') && re2.test(x)))); }
        const shown = list.slice(0, 300);
        return { text: shown.length ? shown.join('\n') + (list.length > 300 ? `\n… và ${list.length - 300} mục khác (lọc bằng pattern)` : '') : 'Không có file nào khớp.' };
      } },
    { name: 'read_file', title: 'Đọc file', access: 'read', description: 'Đọc file chữ, trả từng dòng kèm số dòng. File dài thì đọc theo đoạn bằng offset (dòng bắt đầu, từ 1) và limit (số dòng, mặc định 400).', inputSchema: obj({ path: str('đường dẫn file'), offset: { type: 'number', description: 'dòng bắt đầu (từ 1)' }, limit: { type: 'number', description: 'số dòng, tối đa 2000' } }, ['path']),
      run(w, a) {
        const { abs, rel } = resolveIn(w, a.path);
        if (C.isSecretPath(rel)) bad(`${rel} có thể chứa khoá bí mật nên Socin Code không gửi nội dung cho AI. Mở file bằng trình soạn thảo nếu cần.`);
        if (!fs.existsSync(abs)) bad(`Không có file ${rel}.`);
        if (fs.statSync(abs).isDirectory()) bad(`${rel} là thư mục, dùng list_files.`);
        const lines = C.splitLines(readText(abs)); const from = Math.max(1, Number(a.offset) || 1); const n = Math.min(2000, Math.max(1, Number(a.limit) || 400));
        const part = lines.slice(from - 1, from - 1 + n).map((l, i) => `${String(from + i).padStart(5)}→${l.length > 600 ? l.slice(0, 600) + '…' : l}`);
        return { text: (part.join('\n') || '(file trống)') + (from - 1 + n < lines.length ? `\n… còn ${lines.length - (from - 1 + n)} dòng (đọc tiếp với offset=${from + n})` : ''), file: rel };
      } },
    { name: 'search', title: 'Tìm trong mã', access: 'read', description: 'Tìm theo biểu thức chính quy trong nội dung file, trả "file:dòng: nội dung". Có thể lọc thư mục (path) và glob (ví dụ *.ts).', inputSchema: obj({ pattern: str('biểu thức tìm (regex)'), path: str('thư mục con'), glob: str('lọc file, ví dụ *.js'), ignore_case: { type: 'boolean' } }, ['pattern']),
      run(w, a) {
        const { abs, rel } = resolveIn(w, a.path || '.'); const pat = String(a.pattern || ''); if (!pat) bad('Thiếu pattern.');
        let lines = [];
        if (RG) {
          const args = ['-n', '--no-heading', '--color', 'never', '--max-columns', '300', '--max-count', '50', ...(a.ignore_case ? ['-i'] : []), ...(a.glob ? ['--glob', String(a.glob)] : []), '--glob', '!.env*', '-e', pat, rel === '.' ? '.' : rel];
          const r = spawnSync('rg', args, { cwd: w.path, encoding: 'utf8', env: ENV, timeout: 20000, maxBuffer: 20 * 1024 * 1024 });
          if (r.status === 2) bad('Lỗi tìm: ' + String(r.stderr).trim().split('\n')[0]);
          lines = String(r.stdout || '').split('\n').filter(Boolean).map((l) => l.replace(/^\.\//, ''));
        } else {
          let re; try { re = new RegExp(pat, a.ignore_case ? 'i' : ''); } catch (e) { bad('Biểu thức sai: ' + e.message); }
          const g = a.glob ? globRe(String(a.glob).includes('/') ? a.glob : '**/' + a.glob) : null;
          for (const f of walk(w.path, abs, { max: 8000 })) {
            if (f.endsWith('/') || (g && !g.test(f)) || C.isSecretPath(f)) continue;
            let t; try { const b = fs.readFileSync(path.join(w.path, f)); if (b.length > MAX_READ || isBinary(b)) continue; t = b.toString('utf8'); } catch { continue; }
            t.split('\n').forEach((l, i) => { if (lines.length < 400 && re.test(l)) lines.push(`${f}:${i + 1}:${l.slice(0, 300)}`); });
            if (lines.length >= 400) break;
          }
        }
        return { text: lines.length ? lines.slice(0, 200).join('\n') + (lines.length > 200 ? `\n… và ${lines.length - 200} dòng khác` : '') : 'Không tìm thấy.' };
      } },
    { name: 'edit_file', title: 'Sửa file', access: 'edit', description: 'Thay một đoạn trong file: old_string (khớp từng ký tự, phải duy nhất trong file) thành new_string. replace_all=true để thay mọi chỗ. Đọc file trước khi sửa.', inputSchema: obj({ path: str('đường dẫn file'), old_string: str('đoạn cũ, chép đúng từ file'), new_string: str('đoạn mới'), replace_all: { type: 'boolean' } }, ['path', 'old_string', 'new_string']),
      run(w, a, sid) { const p = editPreview(w, a, 'edit_file'); fs.writeFileSync(p.abs, p.after); const snap = addSnap(sid, w, p.rel, p.before, p.after); return { text: `Đã sửa ${p.rel} (+${p.added} −${p.removed}).\n${clip(p.diff, 4000)}`, meta: { kind: 'diff', file: p.rel, diff: p.diff, added: p.added, removed: p.removed, snap } }; } },
    { name: 'write_file', title: 'Ghi file', access: 'edit', description: 'Tạo file mới hoặc viết lại toàn bộ file với content. Sửa một phần thì dùng edit_file.', inputSchema: obj({ path: str('đường dẫn file'), content: str('toàn bộ nội dung') }, ['path', 'content']),
      run(w, a, sid) { const p = editPreview(w, a, 'write_file'); fs.mkdirSync(path.dirname(p.abs), { recursive: true }); fs.writeFileSync(p.abs, p.after); const snap = addSnap(sid, w, p.rel, p.before, p.after); return { text: `${p.isNew ? 'Đã tạo' : 'Đã ghi'} ${p.rel} (${C.splitLines(p.after).length} dòng, +${p.added} −${p.removed}).`, meta: { kind: 'diff', file: p.rel, diff: p.diff, added: p.added, removed: p.removed, snap, isNew: p.isNew } }; } },
    { name: 'run_command', title: 'Chạy lệnh', access: 'run', description: 'Chạy lệnh terminal trong thư mục dự án (bash), ví dụ npm test, npm run build, python -m pytest. Trả mã thoát và output (cắt bớt nếu dài). Không dùng cho lệnh chạy mãi (server dev) trừ khi đặt timeout ngắn.', inputSchema: obj({ command: str('lệnh'), timeout: { type: 'number', description: 'giây, mặc định 120, tối đa 600' } }, ['command']),
      async run(w, a, sid) {
        const r = await runCommand(w, sid, a.command, a.timeout);
        const head = `$ ${a.command}\n`; const tail = r.killed ? `\n[dừng: ${r.killed}]` : `\n[mã thoát ${r.code} · ${(r.ms / 1000).toFixed(1)} giây]`;
        return { text: head + clip(r.out) + tail, isError: r.code !== 0, meta: { kind: 'term', command: a.command, code: r.code, killed: r.killed, ms: r.ms } };
      } },
    { name: 'git_status', title: 'Git: trạng thái', access: 'read', description: 'git status ngắn: nhánh, file đã sửa/chưa theo dõi.', inputSchema: obj(),
      run(w) { if (!isRepo(w)) return { text: 'Thư mục này chưa là repo git (chạy "git init" nếu muốn).' }; return { text: git(w, ['status', '--short', '--branch']).out.trim() || 'Sạch.' }; } },
    { name: 'git_diff', title: 'Git: thay đổi', access: 'read', description: 'Xem thay đổi chưa commit (git diff). staged=true để xem phần đã stage. path để lọc một file/thư mục.', inputSchema: obj({ path: str('lọc theo file/thư mục'), staged: { type: 'boolean' } }),
      run(w, a) {
        if (!isRepo(w)) bad('Chưa là repo git.');
        const args = ['diff', '--no-color', ...(a.staged ? ['--cached'] : []), ...(a.path ? ['--', resolveIn(w, a.path).rel] : [])];
        const d = git(w, args).out; const un = a.staged ? '' : git(w, ['ls-files', '--others', '--exclude-standard']).out.trim();
        return { text: clip((d.trim() || 'Không có thay đổi đã theo dõi.') + (un ? `\n\nFile mới chưa theo dõi:\n${un}` : '')) };
      } },
    { name: 'git_log', title: 'Git: lịch sử', access: 'read', description: 'Các commit gần đây (một dòng mỗi commit).', inputSchema: obj({ n: { type: 'number', description: 'số commit, mặc định 10' } }),
      run(w, a) { if (!isRepo(w)) bad('Chưa là repo git.'); return { text: git(w, ['log', '--oneline', '--decorate', '-n', String(Math.min(50, Math.max(1, Number(a.n) || 10)))]).out.trim() || 'Chưa có commit.' }; } },
    { name: 'git_commit', title: 'Git: commit', access: 'run', description: 'Stage và commit. files: danh sách file cần stage (bỏ trống = tất cả thay đổi). Không push.', inputSchema: obj({ message: str('thông điệp commit'), files: { type: 'array', items: { type: 'string' }, description: 'file cần commit' } }, ['message']),
      run(w, a) {
        if (!isRepo(w)) bad('Chưa là repo git.');
        const msg = String(a.message || '').trim(); if (!msg) bad('Thiếu thông điệp commit.');
        const files = Array.isArray(a.files) && a.files.length ? a.files.map((f) => resolveIn(w, f).rel) : null;
        const add = git(w, ['add', ...(files ? ['--', ...files] : ['-A'])]); if (add.code) bad('git add lỗi: ' + add.out);
        const c = git(w, ['commit', '-m', msg]);
        return { text: c.out.trim(), isError: c.code !== 0 };
      } },
    { name: 'todo_write', title: 'Kế hoạch', access: 'read', description: 'Ghi/cập nhật danh sách việc của nhiệm vụ hiện tại (thay cả danh sách). status: todo, doing, done. Chỉ một việc "doing" một lúc.', inputSchema: obj({ todos: { type: 'array', items: obj({ content: str('việc cần làm'), status: str('todo | doing | done', { enum: ['todo', 'doing', 'done'] }) }, ['content', 'status']) } }, ['todos']),
      run(w, a) { const t = C.cleanTodos(a.todos); return { text: `Đã cập nhật kế hoạch: ${t.filter((x) => x.status === 'done').length}/${t.length} việc xong.`, meta: { kind: 'todos', todos: t } }; } },
  ];
  const BY = new Map(TOOLS.map((t) => [t.name, t]));
  const toolDefs = () => TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, access: t.access }));

  /** Gọi lệnh: kiểm tra chế độ quyền và sự đồng ý của người dùng ở đây (không tin hoàn toàn trình duyệt). */
  async function callTool(name, input, { ws, session, mode = 'ask', confirmed = false } = {}) {
    const t = BY.get(name); if (!t) return { text: `Không có lệnh "${name}".`, isError: true };
    const a = input && typeof input === 'object' ? input : {};
    mode = C.cleanMode(mode);
    if (!C.allowed(mode, t.access)) return { text: `Đang ở chế độ "${C.MODES[mode].label}": chỉ đọc mã và lập kế hoạch. Trình bày kế hoạch để người dùng duyệt rồi chuyển chế độ.`, isError: true };
    if (C.needsAsk(mode, t.access, a) && !confirmed) return { text: 'Lệnh này cần người dùng đồng ý trước.', isError: true };
    try { const w = wsById(ws); return await t.run(w, a, session); } catch (e) { return { text: String(e.message || e), isError: true }; }
  }
  /** Xem trước thay đổi để hỏi người dùng (không ghi gì). */
  function preview(name, input, ws) {
    const w = wsById(ws);
    if (name === 'edit_file' || name === 'write_file') { const p = editPreview(w, input || {}, name); return { kind: 'diff', file: p.rel, diff: p.diff, added: p.added, removed: p.removed, isNew: p.isNew }; }
    if (name === 'run_command') return { kind: 'term', command: String((input || {}).command || '') };
    if (name === 'git_commit') return { kind: 'commit', message: String((input || {}).message || ''), status: isRepo(w) ? git(w, ['status', '--short']).out.trim() : '' };
    return {};
  }

  // ---------- ngữ cảnh mỗi lượt ----------
  function context(ws) {
    const w = wsById(ws);
    let tree = []; try { tree = fs.readdirSync(w.path, { withFileTypes: true }).filter((e) => !IGNORE.has(e.name)).map((e) => e.name + (e.isDirectory() ? '/' : '')).sort().slice(0, 60); } catch {}
    const repo = isRepo(w);
    const gitInfo = repo ? { branch: git(w, ['rev-parse', '--abbrev-ref', 'HEAD']).out.trim(), status: git(w, ['status', '--short']).out.trim().split('\n').filter(Boolean).slice(0, 25).join('\n') } : null;
    let memory = null;
    for (const f of ['SOCIN.md', 'AGENTS.md', 'CLAUDE.md']) { const p = path.join(w.path, f); if (fs.existsSync(p)) { try { memory = { file: f, text: fs.readFileSync(p, 'utf8').slice(0, 6000) }; break; } catch {} } }
    return { workspace: { id: w.id, name: w.name, path: w.path }, platform: `${os.platform()} ${os.arch()}`, git: gitInfo, tree, memory };
  }

  // ---------- duyệt thư mục để chọn, clone repo ----------
  function browse(p) {
    const abs = path.resolve(expand(p || '~'));
    let ents; try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch { bad('Không mở được thư mục ' + abs); }
    const dirs = ents.filter((e) => e.isDirectory() && !e.name.startsWith('.') && !IGNORE.has(e.name)).map((e) => e.name).sort((a, b) => a.localeCompare(b)).slice(0, 300);
    return { path: abs, parent: path.dirname(abs) !== abs ? path.dirname(abs) : null, dirs, isRepo: fs.existsSync(path.join(abs, '.git')) };
  }
  function suggestions() {
    const out = [];
    const push = (p, why) => { try { if (fs.existsSync(p) && fs.statSync(p).isDirectory()) out.push({ path: p, why }); } catch {} };
    for (const base of [F.clones, path.join(WS, 'repos')]) { try { for (const d of fs.readdirSync(base)) push(path.join(base, d), base === F.clones ? 'đã clone' : 'S Test Hub'); } catch {} }
    for (const d of ['Projects', 'Code', 'code', 'Developer', 'dev', 'src', 'GitHub', 'Downloads/ClaudeCode']) push(path.join(os.homedir(), d), 'thư mục hay dùng');
    return out.slice(0, 30);
  }
  function clone(url) {
    const u = String(url || '').trim();
    if (!/^(https:\/\/[\w.-]+\/[\w.\/-]+?|git@[\w.-]+:[\w.\/-]+?)(\.git)?$/.test(u)) bad('Địa chỉ repo không hợp lệ (https://github.com/owner/repo).');
    const name = u.replace(/\.git$/, '').split(/[\/:]/).pop().replace(/[^\w.-]/g, '_');
    const dest = path.join(F.clones, name);
    if (fs.existsSync(dest)) return Promise.resolve(addWorkspace(dest, name));
    fs.mkdirSync(F.clones, { recursive: true });
    return new Promise((resolve, reject) => {
      const p = spawn('git', ['clone', '--', u, dest], { env: ENV }); let err = '';
      p.stderr.on('data', (d) => { err = (err + d).slice(-800); });
      const t = setTimeout(() => p.kill('SIGKILL'), 300000);
      p.on('close', (c) => { clearTimeout(t); c === 0 ? resolve(addWorkspace(dest, name)) : reject(Object.assign(new Error('Clone lỗi: ' + err.trim().split('\n').pop()), { code: 400 })); });
    });
  }

  // ---------- HTTP /api/code/* ----------
  const MAXB = 16 * 1024 * 1024;
  const bigBody = (req) => new Promise((resolve, reject) => { let n = 0; const parts = []; req.on('data', (d) => { n += d.length; if (n > MAXB) { reject(Object.assign(new Error('Gói gửi quá lớn'), { code: 413 })); req.destroy(); } else parts.push(d); }); req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch { resolve({}); } }); });

  const handler = async (req, res, u) => {
    if (!u.pathname.startsWith('/api/code/')) return false;
    const r = u.pathname.slice(10); const post = req.method === 'POST'; const q = (k) => u.searchParams.get(k) || '';
    // Lệnh POST phải gửi JSON (trang web lạ không gửi được JSON tới 127.0.0.1 khi chưa qua CORS)
    if (post && !/^application\/json/.test(String(req.headers['content-type'] || ''))) return json(res, 415, { error: 'Cần content-type application/json' }), true;
    try {
      if (r === 'tools') return json(res, 200, { tools: toolDefs(), modes: C.MODES, rg: RG }), true;
      if (r === 'workspaces' && !post) return json(res, 200, { workspaces: workspaces().map((w) => ({ ...w, exists: fs.existsSync(w.path) })), suggestions: suggestions() }), true;
      if (r === 'workspaces' && post) { const b = await body(req); return json(res, 200, { workspace: addWorkspace(b.path, b.name) }), true; }
      if (r === 'workspaces/update' && post) { const b = await body(req); const list = workspaces(); const w = list.find((x) => x.id === b.id) || bad('Không có thư mục này.', 404); if (b.projectId !== undefined) w.projectId = String(b.projectId || '').slice(0, 40); if (typeof b.name === 'string' && b.name.trim()) w.name = b.name.trim().slice(0, 60); saveWs(list); return json(res, 200, { workspace: w }), true; }
      if (r === 'workspaces/remove' && post) { const b = await body(req); saveWs(workspaces().filter((w) => w.id !== b.id)); return json(res, 200, { ok: true }), true; }
      if (r === 'browse') return json(res, 200, browse(q('path'))), true;
      if (r === 'clone' && post) { const b = await body(req); return json(res, 200, { workspace: await clone(b.url) }), true; }
      if (r === 'context') return json(res, 200, context(q('ws'))), true;
      if (r === 'files') { const w = wsById(q('ws')); const k = q('q').toLowerCase(); const all = walk(w.path, w.path, { max: 6000 }).filter((f) => !f.endsWith('/')); return json(res, 200, { files: (k ? all.filter((f) => f.toLowerCase().includes(k)) : all).slice(0, 50) }), true; }
      if (r === 'file') { const w = wsById(q('ws')); const { abs, rel } = resolveIn(w, q('path')); if (C.isSecretPath(rel)) bad('File bí mật, không hiển thị.'); return json(res, 200, { path: rel, text: readText(abs) }), true; }
      if (r === 'changes') {
        const w = wsById(q('ws')); if (!isRepo(w)) return json(res, 200, { repo: false }), true;
        const st = git(w, ['status', '--porcelain=v1', '--branch']).out.split('\n').filter(Boolean);
        const branch = (st[0] || '').replace(/^## /, ''); const files = st.slice(1).map((l) => ({ code: l.slice(0, 2), file: l.slice(3) }));
        return json(res, 200, { repo: true, branch, files, diff: clip(git(w, ['diff', '--no-color', 'HEAD']).out, 200000) }), true;
      }
      if (r === 'call' && post) { const b = await bigBody(req); return json(res, 200, await callTool(String(b.name || ''), b.input || {}, { ws: String(b.ws || ''), session: String(b.session || ''), mode: b.mode, confirmed: b.confirmed === true })), true; }
      if (r === 'preview' && post) { const b = await bigBody(req); try { return json(res, 200, { ok: true, ...preview(String(b.name || ''), b.input || {}, String(b.ws || '')) }), true; } catch (e) { return json(res, 200, { ok: false, error: e.message }), true; } }
      if (r === 'undo' && post) { const b = await body(req); return json(res, 200, undo(String(b.session || ''), String(b.snap || ''))), true; }
      if (r === 'kill' && post) { const b = await body(req); const p = running.get(String(b.session || '')); if (p) p.kill2('người dùng bấm Dừng'); return json(res, 200, { ok: true, killed: !!p }), true; }
      if (r === 'sessions' && !post) return json(res, 200, { sessions: C.cleanSessions(rj(F.sessions, [])) }), true;
      if (r === 'sessions' && post) { const b = await bigBody(req); wj(F.sessions, C.cleanSessions(b.sessions)); return json(res, 200, { ok: true }), true; }
      return json(res, 404, { error: 'not found' }), true;
    } catch (e) { return json(res, e.code === 413 ? 413 : e.code === 404 ? 404 : 400, { error: String(e.message || e) }), true; }
  };
  handler.callTool = callTool; handler.addWorkspace = addWorkspace; handler.preview = preview; handler.undo = undo; handler.context = context; handler.TOOLS = TOOLS;
  return handler;
};
