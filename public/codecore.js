// Lõi Socin Code (lập trình kiểu Claude Code trong Socin Studio), dùng chung cho trình duyệt (window.CodeCore) và server Node.
// - Lời nhắc hệ thống cho agent lập trình, ngữ cảnh thư mục dự án (gọn để vừa giới hạn 6000 ký tự của AI Socin).
// - So sánh dòng (diff) để xem trước thay đổi, chế độ quyền, lệnh an toàn được tự chạy, lệnh nhanh "/init", "/review"...
// - Làm sạch dữ liệu phiên lập trình trước khi lưu.
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.CodeCore = m;
})(typeof self !== 'undefined' ? self : this, function () {
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

  const CODE_SYSTEM = `Bạn là Socin Code, agent lập trình chạy ngay trên máy người dùng, làm việc trong MỘT thư mục dự án. Trả lời bằng tiếng Việt, ngắn gọn.
Cách làm:
- Đọc trước khi sửa: dùng list_files, search, read_file để hiểu mã; không đoán nội dung file.
- Sửa bằng edit_file (thay đúng một đoạn, old_string phải khớp từng ký tự và chỉ xuất hiện một lần); chỉ dùng write_file cho file mới hoặc viết lại toàn bộ.
- Việc từ 3 bước trở lên: ghi kế hoạch bằng todo_write, cập nhật trạng thái khi làm xong từng bước.
- Sau khi sửa: chạy test/lint/build của dự án bằng run_command nếu có, sửa đến khi qua.
- Không chạy lệnh phá huỷ (rm -rf, git push --force, reset --hard...) khi người dùng chưa yêu cầu. Không commit nếu người dùng chưa bảo.
- Sửa file và chạy lệnh được app hỏi người dùng trước; nếu bị từ chối thì dừng và hỏi lại.
- Không in ra hay ghi khoá bí mật (.env, token) vào câu trả lời.
- Xong việc: nói gọn đã đổi gì (file nào), kết quả test, việc còn lại.`;

  /** read: chỉ đọc · edit: sửa file · run: chạy lệnh (luôn hỏi trừ lệnh an toàn) */
  const MODES = {
    plan: { label: 'Kế hoạch', hint: 'Chỉ đọc mã và lập kế hoạch, không sửa, không chạy lệnh' },
    ask: { label: 'Hỏi trước', hint: 'Sửa file và chạy lệnh đều hỏi bạn (mặc định)' },
    edit: { label: 'Tự sửa file', hint: 'Tự sửa file (có diff, hoàn tác được); chạy lệnh vẫn hỏi' },
  };
  const cleanMode = (m) => (MODES[m] ? m : 'ask');
  /** Lệnh có được dùng ở chế độ này không. */
  const allowed = (mode, access) => access === 'read' || mode !== 'plan';
  /** Có phải hỏi người dùng không (chưa tính "luôn cho phép"). */
  function needsAsk(mode, access, input) {
    if (access === 'read') return false;
    if (access === 'edit') return mode !== 'edit';
    if (access === 'run') return !(input && typeof input.command === 'string' && isSafeCommand(input.command));
    return true;
  }

  /** Lệnh chỉ đọc, không có ký tự nối lệnh/chuyển hướng: được tự chạy. */
  const SAFE = /^(git (status|diff|log|show|branch|remote -v|rev-parse)|ls|pwd|cat|head|tail|wc|grep|rg|find|node -v|node --version|npm -v|npm ls|python3? --version|which|echo)(\s|$)/;
  /** File chứa bí mật: không đọc để gửi cho AI. */
  const SECRET = /(^|[\/\s])(\.env(\.[\w-]+)?|id_rsa|id_ed25519|[\w.-]+\.(pem|key|p12|pfx|keystore)|credentials\.json|\.npmrc|\.netrc)(\s|$)/i;
  const isSecretPath = (p) => SECRET.test(' ' + String(p || '').replace(/\\/g, '/') + ' ') && !/\.env\.(example|sample|template)\s*$/i.test(String(p || ''));
  function isSafeCommand(cmd) {
    const c = String(cmd || '').trim();
    if (!c || c.length > 300 || /[;&|<>`$\\\n]|\.\.|(^|\s)[~\/]/.test(c)) return false; // không nối lệnh, không ra ngoài thư mục dự án
    if (/\s-(exec|execdir|delete|ok|fprint\w*|fls)\b|--(output|pre|ext-diff)\b|\s-f\b/.test(c)) return false; // không ghi file, không chạy lệnh phụ, không tail -f
    if (SECRET.test(c)) return false;
    return SAFE.test(c);
  }
  /** Khoá "luôn cho phép" cho lệnh: hai từ đầu (npm test, git add...). */
  const commandKey = (cmd) => String(cmd || '').trim().split(/\s+/).slice(0, 2).join(' ');

  // ---------- diff dòng ----------
  const splitLines = (s) => { const t = String(s ?? ''); if (!t) return []; const a = t.split('\n'); if (a[a.length - 1] === '') a.pop(); return a; };
  /** Danh sách thao tác {t:' '|'-'|'+', a, b, s}: cắt phần đầu/cuối giống nhau rồi LCS phần giữa (giới hạn để không treo máy). */
  function diffOps(oldText, newText) {
    const A = splitLines(oldText), B = splitLines(newText);
    let p = 0; while (p < A.length && p < B.length && A[p] === B[p]) p++;
    let s = 0; while (s < A.length - p && s < B.length - p && A[A.length - 1 - s] === B[B.length - 1 - s]) s++;
    const a = A.slice(p, A.length - s), b = B.slice(p, B.length - s);
    const ops = [];
    for (let i = 0; i < p; i++) ops.push({ t: ' ', a: i, b: i, s: A[i] });
    if (a.length * b.length > 4e6) { a.forEach((x, i) => ops.push({ t: '-', a: p + i, s: x })); b.forEach((x, i) => ops.push({ t: '+', b: p + i, s: x })); }
    else {
      const n = a.length, m = b.length; const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      let i = 0, j = 0;
      while (i < n || j < m) {
        if (i < n && j < m && a[i] === b[j]) { ops.push({ t: ' ', a: p + i, b: p + j, s: a[i] }); i++; j++; }
        else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) { ops.push({ t: '-', a: p + i, s: a[i] }); i++; }
        else { ops.push({ t: '+', b: p + j, s: b[j] }); j++; }
      }
    }
    for (let i = 0; i < s; i++) ops.push({ t: ' ', a: A.length - s + i, b: B.length - s + i, s: A[A.length - s + i] });
    return ops;
  }
  /** Gom thành các khúc (hunk) có 3 dòng ngữ cảnh. Trả { hunks:[{oldStart,newStart,lines:[{t,s}]}], added, removed } */
  function diffHunks(oldText, newText, ctx = 3) {
    const ops = diffOps(oldText, newText);
    const changed = ops.map((o, i) => (o.t !== ' ' ? i : -1)).filter((i) => i >= 0);
    const hunks = []; let added = 0, removed = 0;
    for (const o of ops) { if (o.t === '+') added++; if (o.t === '-') removed++; }
    let k = 0;
    while (k < changed.length) {
      let start = Math.max(0, changed[k] - ctx), end = Math.min(ops.length - 1, changed[k] + ctx);
      while (k + 1 < changed.length && changed[k + 1] - ctx <= end + 1) { k++; end = Math.min(ops.length - 1, changed[k] + ctx); }
      const slice = ops.slice(start, end + 1);
      let oldStart = 0, newStart = 0;
      for (let i = start; i < ops.length; i++) { if (ops[i].a !== undefined) { oldStart = ops[i].a + 1; break; } }
      for (let i = start; i < ops.length; i++) { if (ops[i].b !== undefined) { newStart = ops[i].b + 1; break; } }
      hunks.push({ oldStart, newStart, lines: slice.map((o) => ({ t: o.t, s: o.s })) });
      k++;
    }
    return { hunks, added, removed };
  }
  /** Văn bản unified diff (gửi lại cho model, hiện trong khung lệnh). */
  function unified(file, oldText, newText, maxLines = 400) {
    const d = diffHunks(oldText, newText);
    const out = [`--- ${oldText == null ? '/dev/null' : 'a/' + file}`, `+++ b/${file}`];
    for (const h of d.hunks) {
      const oc = h.lines.filter((l) => l.t !== '+').length, nc = h.lines.filter((l) => l.t !== '-').length;
      out.push(`@@ -${h.oldStart},${oc} +${h.newStart},${nc} @@`);
      for (const l of h.lines) out.push(l.t + l.s);
    }
    const cut = out.length > maxLines;
    return { text: (cut ? out.slice(0, maxLines).concat(`… (còn ${out.length - maxLines} dòng)`) : out).join('\n'), added: d.added, removed: d.removed };
  }

  // ---------- lệnh nhanh ----------
  const SLASH = [
    { name: 'init', title: 'Tạo SOCIN.md', prompt: 'Đọc cấu trúc dự án (package.json/README, thư mục chính, lệnh build/test) rồi tạo file SOCIN.md ở gốc dự án: mô tả ngắn dự án, lệnh hay dùng (cài, chạy, test, build), cấu trúc thư mục, quy ước viết mã. Ngắn gọn, dưới 80 dòng. Nếu đã có SOCIN.md thì cập nhật.' },
    { name: 'review', title: 'Review thay đổi', prompt: 'Xem git_diff (cả chưa stage) và review như một kỹ sư cẩn thận: lỗi logic, trường hợp biên, bảo mật, test còn thiếu. Liệt kê theo mức nghiêm trọng, chỉ ra file và dòng. Chưa sửa gì.' },
    { name: 'test', title: 'Chạy test và sửa', prompt: 'Tìm lệnh test của dự án, chạy, nếu lỗi thì đọc lỗi, sửa mã và chạy lại đến khi qua. Báo kết quả.' },
    { name: 'commit', title: 'Tạo commit', prompt: 'Xem git_status và git_diff, rồi tạo commit với thông điệp ngắn gọn bằng tiếng Việt mô tả thay đổi (git_commit). Không push.' },
    { name: 'explain', title: 'Giải thích dự án', prompt: 'Giải thích dự án này: mục đích, cấu trúc thư mục, luồng chạy chính, file quan trọng nhất. Ngắn gọn.' },
    { name: 'clear', title: 'Phiên mới', local: true },
    { name: 'diff', title: 'Xem thay đổi', local: true },
  ];

  /** Không có model: "!lệnh" chạy lệnh, "/tên_lệnh tham số" gọi lệnh, vài câu quen thuộc. ctx: { toolNames, parseArgs } */
  function localPlan(text, ctx) {
    const raw = String(text || '').trim();
    const names = new Set(ctx.toolNames || []);
    const help = () => ({ text: 'Đang chạy không có model AI. Bạn vẫn dùng được:\n• `!lệnh` để chạy lệnh terminal (ví dụ `!npm test`)\n• `/read_file path=src/app.js`, `/search pattern=TODO`, `/git_status`, `/git_diff`\n• "git status", "xem thay đổi", "danh sách file"\nMuốn agent tự đọc, sửa mã thì bật model ở nút Model (AI Socin hoặc model trên máy).', calls: [] });
    if (!raw) return help();
    if (raw.startsWith('!') && names.has('run_command')) return { text: '', calls: [{ name: 'run_command', input: { command: raw.slice(1).trim() } }] };
    if (raw.startsWith('/')) {
      const m = /^\/([\w-]+)\s*([\s\S]*)$/.exec(raw);
      if (!m || !names.has(m[1])) return help();
      const input = ctx.parseArgs ? ctx.parseArgs(m[2]) : {};
      if (input._ !== undefined) { const first = { read_file: 'path', list_files: 'path', search: 'pattern', run_command: 'command', git_diff: 'path', git_commit: 'message' }[m[1]]; if (first) input[first] = input._; delete input._; }
      return { text: '', calls: [{ name: m[1], input }] };
    }
    const q = String(raw).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
    if (/git status|trang thai git/.test(q)) return { text: '', calls: [{ name: 'git_status', input: {} }] };
    if (/(xem )?thay doi|git diff/.test(q)) return { text: '', calls: [{ name: 'git_diff', input: {} }] };
    if (/lich su|git log|commit gan/.test(q)) return { text: '', calls: [{ name: 'git_log', input: {} }] };
    if (/(danh sach|liet ke) file|cay thu muc/.test(q)) return { text: '', calls: [{ name: 'list_files', input: {} }] };
    return help();
  }

  // ---------- ngữ cảnh ----------
  /** o: { workspace:{name,path}, git:{branch,status}, tree:[...], memory:{file,text}, project:{name,instructions,notes}, todos } */
  function contextText(o, max = 5600) {
    const parts = [];
    if (o.workspace) parts.push(`Thư mục dự án: ${o.workspace.name} (${o.workspace.path}). Mọi đường dẫn là tương đối với thư mục này.`);
    if (o.platform) parts.push(`Máy: ${o.platform}`);
    if (o.git) parts.push(o.git.branch ? `Git: nhánh ${o.git.branch}${o.git.status ? `, thay đổi chưa commit:\n${o.git.status}` : ', sạch'}` : 'Không phải repo git.');
    if (o.tree && o.tree.length) parts.push(`Cấp đầu thư mục: ${o.tree.join(', ')}`);
    if (o.todos && o.todos.length) parts.push(`Kế hoạch hiện tại:\n${o.todos.map((t) => `[${t.status === 'done' ? 'x' : t.status === 'doing' ? '~' : ' '}] ${t.content}`).join('\n')}`);
    if (o.project) {
      if (o.project.instructions) parts.push(`Hướng dẫn dự án Studio "${o.project.name}":\n${o.project.instructions}`);
      for (const n of (o.project.notes || []).slice(0, 3)) parts.push(`Tài liệu "${n.title}":\n${String(n.text).slice(0, 1200)}`);
    }
    let text = parts.join('\n');
    if (o.memory && o.memory.text) {
      const room = max - text.length - 40;
      if (room > 200) text += `\n${o.memory.file} (ghi nhớ của dự án):\n${o.memory.text.slice(0, room)}`;
    }
    return text.slice(0, max);
  }
  /** Gói gửi AI Socin: máy chủ chỉ nhận context ≤ 6000 ký tự nên đặt luật Socin Code ở đầu context. */
  const socinContext = (ctx) => `${CODE_SYSTEM}\n\n${ctx}`.slice(0, 6000);

  // ---------- lưu trữ ----------
  const MAX_SESSIONS = 150;
  function cleanTodos(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter((t) => isObj(t) && typeof t.content === 'string' && t.content.trim()).slice(0, 30).map((t) => ({ content: t.content.trim().slice(0, 200), status: ['todo', 'doing', 'done'].includes(t.status) ? t.status : t.status === 'in_progress' ? 'doing' : t.status === 'completed' ? 'done' : 'todo' }));
  }
  function cleanSessions(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter((c) => isObj(c) && typeof c.id === 'string' && typeof c.title === 'string' && Array.isArray(c.messages))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, MAX_SESSIONS)
      .map((c) => ({
        id: c.id.slice(0, 40), title: c.title.slice(0, 120), updatedAt: Number(c.updatedAt) || 0,
        workspaceId: typeof c.workspaceId === 'string' ? c.workspaceId.slice(0, 40) : '',
        ...(c.projectId ? { projectId: String(c.projectId).slice(0, 40) } : {}),
        todos: cleanTodos(c.todos),
        ...(Array.isArray(c.reverted) ? { reverted: c.reverted.filter((x) => typeof x === 'string').slice(-200) } : {}),
        messages: c.messages.slice(-400).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: (Array.isArray(m.content) ? m.content : []).filter((b) => isObj(b) && b.type !== 'image').map((b) => (b.type === 'tool_result' ? { ...b, content: (b.content || []).filter((x) => x.type === 'text').map((x) => ({ type: 'text', text: String(x.text).slice(0, 30000) })) } : b)) })),
      }));
  }

  return { CODE_SYSTEM, MODES, isSecretPath, cleanMode, allowed, needsAsk, isSafeCommand, commandKey, splitLines, diffOps, diffHunks, unified, SLASH, localPlan, contextText, socinContext, cleanTodos, cleanSessions };
});
