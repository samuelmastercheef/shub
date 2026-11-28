// Socin Code: màn lập trình kiểu Claude Code trong Socin Studio.
// Vòng lặp agent chạy ở trình duyệt (AICore.runTurn), model qua /api/ai/socin hoặc /api/ai/llm/chat (profile code),
// lệnh đọc/sửa/chạy qua /api/code/* (server giữ mọi thao tác trong thư mục dự án, kiểm tra quyền lần nữa).
(() => {
'use strict';
const A = window.AICore, K = window.CodeCore;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (method, p, data) => { const r = await fetch(p, { method, headers: { 'content-type': 'application/json' }, body: data ? JSON.stringify(data) : undefined }); let j = {}; try { j = await r.json(); } catch {} if (!r.ok && !('ok' in j)) throw new Error(j.error || 'HTTP ' + r.status); return j; };
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

const S = { sessions: [], currentId: null, workspaces: [], wsId: store.get('scode.ws', ''), projects: [], tools: [], mode: K.cleanMode(store.get('scode.mode', 'ask')), llm: null, account: { linked: false }, busy: false, engine: null, panel: null, mentions: [], ctx: null, changes: null };
const MODE_LABEL = { auto: 'Tự động', socin: 'AI Socin', local: 'Trên máy' };
const ws = () => S.workspaces.find((w) => w.id === S.wsId) || null;
const current = () => S.sessions.find((c) => c.id === S.currentId) || null;
const project = (id) => S.projects.find((p) => p.id === id) || null;

// ---------- lưu ----------
let saveT = null;
const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => api('POST', '/api/code/sessions', { sessions: S.sessions }).catch(() => {}), 500); };
const putSess = (c) => { S.sessions = [c, ...S.sessions.filter((x) => x.id !== c.id)]; persist(); renderList(); };

// ---------- markdown gọn ----------
function md(src) {
  return String(src || '').split(/```/).map((b, i) => {
    if (i % 2) { const nl = b.indexOf('\n'); return `<pre><code>${esc(nl >= 0 ? b.slice(nl + 1) : b)}</code></pre>`; }
    let out = '', list = null, para = [];
    const inline = (t) => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const close = () => { if (list) { out += `</${list}>`; list = null; } };
    const flush = () => { if (para.length) { out += `<p>${para.map(inline).join('<br>')}</p>`; para = []; } };
    for (const l of b.split('\n')) {
      let m;
      if ((m = /^\s*[-*•]\s+(.*)$/.exec(l))) { flush(); if (list !== 'ul') { close(); out += '<ul>'; list = 'ul'; } out += `<li>${inline(m[1])}</li>`; }
      else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) { flush(); if (list !== 'ol') { close(); out += '<ol>'; list = 'ol'; } out += `<li>${inline(m[1])}</li>`; }
      else if ((m = /^#{1,4}\s+(.*)$/.exec(l))) { flush(); close(); out += `<h4>${inline(m[1])}</h4>`; }
      else if (!l.trim()) { flush(); close(); } else { close(); para.push(l); }
    }
    flush(); close(); return out;
  }).join('');
}

// ---------- diff ----------
function diffHtml(text) {
  let o = 0, n = 0; const rows = [];
  for (const l of String(text || '').split('\n')) {
    if (/^(---|\+\+\+) /.test(l)) continue;
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(l);
    if (h) { o = +h[1]; n = +h[2]; rows.push(`<div class="h">${esc(l)}</div>`); continue; }
    if (l.startsWith('+')) rows.push(`<div class="a"><i>${n++}</i>${esc(l)}</div>`);
    else if (l.startsWith('-')) rows.push(`<div class="d"><i>${o++}</i>${esc(l)}</div>`);
    else if (l.startsWith('… ')) rows.push(`<div class="h">${esc(l)}</div>`);
    else { rows.push(`<div><i>${n}</i>${esc(l)}</div>`); o++; n++; }
  }
  return `<div class="diff">${rows.join('')}</div>`;
}
const fileCard = (m, extra = '') => `<div class="fcard ${m.reverted ? 'reverted' : ''}"><div class="fh"><span>${m.isNew ? '🆕' : '✎'}</span><span class="fn" title="${esc(m.file)}">${esc(m.file)}</span><span class="add">+${m.added}</span><span class="del">−${m.removed}</span>${extra}</div>${diffHtml(m.diff)}</div>`;
const todoHtml = (todos, head) => `<ul class="todos">${head ? `<li class="hd">${esc(head)}</li>` : ''}${todos.map((t) => `<li class="${t.status}"><span class="c">${t.status === 'done' ? '☑' : t.status === 'doing' ? '▶' : '☐'}</span><span>${esc(t.content)}</span></li>`).join('')}</ul>`;

// ---------- tải ----------
async function loadWorkspaces() { try { const r = await api('GET', '/api/code/workspaces'); S.workspaces = r.workspaces || []; S.suggest = r.suggestions || []; } catch { S.workspaces = []; } if (S.wsId && !ws()) S.wsId = ''; }
async function loadTools() { try { S.tools = (await api('GET', '/api/code/tools')).tools || []; } catch { S.tools = []; } }
async function loadAccount() { try { S.account = await api('GET', '/api/ai/account'); } catch { S.account = { linked: false }; } renderAcct(); }
async function refreshLlm() { try { S.llm = await api('GET', '/api/ai/llm'); } catch { S.llm = null; } renderModelBtn(); return S.llm; }
async function loadContext() { if (!ws()) { S.ctx = null; return null; } try { S.ctx = await api('GET', '/api/code/context?ws=' + encodeURIComponent(S.wsId)); } catch { S.ctx = null; } renderHead(); return S.ctx; }
async function loadChanges() { if (!ws()) return (S.changes = null); try { S.changes = await api('GET', '/api/code/changes?ws=' + encodeURIComponent(S.wsId)); } catch { S.changes = null; } $('chgN').textContent = S.changes && S.changes.files && S.changes.files.length ? S.changes.files.length : ''; return S.changes; }

// ---------- rail ----------
function renderWs() {
  const w = ws();
  $('wsName').textContent = w ? '📂 ' + w.name : 'Chưa chọn thư mục';
  $('wsPath').textContent = w ? w.path : 'Bấm để chọn thư mục dự án'; $('wsPath').classList.toggle('path', !!w);
}
function renderList() {
  const list = S.sessions.filter((c) => !S.wsId || c.workspaceId === S.wsId);
  $('sessList').innerHTML = list.slice(0, 100).map((c) => `<li data-id="${esc(c.id)}" class="${c.id === S.currentId ? 'on' : ''}"><span class="ci" title="${esc(c.title)}">${esc(c.title)}</span><span class="ca"><button data-a="ren" title="Đổi tên">✎</button><button data-a="del" title="Xoá">✕</button></span></li>`).join('') || '<li class="empty">Chưa có phiên nào trong thư mục này</li>';
}
$('sessList').onclick = (e) => {
  const li = e.target.closest('li[data-id]'); if (!li || S.busy) return;
  const id = li.dataset.id; const a = e.target.closest('button')?.dataset.a; const c = S.sessions.find((x) => x.id === id);
  if (a === 'del') { if (!confirm(`Xoá phiên "${c.title}"?`)) return; S.sessions = S.sessions.filter((x) => x.id !== id); if (S.currentId === id) S.currentId = null; persist(); renderAll(); return; }
  if (a === 'ren') { const v = prompt('Tên phiên', c.title); if (v && v.trim()) { c.title = v.trim().slice(0, 120); persist(); renderAll(); } return; }
  S.currentId = id; renderAll(); if (S.panel === 'plan') renderPanel();
};
$('newSess').onclick = () => { if (S.busy) return; S.currentId = null; renderAll(); if (S.panel === 'plan') renderPanel(); $('input').focus(); };
$('wsBtn').onclick = () => openPicker();
function renderAcct() {
  const a = S.account;
  $('acct').innerHTML = a.linked ? `<div class="who"><span class="av">${esc(((a.me && a.me.name) || 'S').slice(0, 1).toUpperCase())}</span><span><b>${esc((a.me && a.me.name) || 'Tài khoản Socin')}</b><small><span class="dot ${a.online && !a.error ? 'on' : 'off'}"></span>${esc(a.me && a.me.tenant ? a.me.tenant : (a.baseUrl || '').replace(/^https?:\/\//, ''))}</small></span></div>`
    : `<div class="who"><span class="av">⌁</span><span><b>Đang dùng offline</b><small>Model trên máy · đăng nhập ở Trò chuyện</small></span></div>`;
}

// ---------- đầu trang ----------
function renderHead() {
  const c = current(); const w = ws();
  $('title').textContent = c ? c.title : 'Phiên lập trình mới';
  const g = S.ctx && S.ctx.git;
  $('crumb').innerHTML = w ? `📂 ${esc(w.name)}${g ? ` · <span class="mono">⎇ ${esc(g.branch)}</span>${g.status ? ` · ${g.status.split('\n').length} file đổi` : ''}` : ' · chưa là repo git'}${S.ctx && S.ctx.memory ? ` · đọc ${esc(S.ctx.memory.file)}` : ''}` : 'Socin Code';
  const todos = c ? c.todos || [] : [];
  $('todoN').textContent = todos.length ? `${todos.filter((t) => t.status === 'done').length}/${todos.length}` : '';
  const e = S.engine; const ai = S.account.ai;
  $('engine').textContent = e === 'socin' ? `AI Socin${ai ? ' · ' + (ai.provider_label || ai.provider) : ''}` : e === 'device' ? `Trên máy · ${S.llm ? S.llm.config.model : ''}` : e === 'rules' ? 'Không có model' : '';
  $('engine').hidden = !e;
}
function renderAll() {
  renderWs(); renderList(); renderHead();
  $('v-pick').hidden = !!ws(); $('v-code').hidden = !ws();
  if (!ws()) renderPickView(); else renderMsgs();
  document.querySelectorAll('#mode button').forEach((b) => b.classList.toggle('on', b.dataset.m === S.mode));
}

// ---------- tin nhắn ----------
const toolDef = (n) => S.tools.find((t) => t.name === n);
function opLabel(b) {
  const i = b.input || {};
  switch (b.name) {
    case 'read_file': return ['Đọc', i.path + (i.offset ? ` (từ dòng ${i.offset})` : '')];
    case 'list_files': return ['Liệt kê', (i.path || '.') + (i.pattern ? ' · ' + i.pattern : '')];
    case 'search': return ['Tìm', `"${i.pattern}"${i.path ? ' trong ' + i.path : ''}${i.glob ? ' · ' + i.glob : ''}`];
    case 'git_status': return ['Git', 'status'];
    case 'git_diff': return ['Git', 'diff' + (i.staged ? ' --staged' : '') + (i.path ? ' ' + i.path : '')];
    case 'git_log': return ['Git', 'log'];
    case 'edit_file': return ['Sửa', i.path];
    case 'write_file': return ['Ghi', i.path];
    default: return [(toolDef(b.name) || {}).title || b.name, JSON.stringify(i)];
  }
}
function toolHtml(b, r, sess) {
  const st = !r ? (S.busy ? 'run' : '') : r.is_error ? 'err' : 'ok';
  const out = r ? r.content.filter((x) => x.type === 'text').map((x) => x.text).join('\n') : '';
  const m = r && r.meta;
  if ((b.name === 'edit_file' || b.name === 'write_file') && m && m.kind === 'diff') {
    const rev = (sess.reverted || []).includes(m.snap);
    return fileCard({ ...m, reverted: rev }, rev ? '<span class="tag">Đã hoàn tác</span>' : `<button class="ghost sm" data-undo="${esc(m.snap)}" title="Trả file về như trước lần sửa này (và các lần sửa sau)">Hoàn tác</button>`);
  }
  if (b.name === 'run_command' || b.name === 'git_commit') {
    const cmd = b.name === 'run_command' ? (b.input || {}).command : `git commit -m "${(b.input || {}).message || ''}"`;
    const body = out.replace(/^\$ [^\n]*\n/, '').replace(/\n\[(mã thoát|dừng)[^\]]*\]$/, '');
    const ec = m && m.kind === 'term' ? (m.killed ? `<span class="ec bad">dừng</span>` : `<span class="ec ${m.code ? 'bad' : ''}">mã ${m.code} · ${(m.ms / 1000).toFixed(1)}s</span>`) : st === 'run' ? '<span class="ec">đang chạy…</span>' : r && r.is_error ? '<span class="ec bad">lỗi</span>' : '';
    return `<div class="term"><div class="th"><span>$</span><code>${esc(cmd)}</code>${ec}</div>${r ? `<pre>${esc(body || '(không có output)')}</pre>` : ''}</div>`;
  }
  if (b.name === 'todo_write') return todoHtml(K.cleanTodos((b.input || {}).todos), 'Kế hoạch');
  const [verb, arg] = opLabel(b);
  return `<details class="opx"><summary class="op ${st}"><span class="dot"></span><b>${esc(verb)}</b><code>${esc(arg)}</code></summary>${out ? `<div class="opout">${esc(out)}</div>` : ''}</details>`;
}
function helloHtml() {
  const w = ws(); const c = S.ctx;
  const starters = [
    ['/explain', 'Giải thích dự án', 'Cấu trúc, luồng chạy, file quan trọng'],
    ['/init', 'Tạo SOCIN.md', 'Ghi nhớ lệnh build/test, quy ước cho agent'],
    ['/review', 'Review thay đổi', 'Đọc git diff, tìm lỗi trước khi commit'],
    ['/test', 'Chạy test và sửa', 'Chạy test, đọc lỗi, sửa đến khi qua'],
  ];
  return `<div class="hello"><h2>Hôm nay mình code gì trong ${esc(w.name)}?</h2>
    <p class="mut">Socin Code đọc mã, sửa file, chạy lệnh và dùng git ngay trong thư mục này. Mỗi lần sửa có diff để xem và nút hoàn tác; sửa file, chạy lệnh đều hỏi bạn trước (đổi ở ô chế độ dưới khung nhập).</p>
    <div class="starters">${starters.map((s) => `<button class="starter" data-q="${esc(s[0])}"><b>${esc(s[1])}</b><span>${esc(s[2])}</span></button>`).join('')}</div>
    <div class="tips"><div><code>@src/app.js</code> chèn nội dung file vào câu hỏi</div><div><code>!npm test</code> chạy lệnh ngay, không cần model</div><div><b>Kế hoạch</b>: agent chỉ đọc và đề xuất, chưa sửa gì</div><div>${c && c.memory ? `Đang đọc <code>${esc(c.memory.file)}</code> làm ghi nhớ dự án` : 'Chưa có <code>SOCIN.md</code>: gõ <code>/init</code> để tạo'}</div></div></div>`;
}
function renderMsgs() {
  const c = current(); const box = $('msgs');
  if (!c || !c.messages.length) {
    box.innerHTML = helloHtml();
    box.querySelectorAll('.starter').forEach((b) => { b.onclick = () => send(b.dataset.q); });
    return;
  }
  const results = new Map();
  for (const m of c.messages) if (m.role === 'user') for (const b of m.content) if (b.type === 'tool_result') results.set(b.tool_use_id, b);
  let html = '';
  for (const m of c.messages) {
    if (m.role === 'user') {
      const parts = m.content.filter((b) => b.type === 'text');
      if (!parts.length) continue;
      html += `<div class="msg-user">${parts.map((b) => esc(b.shown || b.text)).join('\n')}</div>`;
      continue;
    }
    html += '<div class="msg-ai">';
    for (const b of m.content) {
      if (b.type === 'text') html += `<div class="md">${md(b.text)}</div>`;
      else if (b.type === 'tool_use') html += toolHtml(b, results.get(b.id), c);
    }
    html += '</div>';
  }
  if (S.busy) html += `<div class="thinking">${S.running ? esc(S.running) : 'Socin Code đang nghĩ…'}</div>`;
  box.innerHTML = html;
  box.querySelectorAll('[data-undo]').forEach((el) => { el.onclick = () => undo(el.dataset.undo); });
  const sc = $('scroll'); sc.scrollTop = sc.scrollHeight;
}
async function undo(snap) {
  const c = current(); if (!c || S.busy) return;
  try {
    const r = await api('POST', '/api/code/undo', { session: c.id, snap });
    c.reverted = [...new Set([...(c.reverted || []), ...(r.reverted || [])])];
    c.messages = [...c.messages, { role: 'user', content: [{ type: 'text', text: `[Người dùng đã hoàn tác thay đổi ở: ${r.files.join(', ')}. Nội dung các file này đã trở về như trước.]`, shown: `↩ Đã hoàn tác: ${r.files.join(', ')}` }] }];
    putSess({ ...c }); renderMsgs(); loadChanges().then(() => { if (S.panel === 'changes') renderPanel(); });
  } catch (e) { alert(e.message); }
}

// ---------- quyền ----------
const always = new Map(); // phiên → Set('edit' | 'cmd:npm test' | 'git_commit')
let answer = null;
async function askPermission(def, input) {
  const pv = await api('POST', '/api/code/preview', { name: def.name, input, ws: S.wsId }).catch((e) => ({ ok: false, error: e.message }));
  if (pv && pv.ok === false) return { v: 'error', error: pv.error };
  return new Promise((resolve) => {
    answer = resolve;
    let what = '', body = '', alwaysBtn = '';
    if (pv.kind === 'diff') { what = pv.isNew ? `tạo file ${pv.file}` : `sửa ${pv.file}`; body = fileCard(pv); alwaysBtn = '<button class="ghost sm" data-v="always">Cho phép, tự sửa file trong phiên này</button>'; }
    else if (pv.kind === 'term') { what = 'chạy lệnh'; body = `<div class="term"><div class="th"><span>$</span><code>${esc(pv.command)}</code></div></div>`; alwaysBtn = `<button class="ghost sm" data-v="always">Luôn cho phép <code>${esc(K.commandKey(pv.command))}</code></button>`; }
    else if (pv.kind === 'commit') { what = 'tạo commit'; body = `<div class="term"><div class="th"><span>$</span><code>git commit -m "${esc(pv.message)}"</code></div>${pv.status ? `<pre>${esc(pv.status)}</pre>` : ''}</div>`; }
    else { what = def.title || def.name; }
    $('ask').hidden = false;
    $('ask').innerHTML = `<b>Socin Code muốn ${esc(what)}</b>${body}
      <div class="row"><button class="cta sm" data-v="once">Cho phép</button>${alwaysBtn}<button class="ghost sm" data-v="deny">Từ chối</button><input id="askWhy" placeholder="hoặc bảo agent làm khác…" style="flex:1;min-width:160px;padding:5px 8px;font-size:12.5px"></div>`;
    const done = (v) => { $('ask').hidden = true; const f = answer; answer = null; f && f({ v, why: ($('askWhy') || {}).value || '' }); };
    $('ask').querySelectorAll('button[data-v]').forEach((b) => { b.onclick = () => done(b.dataset.v); });
    $('askWhy').onkeydown = (e) => { if (e.key === 'Enter') done('deny'); };
    $('ask').scrollTop = 0;
  });
}
async function runTool(sessId, name, input) {
  const def = toolDef(name);
  if (!def) return { text: `Không có lệnh "${name}"`, isError: true };
  if (!K.allowed(S.mode, def.access)) return { text: `Đang ở chế độ "Kế hoạch": chỉ đọc mã. Trình bày kế hoạch để người dùng duyệt (họ sẽ chuyển sang "Hỏi trước" hoặc "Tự sửa file").`, isError: true };
  let confirmed = false;
  if (name === 'todo_write') { const c = S.sessions.find((x) => x.id === sessId); if (c) { c.todos = K.cleanTodos(input.todos); renderHead(); if (S.panel === 'plan') renderPanel(); } }
  else if (K.needsAsk(S.mode, def.access, input)) {
    const set = always.get(sessId) || new Set();
    const key = def.access === 'edit' ? 'edit' : name === 'run_command' ? 'cmd:' + K.commandKey(input.command) : name;
    if (set.has(key)) confirmed = true;
    else {
      const a = await askPermission(def, input);
      if (a.v === 'error') return { text: a.error, isError: true };
      if (a.v === 'deny') return { text: 'Người dùng đã từ chối.' + (a.why ? ` Họ nói: "${a.why}"` : ' Dừng lại và hỏi người dùng muốn làm thế nào.'), isError: true };
      if (a.v === 'always' && name !== 'git_commit') { set.add(key); always.set(sessId, set); }
      confirmed = true;
    }
  }
  S.running = name === 'run_command' ? `Đang chạy: ${input.command}` : `${def.title}…`; renderMsgs();
  try {
    const r = await api('POST', '/api/code/call', { name, input, ws: S.wsId, session: sessId, mode: S.mode, confirmed });
    if (def.access !== 'read') loadChanges().then(() => { if (S.panel === 'changes') renderPanel(); });
    return r;
  } finally { S.running = null; }
}

// ---------- gửi ----------
let abort = false;
const strip = (messages) => messages.map((m) => ({ role: m.role, content: m.content.map((b) => { if (b.type === 'tool_result') { const { meta, ...x } = b; return x; } if (b.type === 'text' && b.shown) return { type: 'text', text: b.text }; return b; }) }));
async function expandMentions(q) {
  const names = [...new Set([...S.mentions, ...[...q.matchAll(/(?:^|\s)@([\w./-]+)/g)].map((m) => m[1])])];
  const blocks = [];
  for (const f of names.slice(0, 6)) {
    try { const r = await api('GET', `/api/code/file?ws=${encodeURIComponent(S.wsId)}&path=${encodeURIComponent(f)}`); if (r.text !== undefined) blocks.push(`<file path="${r.path}">\n${r.text.slice(0, 20000)}\n</file>`); } catch {}
  }
  return blocks.join('\n');
}
async function send(text) {
  let q = String(text ?? $('input').value).trim();
  if (!q || S.busy || !ws()) return;
  const slash = /^\/(\w+)\s*([\s\S]*)$/.exec(q); const sc = slash && K.SLASH.find((s) => s.name === slash[1]);
  if (sc && sc.name === 'clear') { $('input').value = ''; $('newSess').onclick(); return; }
  if (sc && sc.name === 'diff') { $('input').value = ''; openPanel('changes'); return; }
  const shown = q;
  if (sc && sc.prompt) q = sc.prompt + (slash[2] ? `\nYêu cầu thêm: ${slash[2]}` : '');
  const files = await expandMentions(q);
  $('input').value = ''; S.mentions = []; renderMentions(); autosize(); closeSlash();
  abort = false;
  let sess = current();
  if (!sess) { sess = { id: 'k' + Date.now().toString(36), title: A.titleFrom(sc ? sc.title : shown), updatedAt: Date.now(), workspaceId: S.wsId, todos: [], messages: [] }; S.currentId = sess.id; }
  const content = [{ type: 'text', text: files ? `${q}\n\n${files}` : q, ...(files || sc ? { shown } : {}) }];
  const sessId = sess.id; const base = sess;
  putSess({ ...sess, updatedAt: Date.now(), messages: A.appendUser(sess.messages, content) });
  S.busy = true; setBusy(); renderAll();
  try {
    await loadTools();
    const visible = S.tools.filter((d) => K.allowed(S.mode, d.access));
    const apiTools = visible.map((d) => ({ name: d.name, description: d.description, input_schema: d.inputSchema }));
    const ctxRaw = await loadContext();
    const p = project((ws() || {}).projectId);
    const ctxText = () => K.contextText({ ...(ctxRaw || {}), project: p, todos: (S.sessions.find((x) => x.id === sessId) || {}).todos }) + (S.mode === 'plan' ? '\nCHẾ ĐỘ KẾ HOẠCH: chỉ đọc mã, cuối cùng trình bày kế hoạch từng bước để người dùng duyệt; chưa sửa file, chưa chạy lệnh.' : '');
    const llm = await refreshLlm(); const pref = llm ? llm.config.mode : 'auto';
    const socin = S.account.linked && pref !== 'local' ? async (messages) => {
      const r = await api('POST', '/api/ai/socin', { messages: A.trimHistory(strip(messages)), tools: apiTools, context: K.socinContext(ctxText()) });
      return r.ok ? { ok: true, content: r.content } : { ok: false, fallback: !!r.fallback, error: r.error || 'lỗi' };
    } : null;
    const device = llm && llm.ready && pref !== 'socin' ? async (messages) => {
      const r = await api('POST', '/api/ai/llm/chat', { messages: strip(messages), tools: apiTools, context: ctxText(), profile: 'code' });
      return r.ok ? { ok: true, content: r.content } : { ok: false, fallback: false, error: r.error };
    } : null;
    let onDevice = !socin;
    const model = socin || device ? async (messages) => {
      if (!onDevice && socin) { const r = await socin(messages); if (r.ok) { S.engine = 'socin'; renderHead(); return r; } if (!r.fallback || !device) return r; onDevice = true; }
      S.engine = 'device'; renderHead(); return device(messages);
    } : null;
    const isLocal = !model || q.startsWith('!');
    const res = await A.runTurn(current() ? current().messages : [], {
      model: q.startsWith('!') ? null : model, maxSteps: 40,
      localCtx: { toolNames: visible.map((d) => d.name), parseArgs: A.parseArgs },
      runTool: (name, input) => runTool(sessId, name, input),
      onUpdate: (messages) => { const c = S.sessions.find((x) => x.id === sessId) || base; S.sessions = [{ ...c, updatedAt: Date.now(), messages }, ...S.sessions.filter((x) => x.id !== sessId)]; persist(); if (S.currentId === sessId) renderMsgs(); },
      aborted: () => abort,
    });
    if (res.source === 'local' && isLocal) S.engine = 'rules';
    // bộ hiểu lệnh tự thêm "Xong." sau "!lệnh": bỏ đi cho gọn
    const c = S.sessions.find((x) => x.id === sessId);
    if (res.source === 'local' && c) { const last = c.messages[c.messages.length - 1]; if (last && last.role === 'assistant' && last.content.length === 1 && /^(Xong\.|Có \d+ lệnh)/.test(last.content[0].text || '')) { c.messages = c.messages.slice(0, -1); persist(); } }
  } catch (e) {
    const c = current(); if (c) putSess({ ...c, messages: [...c.messages, { role: 'assistant', content: [{ type: 'text', text: 'Lỗi: ' + e.message }] }] });
  } finally { S.busy = false; S.running = null; setBusy(); renderAll(); loadContext(); loadChanges().then(() => { if (S.panel) renderPanel(); }); }
}
function setBusy() { $('send').textContent = S.busy ? 'Dừng' : 'Gửi'; $('send').className = S.busy ? 'ghost' : 'cta'; }
function stop() { abort = true; const c = current(); if (c) api('POST', '/api/code/kill', { session: c.id }).catch(() => {}); if (answer) { const f = answer; answer = null; $('ask').hidden = true; f({ v: 'deny', why: '' }); } }
$('send').onclick = () => (S.busy ? stop() : send());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.busy && $('slash').hidden) stop(); });

// ---------- ô nhập: "/", "@" ----------
const input = $('input');
function autosize() { input.style.height = 'auto'; input.style.height = Math.min(240, input.scrollHeight) + 'px'; }
let slashSel = 0, hits = [], hitKind = '';
async function openSlash() {
  const v = input.value; const at = /(?:^|\s)@([\w./-]*)$/.exec(v.slice(0, input.selectionStart));
  if (at && ws()) {
    const r = await api('GET', `/api/code/files?ws=${encodeURIComponent(S.wsId)}&q=${encodeURIComponent(at[1])}`).catch(() => ({ files: [] }));
    hits = (r.files || []).slice(0, 12).map((f) => ({ name: f, title: '' })); hitKind = '@';
  } else {
    const m = /^\/([\w-]*)$/.exec(v.trim()); if (!m) return closeSlash();
    const k = A.norm(m[1]);
    hits = [...K.SLASH.map((s) => ({ name: s.name, title: s.title, grp: 'Lệnh nhanh' })), ...S.tools.map((t) => ({ name: t.name, title: t.title, grp: 'Gọi trực tiếp' }))].filter((t) => !k || A.norm(t.name + ' ' + t.title).includes(k)); hitKind = '/';
  }
  if (!hits.length) return closeSlash();
  slashSel = Math.min(slashSel, hits.length - 1); let g = ''; let html = '';
  hits.forEach((t, i) => { if (t.grp && t.grp !== g) { g = t.grp; html += `<li class="grp">${esc(g)}</li>`; } html += `<li data-i="${i}" class="${i === slashSel ? 'on' : ''}"><code>${hitKind === '@' ? '@' : '/'}${esc(t.name)}</code><span>${esc(t.title)}</span></li>`; });
  $('slash').innerHTML = html; $('slash').hidden = false;
  $('slash').querySelectorAll('li[data-i]').forEach((li) => { li.onmousedown = (e) => { e.preventDefault(); pick(+li.dataset.i); }; });
}
function closeSlash() { $('slash').hidden = true; hits = []; }
function pick(i) {
  const t = hits[i]; if (!t) return;
  if (hitKind === '@') { const pos = input.selectionStart; const before = input.value.slice(0, pos).replace(/@([\w./-]*)$/, ''); input.value = before + input.value.slice(pos); if (!S.mentions.includes(t.name)) S.mentions.push(t.name); renderMentions(); }
  else input.value = '/' + t.name + ' ';
  closeSlash(); input.focus(); autosize();
}
function renderMentions() { $('mentions').innerHTML = S.mentions.map((f, i) => `<span>@${esc(f)}<b data-i="${i}">✕</b></span>`).join(''); $('mentions').querySelectorAll('b').forEach((b) => { b.onclick = () => { S.mentions.splice(+b.dataset.i, 1); renderMentions(); }; }); }
input.addEventListener('input', () => { autosize(); slashSel = 0; openSlash(); });
input.addEventListener('keydown', (e) => {
  if (!$('slash').hidden) {
    if (e.key === 'ArrowDown') { slashSel = Math.min(slashSel + 1, hits.length - 1); openSlash(); e.preventDefault(); return; }
    if (e.key === 'ArrowUp') { slashSel = Math.max(slashSel - 1, 0); openSlash(); e.preventDefault(); return; }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { pick(slashSel); e.preventDefault(); return; }
    if (e.key === 'Escape') { closeSlash(); e.stopPropagation(); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});
document.querySelectorAll('#mode button').forEach((b) => { b.onclick = () => { S.mode = b.dataset.m; store.set('scode.mode', S.mode); renderAll(); }; });

// ---------- Model ----------
function renderModelBtn() { $('modelBtn').textContent = 'Model: ' + MODE_LABEL[S.llm ? S.llm.config.mode : 'auto']; }
$('modelBtn').onclick = async () => {
  const pop = $('modelPop'); if (!pop.hidden) { pop.hidden = true; return; }
  const l = await refreshLlm(); pop.hidden = false;
  if (!l) { pop.innerHTML = '<p class="mut">Không đọc được trạng thái model.</p>'; return; }
  const ai = S.account.ai;
  pop.innerHTML = `<h4>Model cho Socin Code</h4><div class="modes">${['auto', 'socin', 'local'].map((m) => `<div class="opt ${l.config.mode === m ? 'on' : ''}" data-m="${m}"><b>${MODE_LABEL[m]}</b><span>${m === 'auto' ? 'AI Socin khi có mạng, mất mạng dùng model trên máy' : m === 'socin' ? 'Chỉ AI Socin (Claude/GPT/Gemini do admin cài)' : 'Chỉ chạy trên máy, mã không rời máy'}</span></div>`).join('')}</div>
    <div class="sm">AI Socin: ${S.account.linked ? (ai && ai.enabled ? `${esc(ai.provider_label || ai.provider)} · ${esc(ai.model)}` : 'doanh nghiệp chưa bật AI') : 'chưa đăng nhập (đăng nhập ở màn Trò chuyện)'}</div>
    <div class="sm">Trên máy: ${l.ready ? `<span class="tag ok">Sẵn sàng</span> ${esc(l.config.model)}` : l.installed ? `chưa có model ${esc(l.config.model)}` : 'chưa cài Ollama'} · <a href="/#model">Cài đặt model</a></div>
    <div class="sm mut">Lập trình nhiều bước cần model mạnh: nên dùng AI Socin (Claude). Model 4B trên máy hợp với việc nhỏ, đọc và giải thích mã.</div>`;
  pop.querySelectorAll('[data-m]').forEach((el) => { el.onclick = async () => { S.llm = await api('POST', '/api/ai/llm/config', { mode: el.dataset.m }); renderModelBtn(); $('modelPop').hidden = true; }; });
};
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#modelPop,#modelBtn')) $('modelPop').hidden = true; });

// ---------- khung bên ----------
document.querySelectorAll('#panelTabs button').forEach((b) => { b.onclick = () => (S.panel === b.dataset.p && !$('side').hidden ? closePanel() : openPanel(b.dataset.p)); });
$('sideClose').onclick = () => closePanel();
$('sideRefresh').onclick = () => openPanel(S.panel);
function closePanel() { $('side').hidden = true; S.panel = null; document.querySelectorAll('#panelTabs button').forEach((x) => x.classList.remove('on')); }
async function openPanel(p) {
  if (!ws()) return;
  S.panel = p; $('side').hidden = false;
  document.querySelectorAll('#panelTabs button').forEach((x) => x.classList.toggle('on', x.dataset.p === p));
  if (p === 'changes') await loadChanges();
  if (p === 'context') await loadContext();
  renderPanel();
}
let fileQ = '';
async function renderPanel() {
  const body = $('sideBody'); const p = S.panel; if (!p) return;
  $('sideTitle').textContent = { changes: 'Thay đổi chưa commit', plan: 'Kế hoạch', files: 'File trong dự án', context: 'Ngữ cảnh gửi cho agent' }[p];
  if (p === 'changes') {
    const ch = S.changes;
    if (!ch) { body.innerHTML = '<p class="mut">Không đọc được.</p>'; return; }
    if (!ch.repo) { body.innerHTML = '<p class="mut">Thư mục này chưa là repo git. Gõ <code>!git init</code> để bắt đầu theo dõi thay đổi.</p>'; return; }
    const parts = String(ch.diff || '').split(/^diff --git /m).filter(Boolean);
    body.innerHTML = `<div class="sm mut">Nhánh <b class="mono">${esc(ch.branch)}</b> · ${ch.files.length} file</div>
      <ul class="flist">${ch.files.map((f) => `<li data-f="${esc(f.file)}"><span class="st">${esc(f.code.trim() || '?')}</span>${esc(f.file)}</li>`).join('') || '<li class="mut">Không có thay đổi.</li>'}</ul>
      ${parts.map((d) => { const name = (/ b\/(.+)\n/.exec(d) || [])[1] || ''; const add = (d.match(/^\+(?!\+\+)/gm) || []).length, del = (d.match(/^-(?!--)/gm) || []).length; return `<div class="fcard"><div class="fh"><span class="fn">${esc(name)}</span><span class="add">+${add}</span><span class="del">−${del}</span></div>${diffHtml(d.slice(d.indexOf('\n@@') + 1))}</div>`; }).join('')}
      ${ch.files.length ? '<div class="row"><button class="ghost sm" id="pcReview">Nhờ agent review</button><button class="ghost sm" id="pcCommit">Nhờ agent tạo commit</button></div>' : ''}`;
    const rv = $('pcReview'); if (rv) rv.onclick = () => send('/review');
    const cm = $('pcCommit'); if (cm) cm.onclick = () => send('/commit');
    body.querySelectorAll('[data-f]').forEach((li) => { li.onclick = () => { S.panel = 'files'; showFile(li.dataset.f); }; });
  } else if (p === 'plan') {
    const c = current(); const t = c ? c.todos || [] : [];
    body.innerHTML = t.length ? todoHtml(t) + `<div class="sm mut">${t.filter((x) => x.status === 'done').length}/${t.length} việc xong. Agent tự cập nhật khi làm.</div>` : '<p class="mut">Chưa có kế hoạch. Việc nhiều bước, agent sẽ tự ghi kế hoạch ở đây. Muốn duyệt trước khi sửa, chọn chế độ <b>Kế hoạch</b>.</p>';
  } else if (p === 'files') {
    const r = await api('GET', `/api/code/files?ws=${encodeURIComponent(S.wsId)}&q=${encodeURIComponent(fileQ)}`).catch(() => ({ files: [] }));
    body.innerHTML = `<input id="fq" placeholder="Tìm file" value="${esc(fileQ)}"><ul class="flist">${(r.files || []).map((f) => `<li data-f="${esc(f)}">${esc(f)}</li>`).join('') || '<li class="mut">Không có.</li>'}</ul>`;
    const fq = $('fq'); fq.oninput = () => { fileQ = fq.value; clearTimeout(fq.t); fq.t = setTimeout(async () => { await renderPanel(); const n = $('fq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 200); };
    body.querySelectorAll('[data-f]').forEach((li) => { li.onclick = () => showFile(li.dataset.f); });
  } else if (p === 'context') {
    const c = S.ctx; const w = ws();
    const txt = c ? K.contextText({ ...c, project: project(w.projectId), todos: (current() || {}).todos }) : '';
    body.innerHTML = `<label class="mut sm">Gắn với dự án Studio (hướng dẫn + tài liệu của dự án đi kèm mỗi lượt)</label><select id="ctxProj"><option value="">Không gắn</option>${S.projects.map((x) => `<option value="${esc(x.id)}" ${x.id === w.projectId ? 'selected' : ''}>${esc(x.icon + ' ' + x.name)}</option>`).join('')}</select>
      <div class="sm mut">Agent nhận kèm mỗi lượt (${txt.length} ký tự):</div><pre class="viewer" style="white-space:pre-wrap">${esc(txt)}</pre>
      <div class="sm mut">Ghi nhớ dự án: ${c && c.memory ? `<b>${esc(c.memory.file)}</b>` : 'chưa có SOCIN.md (gõ /init để agent tạo)'} · ${S.tools.length} lệnh agent dùng được.</div>
      <div class="row"><button class="ghost sm" id="ctxRm">Gỡ thư mục khỏi Socin Code</button></div>`;
    $('ctxProj').onchange = async (e) => { w.projectId = e.target.value || ''; await api('POST', '/api/code/workspaces/update', { id: w.id, projectId: w.projectId }).catch(() => {}); renderPanel(); };
    $('ctxRm').onclick = async () => { if (!confirm(`Gỡ ${w.name} khỏi danh sách? (Không xoá file nào trên máy.)`)) return; await api('POST', '/api/code/workspaces/remove', { id: w.id }); S.wsId = ''; store.set('scode.ws', ''); closePanel(); await loadWorkspaces(); renderAll(); };
  }
}
async function showFile(f) {
  const body = $('sideBody'); $('sideTitle').textContent = f;
  try { const r = await api('GET', `/api/code/file?ws=${encodeURIComponent(S.wsId)}&path=${encodeURIComponent(f)}`); body.innerHTML = `<div class="row"><button class="ghost sm" id="fvBack">← Danh sách</button><button class="ghost sm" id="fvAt">Chèn @${esc(f)} vào câu hỏi</button></div><pre class="viewer">${esc(r.text).split('\n').map((l, i) => `<span class="mut">${String(i + 1).padStart(4)}  </span>${l}`).join('\n')}</pre>`; }
  catch (e) { body.innerHTML = `<div class="row"><button class="ghost sm" id="fvBack">← Danh sách</button></div><p class="err">${esc(e.message)}</p>`; }
  $('fvBack').onclick = () => { S.panel = 'files'; renderPanel(); };
  const at = $('fvAt'); if (at) at.onclick = () => { if (!S.mentions.includes(f)) S.mentions.push(f); renderMentions(); input.focus(); };
}

// ---------- chọn thư mục ----------
function renderPickView() {
  const sug = S.suggest || [];
  $('v-pick').innerHTML = `<div class="pick"><h2>Mở một thư mục dự án để bắt đầu</h2>
    <p class="mut">Socin Code làm việc như một lập trình viên ngồi cạnh bạn: đọc mã, sửa file, chạy test, dùng git. Mọi thao tác chỉ trong thư mục bạn chọn, sửa và chạy lệnh đều hỏi trước.</p>
    <div class="row"><button class="cta" id="pvPick">Chọn thư mục…</button><button class="ghost" id="pvClone">Clone repo GitHub…</button></div>
    ${S.workspaces.length ? `<h2 class="mut" style="font-size:13px">Đã mở trước đây</h2><div class="cards">${S.workspaces.map((w) => `<div class="pcard" data-w="${esc(w.id)}" style="cursor:pointer"><div class="hd"><span class="ic">📂</span><b>${esc(w.name)}</b></div><p class="mono" style="font-size:11.5px;word-break:break-all">${esc(w.path)}</p>${w.exists === false ? '<span class="tag warn">Không còn trên máy</span>' : ''}</div>`).join('')}</div>` : ''}
    ${sug.length ? `<h2 class="mut" style="font-size:13px">Gợi ý trên máy này</h2><div class="cards">${sug.slice(0, 9).map((s) => `<div class="pcard" data-s="${esc(s.path)}" style="cursor:pointer"><b>${esc(s.path.split(/[\\/]/).pop())}</b><p class="mono" style="font-size:11.5px;word-break:break-all">${esc(s.path)}</p><span class="tag">${esc(s.why)}</span></div>`).join('')}</div>` : ''}</div>`;
  $('pvPick').onclick = () => openPicker();
  $('pvClone').onclick = () => openPicker(true);
  $('v-pick').querySelectorAll('[data-w]').forEach((el) => { el.onclick = () => useWs(el.dataset.w); });
  $('v-pick').querySelectorAll('[data-s]').forEach((el) => { el.onclick = () => addWs(el.dataset.s); });
}
async function useWs(id) { S.wsId = id; store.set('scode.ws', id); S.currentId = (S.sessions.find((c) => c.workspaceId === id) || {}).id || null; S.engine = null; renderAll(); await Promise.all([loadContext(), loadChanges()]); renderAll(); if (S.panel) openPanel(S.panel); }
async function addWs(p) { try { const r = await api('POST', '/api/code/workspaces', { path: p }); if (r.error) throw new Error(r.error); await loadWorkspaces(); $('pickDlg').close(); await useWs(r.workspace.id); } catch (e) { $('pkErr').textContent = e.message; if (!$('pickDlg').open) alert(e.message); } }
let pkPath = '';
async function browseTo(p) {
  try {
    const r = await api('GET', '/api/code/browse?path=' + encodeURIComponent(p || ''));
    pkPath = r.path; $('pkPath').value = r.path; $('pkErr').textContent = '';
    $('pkList').innerHTML = `<div class="cur">${esc(r.path)}${r.isRepo ? ' · repo git' : ''}</div>${r.parent ? `<div class="it" data-d="${esc(r.parent)}">⬆︎ ..</div>` : ''}${r.dirs.map((d) => `<div class="it" data-d="${esc(r.path.replace(/[\\/]$/, '') + '/' + d)}">📁 ${esc(d)}</div>`).join('') || '<div class="it mut">Không có thư mục con</div>'}`;
    $('pkList').querySelectorAll('[data-d]').forEach((el) => { el.onclick = () => browseTo(el.dataset.d); });
  } catch (e) { $('pkErr').textContent = e.message; }
}
async function openPicker(clone) {
  $('pkErr').textContent = ''; $('pickDlg').showModal();
  await browseTo(ws() ? ws().path : '~');
  const d = $('pickDlg').querySelector('details'); d.open = !!clone;
  if (clone) {
    $('pkRepos').textContent = 'Đang tải repo của bạn…';
    const r = await api('GET', '/api/repos').catch(() => ({ repos: [] }));
    $('pkRepos').innerHTML = (r.repos || []).slice(0, 30).map((x) => `<a href="#" data-u="${esc(x.url)}">${esc(x.name)}</a>`).join(' · ') || 'Chưa đọc được repo GitHub (cài token ở S GitHub), dán địa chỉ ở trên.';
    $('pkRepos').querySelectorAll('[data-u]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); $('pkUrl').value = a.dataset.u; }; });
  }
}
$('pkGo').onclick = () => browseTo($('pkPath').value);
$('pkPath').onkeydown = (e) => { if (e.key === 'Enter') browseTo($('pkPath').value); };
$('pkUse').onclick = () => addWs($('pkPath').value || pkPath);
$('pkCancel').onclick = () => $('pickDlg').close();
$('pkClone').onclick = async () => {
  const u = $('pkUrl').value.trim(); if (!u) return;
  $('pkClone').textContent = 'Đang clone…'; $('pkClone').disabled = true;
  try { const r = await api('POST', '/api/code/clone', { url: u }); if (r.error) throw new Error(r.error); await loadWorkspaces(); $('pickDlg').close(); await useWs(r.workspace.id); }
  catch (e) { $('pkErr').textContent = e.message; } finally { $('pkClone').textContent = 'Clone'; $('pkClone').disabled = false; }
};

// ---------- khởi động ----------
(async () => {
  renderModelBtn();
  const [s, p] = await Promise.all([api('GET', '/api/code/sessions').catch(() => ({ sessions: [] })), api('GET', '/api/ai/projects').catch(() => ({ projects: [] })), loadWorkspaces(), loadTools()]);
  S.sessions = s.sessions || []; S.projects = p.projects || [];
  if (ws()) { S.currentId = (S.sessions.find((c) => c.workspaceId === S.wsId) || {}).id || null; }
  renderAll();
  await Promise.all([loadAccount(), refreshLlm(), loadContext(), loadChanges()]);
  renderAll();
  const h = location.hash.slice(1); if (['changes', 'plan', 'files', 'context'].includes(h)) openPanel(h);
})();
})();
