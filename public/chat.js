// Socin Studio: màn chính của S Hub. Trò chuyện với trợ lý Socin AI, quản lý luồng hội thoại, dự án (ngữ cảnh), plugin/MCP.
// Vòng lặp chat chạy ở trình duyệt (AICore.runTurn), model và lệnh gọi qua server S Hub (/api/ai/*).
(() => {
'use strict';
const A = window.AICore;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (method, p, data) => { const r = await fetch(p, { method, headers: { 'content-type': 'application/json' }, body: data ? JSON.stringify(data) : undefined }); let j = {}; try { j = await r.json(); } catch {} if (!r.ok && !('ok' in j)) throw new Error(j.error || 'HTTP ' + r.status); return j; };
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

const S = { chats: [], currentId: null, projects: [], projectId: store.get('sc.project', null), busy: false, running: null, mode: store.get('sc.mode', 'edit'), llm: null, account: { linked: false }, tools: [], apps: [], images: [], view: 'chat', engine: null, filter: '' };
const MODE_LABEL = { auto: 'Tự động', socin: 'AI Socin', local: 'Trên máy' };
const FIRST_ARG = { open_app: 'id', run_tests: 'repo', vps_status: 'server', vps_logs: 'server', vps_backup: 'server', remote_connect: 'target', list_repos: 'q', files_list: 'q', creator_projects: 'q', test_reports: 'repo' };
const current = () => S.chats.find((c) => c.id === S.currentId) || null;
const project = (id) => S.projects.find((p) => p.id === id) || null;

// ---------- lưu ----------
let saveT = null;
function persist() { clearTimeout(saveT); saveT = setTimeout(() => api('POST', '/api/ai/chats', { chats: S.chats }).catch(() => {}), 600); }
function putChat(c) { S.chats = [c, ...S.chats.filter((x) => x.id !== c.id)]; persist(); renderList(); }
const saveProjects = () => api('POST', '/api/ai/projects', { projects: S.projects }).then((r) => { S.projects = r.projects; }).catch(() => {});

// ---------- markdown gọn, an toàn ----------
function md(src) {
  const blocks = String(src || '').split(/```/);
  return blocks.map((b, i) => {
    if (i % 2) { const nl = b.indexOf('\n'); return `<pre><code>${esc(nl >= 0 ? b.slice(nl + 1) : b)}</code></pre>`; }
    const lines = b.split('\n'); let out = '', list = null;
    const inline = (t) => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const close = () => { if (list) { out += `</${list}>`; list = null; } };
    let para = [];
    const flush = () => { if (para.length) { out += `<p>${para.map(inline).join('<br>')}</p>`; para = []; } };
    for (const l of lines) {
      let m;
      if ((m = /^\s*[-*•]\s+(.*)$/.exec(l))) { flush(); if (list !== 'ul') { close(); out += '<ul>'; list = 'ul'; } out += `<li>${inline(m[1])}</li>`; }
      else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) { flush(); if (list !== 'ol') { close(); out += '<ol>'; list = 'ol'; } out += `<li>${inline(m[1])}</li>`; }
      else if ((m = /^#{1,4}\s+(.*)$/.exec(l))) { flush(); close(); out += `<h4>${inline(m[1])}</h4>`; }
      else if (!l.trim()) { flush(); close(); }
      else { close(); para.push(l); }
    }
    flush(); close(); return out;
  }).join('');
}

// ---------- tải dữ liệu ----------
async function loadTools() { try { S.tools = (await api('GET', '/api/ai/tools')).tools || []; } catch { S.tools = []; } }
async function loadApps() { try { S.apps = (await api('GET', '/api/apps')).apps || []; } catch { S.apps = []; } }
async function loadAccount() { try { S.account = await api('GET', '/api/ai/account'); } catch { S.account = { linked: false }; } renderAcct(); renderEngine(); }
async function refreshLlm() { try { S.llm = await api('GET', '/api/ai/llm'); } catch { S.llm = null; } renderModelBtn(); return S.llm; }

// ---------- rail ----------
function renderList() {
  const q = A.norm(S.filter);
  const list = S.chats.filter((c) => (!q || A.norm(c.title).includes(q)) && (!S.projectId || S.view !== 'chat' || true));
  $('listTitle').textContent = q ? `Kết quả (${list.length})` : 'Gần đây';
  $('chatList').innerHTML = list.slice(0, 120).map((c) => `<li data-id="${esc(c.id)}" class="${c.id === S.currentId && S.view === 'chat' ? 'on' : ''}"><span class="ci" title="${esc(c.title)}">${c.pinned ? '★ ' : ''}${esc(c.title)}${c.projectId && project(c.projectId) ? `<small>${esc(project(c.projectId).icon)}</small>` : ''}</span><span class="ca"><button data-a="pin" title="Ghim">☆</button><button data-a="ren" title="Đổi tên">✎</button><button data-a="del" title="Xoá">✕</button></span></li>`).join('') || '<li class="empty">Chưa có cuộc trò chuyện nào</li>';
}
$('chatList').onclick = (e) => {
  const li = e.target.closest('li[data-id]'); if (!li) return;
  const id = li.dataset.id; const a = e.target.closest('button')?.dataset.a; const c = S.chats.find((x) => x.id === id);
  if (a === 'del') { if (S.busy && id === S.currentId) return; if (!confirm(`Xoá "${c.title}"?`)) return; S.chats = S.chats.filter((x) => x.id !== id); if (S.currentId === id) S.currentId = null; persist(); renderAll(); return; }
  if (a === 'pin') { c.pinned = !c.pinned; persist(); S.chats = A.cleanChats(S.chats); renderList(); return; }
  if (a === 'ren') {
    const inp = document.createElement('input'); inp.value = c.title; li.replaceChildren(inp); inp.focus(); inp.select();
    const done = () => { if (inp.value.trim()) { c.title = inp.value.trim().slice(0, 120); persist(); } renderList(); if (id === S.currentId) renderHead(); };
    inp.onkeydown = (ev) => { if (ev.key === 'Enter') done(); if (ev.key === 'Escape') renderList(); }; inp.onblur = done; return;
  }
  if (S.busy && id !== S.currentId) return;
  S.currentId = id; const ch = current(); if (ch && ch.projectId !== undefined) S.projectId = ch.projectId || null;
  go('chat');
};
$('chatSearch').oninput = (e) => { S.filter = e.target.value; renderList(); };
$('newChat').onclick = () => newChat(S.projectId);
function newChat(projectId) { if (S.busy) return; S.currentId = null; S.projectId = projectId || null; store.set('sc.project', S.projectId); go('chat'); $('input').focus(); }
document.querySelectorAll('.railnav a[data-view]').forEach((a) => { a.onclick = () => go(a.dataset.view); });

function renderAcct() {
  const a = S.account;
  if (!a.linked) { $('acct').innerHTML = `<div class="who"><span class="av">⌁</span><span><b>Đang dùng offline</b><small>Model trên máy, lệnh S Hub</small></span></div><button id="loginBtn">Đăng nhập tài khoản Socin</button>`; }
  else {
    const name = (a.me && (a.me.name || '')) || 'Tài khoản Socin';
    $('acct').innerHTML = `<div class="who"><span class="av">${esc(name.slice(0, 1).toUpperCase())}</span><span><b>${esc(name)}</b><small><span class="dot ${a.online && !a.error ? 'on' : 'off'}"></span>${esc(a.me && a.me.tenant ? a.me.tenant : a.baseUrl.replace(/^https?:\/\//, ''))}${a.error ? ' · ' + esc(a.error) : ''}</small></span></div><button id="loginBtn">Đổi tài khoản</button>`;
  }
  $('loginBtn').onclick = openLogin;
}

// ---------- đăng nhập Socin ----------
function openLogin() { $('lgErr').textContent = ''; if (S.account.baseUrl) $('lgUrl').value = S.account.baseUrl; $('lgKey').value = ''; $('lgPw').value = ''; $('login').showModal(); }
$('lgSave').onclick = async (e) => {
  e.preventDefault();
  const url = $('lgUrl').value.trim().replace(/\/$/, ''), key = $('lgKey').value.trim();
  if (!/^https:\/\//.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(url)) { $('lgErr').textContent = 'Địa chỉ phải bắt đầu bằng https://'; return; }
  const user = $('lgUser').value.trim(), pw = $('lgPw').value;
  if (!key && !(user && pw) && !S.account.linked) { $('lgErr').textContent = 'Nhập tên đăng nhập và mật khẩu Socin'; return; }
  $('lgSave').disabled = true; $('lgErr').textContent = '';
  try {
    if (!key && user && pw) { const r = await api('POST', '/api/ai/login', { baseUrl: url, username: user, password: pw }); if (r.error) throw new Error(r.error); }
    else { const r = await api('POST', '/api/cr/settings/save', { socinBaseUrl: url, ...(key ? { socinToken: key } : {}) }); if (r.error) throw new Error(r.error); }
  } catch (err) { $('lgErr').textContent = err.message; return; } finally { $('lgSave').disabled = false; $('lgPw').value = ''; }
  await loadAccount();
  if (S.account.error) { $('lgErr').textContent = S.account.error; return; }
  $('login').close(); await loadTools(); renderAll();
};

// ---------- điều hướng ----------
function go(view, openId) {
  if (S.view === 'flows' && view !== 'flows' && window.FlowUI && !window.FlowUI.leave()) return;
  S.view = view;
  for (const v of ['chat', 'projects', 'plugins', 'flows', 'agents']) $('v-' + v).hidden = v !== view;
  document.querySelectorAll('.railnav a[data-view]').forEach((a) => a.classList.toggle('on', a.dataset.view === view));
  $('ctxBtn').hidden = view !== 'chat'; $('engine').hidden = view !== 'chat' || !S.engine;
  if (view === 'projects') renderProjects();
  if (view === 'plugins') renderPlugins();
  renderAll();
  if ((view === 'flows' || view === 'agents') && window.FlowUI) {
    loadTools().then(() => window.FlowUI.render(view, $('v-' + view), { api, esc, openId, tools: () => S.tools, loadTools, projects: () => S.projects, go, head: (t, crumb) => { $('title').textContent = t; $('crumb').innerHTML = crumb; } }));
  }
}
function renderHead() {
  const c = current(); const p = project(c ? c.projectId : S.projectId);
  if (S.view === 'projects') { $('title').textContent = 'Dự án'; $('crumb').textContent = 'Ngữ cảnh, hướng dẫn và tài liệu cho trợ lý'; return; }
  if (S.view === 'flows' || S.view === 'agents') return; // FlowUI tự đặt tiêu đề
  if (S.view === 'plugins') { $('title').textContent = 'Plugin & kết nối'; $('crumb').textContent = 'Kho plugin Socin, máy chủ MCP, cổng MCP cho AI khác'; return; }
  $('title').textContent = c ? c.title : 'Cuộc trò chuyện mới';
  $('crumb').innerHTML = p ? `<a data-p="${esc(p.id)}">${esc(p.icon)} ${esc(p.name)}</a>` : 'Socin Studio';
  const a = $('crumb').querySelector('a'); if (a) a.onclick = () => openProject(a.dataset.p);
}
function renderEngine() {
  const e = S.engine; const el = $('engine');
  const ai = S.account.ai;
  el.textContent = e === 'socin' ? `AI Socin${ai ? ' · ' + (ai.provider_label || ai.provider) : ''}` : e === 'device' ? `Trên máy · ${S.llm ? S.llm.config.model : ''}` : e === 'rules' ? 'Bộ hiểu lệnh' : '';
  el.hidden = !e || S.view !== 'chat';
}
function renderAll() { renderHead(); renderList(); if (S.view === 'chat') renderMsgs(); renderEngine(); }

// ---------- tin nhắn ----------
const toolDef = (n) => S.tools.find((t) => t.name === n);
const toolTitle = (n) => (toolDef(n) || {}).title || n;
function renderMsgs() {
  const c = current(); const box = $('msgs');
  if (!c || !c.messages.length) { box.innerHTML = helloHtml(); bindHello(); return; }
  const results = new Map();
  for (const m of c.messages) if (m.role === 'user') for (const b of m.content) if (b.type === 'tool_result') results.set(b.tool_use_id, b);
  let html = '';
  const lastAi = [...c.messages.keys()].reverse().find((i) => c.messages[i].role === 'assistant');
  c.messages.forEach((m, idx) => {
    if (m.role === 'user') {
      const parts = m.content.filter((b) => b.type !== 'tool_result');
      if (!parts.length) return;
      html += `<div class="msg-user">${parts.map((b) => b.type === 'image' ? `<img src="data:${esc(b.source.media_type)};base64,${b.source.data}" alt="">` : esc(b.text)).join('')}</div>`;
      return;
    }
    html += '<div class="msg-ai">';
    for (const b of m.content) {
      if (b.type === 'text') html += `<div class="md">${md(b.text)}</div>`;
      else if (b.type === 'tool_use') html += toolHtml(b, results.get(b.id));
    }
    if (idx === lastAi && !S.busy) html += `<div class="actions"><a data-act="copy">Sao chép</a><a data-act="retry">Hỏi lại</a></div>`;
    html += '</div>';
  });
  if (S.busy) html += `<div class="thinking">${S.running ? 'Đang chạy: ' + esc(S.running) : 'Socin AI đang nghĩ…'}</div>`;
  box.innerHTML = html;
  box.querySelectorAll('[data-open]').forEach((el) => { el.onclick = () => openApp(JSON.parse(el.dataset.open)); });
  box.querySelectorAll('[data-act=copy]').forEach((el) => { el.onclick = () => { const m = c.messages[lastAi]; navigator.clipboard?.writeText(A.textOf(m)); el.textContent = 'Đã chép'; }; });
  box.querySelectorAll('[data-act=retry]').forEach((el) => { el.onclick = retry; });
  const sc = $('scroll'); sc.scrollTop = sc.scrollHeight;
}
function toolHtml(b, r) {
  const st = !r ? (S.busy ? 'run' : '') : r.is_error ? 'err' : 'ok';
  const out = r ? r.content.filter((x) => x.type === 'text').map((x) => x.text).join('\n') : '';
  const img = r && r.content.find((x) => x.type === 'image');
  const args = JSON.stringify(b.input || {});
  return `<details class="tool ${st}"><summary><span class="dot"></span><span class="tn">${esc(toolTitle(b.name))}</span><span class="hint">${esc(b.name)} ${esc(args === '{}' ? '' : args)}</span><span class="st">${st === 'run' ? 'Đang chạy' : st === 'err' ? 'Lỗi' : st === 'ok' ? 'Xong' : ''}</span></summary>
    <pre>${esc(JSON.stringify(b.input || {}, null, 1))}</pre>${out ? `<pre>${esc(out)}</pre>` : ''}${img ? `<img src="data:${esc(img.source.media_type)};base64,${img.source.data}" alt="">` : ''}
    </details>${r && r.open && r.open.type !== 'launch' ? `<div class="act"><button class="ghost sm" data-open='${esc(JSON.stringify(r.open))}'>↗ Mở ${esc(r.open.name)} ở khung bên</button></div>` : ''}`;
}
function helloHtml() {
  const p = project(S.projectId);
  const online = S.apps.filter((a) => a.type !== 'launch').slice(0, 10);
  const starters = [
    ['Máy đang chạy gì?', 'Xem trạng thái S Hub, Zoom worker, VPS', 'Tình hình máy và các ứng dụng Socin hiện thế nào?'],
    ['Triển khai lên VPS', 'Cập nhật dự án từ GitHub', 'Liệt kê server VPS và dự án, mình muốn triển khai bản mới.'],
    ['Kiểm thử một repo', 'Lint, build, test, bảo mật', 'Kiểm thử repo shub giúp mình.'],
    ['Thiết kế với S Draw', 'Gọi S Draw qua MCP', 'Mở S Draw và cho mình biết đang có mô hình nào.'],
    ['Soạn bài nháp TikTok', 'Đẩy nháp lên Socin để duyệt', 'Soạn giúp một bài nháp TikTok giới thiệu Socin Studio.'],
    ['Bật Zoom worker', 'Chạy worker giữ phòng Zoom', 'Bật zoom worker.'],
  ];
  return `<div class="hello"><h2>${p ? esc(p.icon + ' ' + p.name) : 'Chào bạn, hôm nay vận hành gì?'}</h2>
    <p class="mut">${p ? 'Trò chuyện trong dự án này: trợ lý đọc hướng dẫn và tài liệu của dự án.' : 'Socin AI gọi nhanh các ứng dụng Socin trên máy, Socin trên web và các plugin MCP. Gõ / để chọn lệnh.'}</p>
    <div class="starters">${starters.map((s) => `<button class="starter" data-q="${esc(s[2])}"><b>${esc(s[0])}</b><span>${esc(s[1])}</span></button>`).join('')}</div>
    <h2 class="mut" style="font-size:13px;margin-top:6px">Mở nhanh ứng dụng</h2>
    <div class="appchips">${online.map((a) => `<span class="chip" data-app="${esc(a.id)}"><span class="d ${a.online ? 'on' : ''}"></span>${esc(a.icon || '')} ${esc(a.name)}</span>`).join('')}<a class="chip" href="/apps.html">🧭 Tất cả ứng dụng</a></div></div>`;
}
function bindHello() {
  $('msgs').querySelectorAll('.starter').forEach((b) => { b.onclick = () => { $('input').value = b.dataset.q; autosize(); $('input').focus(); }; });
  $('msgs').querySelectorAll('[data-app]').forEach((b) => { b.onclick = () => { const a = S.apps.find((x) => x.id === b.dataset.app); if (a) openApp({ id: a.id, name: a.name, type: a.type }); }; });
}

// ---------- khung bên: ứng dụng / ngữ cảnh ----------
async function openApp(o) {
  await loadApps();
  const a = S.apps.find((x) => x.id === o.id); if (!a) return;
  if (a.type === 'launch') return;
  let url = a.url;
  if (!url && a.type === 'web') { $('side').hidden = false; $('sideTitle').textContent = a.name; $('sideFrame').hidden = true; $('sideBody').hidden = false; $('sideBody').innerHTML = '<p class="mut">Đang khởi động…</p>'; for (let i = 0; i < 20 && !url; i++) { await new Promise((r) => setTimeout(r, 1500)); await loadApps(); const n = S.apps.find((x) => x.id === o.id); if (n && n.online) url = n.url; } }
  if (!url) { $('sideBody').innerHTML = `<p>${esc(a.name)} chưa chạy. Mở ở trang <a href="/apps.html#${esc(a.id)}">Ứng dụng</a> để xem hướng dẫn.</p>`; return; }
  $('side').hidden = false; $('side').classList.remove('narrow'); $('sideTitle').textContent = (a.icon ? a.icon + ' ' : '') + a.name;
  $('sideBody').hidden = true; $('sideFrame').hidden = false; $('sideFrame').src = url;
  $('sideFull').hidden = false; $('sideFull').onclick = () => { location.href = '/apps.html#' + a.id; };
}
$('sideClose').onclick = () => { $('side').hidden = true; $('sideFrame').src = 'about:blank'; };
$('ctxBtn').onclick = () => { if (!$('side').hidden && !$('sideBody').hidden) { $('side').hidden = true; return; } showContext(); };
async function contextNow() {
  const c = current(); const p = project(c ? c.projectId : S.projectId);
  const a = S.account;
  return A.contextText({ now: new Date().toLocaleString('vi-VN'), user: a.linked && a.me ? `${a.me.name}${a.me.tenant ? ' (' + a.me.tenant + ')' : ''}` : 'chưa đăng nhập Socin (offline)', apps: S.apps.map((x) => `${x.name}[${x.id}]${x.online === true ? ' đang chạy' : ''}`).join(', '), project: p });
}
async function showContext() {
  const c = current(); const pid = c ? c.projectId || '' : S.projectId || '';
  $('side').hidden = false; $('side').classList.add('narrow'); $('sideTitle').textContent = 'Ngữ cảnh'; $('sideFrame').hidden = true; $('sideFull').hidden = true; $('sideBody').hidden = false;
  const ctx = await contextNow();
  $('sideBody').innerHTML = `<label class="mut sm">Dự án của cuộc trò chuyện</label><select id="ctxProj"><option value="">Không thuộc dự án</option>${S.projects.map((p) => `<option value="${esc(p.id)}" ${p.id === pid ? 'selected' : ''}>${esc(p.icon + ' ' + p.name)}</option>`).join('')}</select>
    <div class="mut sm">Trợ lý nhận kèm mỗi lượt (${ctx.length} ký tự):</div><pre style="white-space:pre-wrap;font-size:12px;background:var(--in);border:1px solid var(--line);border-radius:8px;padding:8px;max-height:46vh;overflow:auto">${esc(ctx)}</pre>
    <div class="mut sm">Lệnh đang có: ${S.tools.length} (${S.tools.filter((t) => /^mcp_/.test(t.name)).length} từ plugin MCP).</div>
    <button class="ghost sm" id="ctxEdit">Sửa hướng dẫn và tài liệu dự án</button>`;
  $('ctxProj').onchange = (e) => { const v = e.target.value || null; const ch = current(); if (ch) { ch.projectId = v; putChat({ ...ch }); } S.projectId = v; store.set('sc.project', v); renderHead(); showContext(); };
  $('ctxEdit').onclick = () => { const v = $('ctxProj').value; v ? openProject(v) : go('projects'); };
}

// ---------- quyền và lệnh ----------
const always = new Map();
let answer = null;
function askPermission(def, input) {
  return new Promise((resolve) => {
    answer = resolve;
    const paid = def.access === 'paid';
    $('ask').hidden = false;
    $('ask').innerHTML = `<b>Socin AI muốn ${paid ? 'chạy lệnh tốn phí' : 'thực hiện thay đổi quan trọng'}: ${esc(def.title || def.name)}</b><code>${esc(def.name)} ${esc(JSON.stringify(input))}</code>
      <div class="row"><button class="cta sm" data-v="once">Cho phép</button>${paid ? '' : '<button class="ghost sm" data-v="always">Luôn cho phép trong cuộc này</button>'}<button class="ghost sm" data-v="deny">Từ chối</button></div>`;
    $('ask').querySelectorAll('button').forEach((b) => { b.onclick = () => { $('ask').hidden = true; const f = answer; answer = null; f && f(b.dataset.v); }; });
  });
}
async function runTool(chatId, name, input) {
  const def = toolDef(name);
  if (!def) return { text: `Không có lệnh "${name}"`, isError: true };
  if (!A.allowedBy(S.mode, def.access)) return { text: `Trợ lý đang để quyền "${A.MODES[S.mode]}", lệnh ${name} chưa được phép. Nhờ người dùng đổi ô "Quyền" dưới khung chat.`, isError: true };
  let confirmed = false;
  if (A.needsAsk(def.access)) {
    const set0 = always.get(chatId);
    if (def.access === 'files' && set0 && set0.has(name)) confirmed = true;
    else {
      const v = await askPermission(def, input);
      if (v === 'deny') return { text: 'Người dùng đã từ chối lệnh này.', isError: true };
      if (v === 'always') always.set(chatId, new Set([...(set0 || []), name]));
      confirmed = true;
    }
  }
  S.running = def.title || name; renderMsgs();
  try {
    const r = await api('POST', '/api/ai/call', { name, input, confirmed, mode: S.mode });
    if (r.open) { lastOpen = r.open; if (r.open.type !== 'launch') openApp(r.open); }
    return r;
  } finally { S.running = null; }
}
let lastOpen = null;

// ---------- gửi ----------
let abort = false;
async function send(text) {
  const q = String(text ?? $('input').value).trim();
  const images = S.images.slice();
  if ((!q && !images.length) || S.busy) return;
  $('input').value = ''; S.images = []; renderThumbs(); autosize(); closeSlash();
  abort = false;
  let chat = current();
  if (!chat) { chat = { id: 'c' + Date.now().toString(36), title: A.titleFrom(q || 'Ảnh'), updatedAt: Date.now(), projectId: S.projectId || null, messages: [] }; S.currentId = chat.id; }
  const content = [...images.map(A.imageBlock).filter(Boolean), ...(q ? [{ type: 'text', text: q }] : [])];
  const chatId = chat.id; const base = chat;
  putChat({ ...chat, updatedAt: Date.now(), messages: A.appendUser(chat.messages, content) });
  S.busy = true; setBusy(); renderAll();
  try {
    await Promise.all([loadTools(), loadApps()]);
    const visible = S.tools.filter((d) => A.allowedBy(S.mode, d.access));
    const apiTools = visible.map((d) => ({ name: d.name, description: d.description, input_schema: d.inputSchema }));
    const context = await contextNow();
    const llm = await refreshLlm();
    const pref = llm ? llm.config.mode : 'auto';
    const socin = S.account.linked && pref !== 'local' ? async (messages) => {
      const r = await api('POST', '/api/ai/socin', { messages: A.trimHistory(messages), tools: apiTools, context });
      return r.ok ? { ok: true, content: r.content } : { ok: false, fallback: !!r.fallback, error: r.error || 'lỗi' };
    } : null;
    const device = llm && llm.ready && pref !== 'socin' ? async (messages) => {
      const r = await api('POST', '/api/ai/llm/chat', { messages, tools: apiTools, context });
      return r.ok ? { ok: true, content: r.content } : { ok: false, fallback: false, error: r.error };
    } : null;
    let onDevice = !socin;
    const model = socin || device ? async (messages) => {
      if (!onDevice && socin) {
        const r = await socin(messages);
        if (r.ok) { S.engine = 'socin'; renderEngine(); return r; }
        if (!r.fallback || !device) return r;
        onDevice = true;
      }
      S.engine = 'device'; renderEngine();
      return device(messages);
    } : null;
    const res = await A.runTurn(current() ? current().messages : [], {
      model,
      localCtx: { toolNames: visible.map((d) => d.name), apps: S.apps, firstArg: FIRST_ARG },
      runTool: (name, input) => runTool(chatId, name, input),
      onUpdate: (messages) => {
        const c = S.chats.find((x) => x.id === chatId) || base;
        // gắn nút "Mở ứng dụng" vào kết quả lệnh open_app vừa chạy
        if (lastOpen) { const last = messages[messages.length - 1]; if (last && last.role === 'user') for (const b of last.content) if (b.type === 'tool_result' && !b.open) { b.open = lastOpen; } lastOpen = null; }
        S.chats = [{ ...c, updatedAt: Date.now(), messages }, ...S.chats.filter((x) => x.id !== chatId)]; persist();
        if (S.currentId === chatId) renderMsgs();
      },
      aborted: () => abort,
    });
    if (res.source === 'local') S.engine = 'rules';
    if (res.source === 'local' && !model && !current().messages.some((m) => m.role === 'assistant' && m.hinted)) {
      // gợi ý bật model lần đầu
    }
  } catch (e) {
    const c = current(); if (c) putChat({ ...c, messages: [...c.messages, { role: 'assistant', content: [{ type: 'text', text: 'Lỗi: ' + e.message }] }] });
  } finally { S.busy = false; S.running = null; setBusy(); renderAll(); }
}
function setBusy() { $('send').textContent = S.busy ? 'Dừng' : 'Gửi'; $('send').className = S.busy ? 'ghost' : 'cta'; }
$('send').onclick = () => { if (S.busy) { abort = true; if (answer) { const f = answer; answer = null; $('ask').hidden = true; f('deny'); } } else send(); };
async function retry() {
  const c = current(); if (!c || S.busy) return;
  let i = c.messages.length - 1;
  while (i >= 0 && !(c.messages[i].role === 'user' && c.messages[i].content.some((b) => b.type === 'text'))) i--;
  if (i < 0) return;
  const q = A.textOf(c.messages[i]); putChat({ ...c, messages: c.messages.slice(0, i) }); await send(q);
}

// ---------- ô nhập, lệnh "/" ----------
const input = $('input');
function autosize() { input.style.height = 'auto'; input.style.height = Math.min(220, input.scrollHeight) + 'px'; }
let slashSel = 0, slashHits = [];
function groupOf(t) { return /^mcp_/.test(t.name) ? (t.title || '').split(':')[0] : t.plugin === 'socin' ? 'Socin' : 'S Hub'; }
function openSlash() {
  const m = /^\/([\w-]*)$/.exec(input.value.trim()); if (!m) return closeSlash();
  const q = A.norm(m[1]);
  slashHits = S.tools.filter((t) => !q || A.norm(t.name + ' ' + t.title).includes(q)).slice(0, 40);
  if (!slashHits.length) return closeSlash();
  slashSel = Math.min(slashSel, slashHits.length - 1);
  let g = ''; let html = '';
  slashHits.forEach((t, i) => { const gg = groupOf(t); if (gg !== g) { g = gg; html += `<li class="grp">${esc(g)}</li>`; } html += `<li data-i="${i}" class="${i === slashSel ? 'on' : ''}"><code>/${esc(t.name)}</code><span>${esc(t.title || '')}</span>${A.needsAsk(t.access) ? `<span class="acc ${t.access}">hỏi trước</span>` : ''}</li>`; });
  $('slash').innerHTML = html; $('slash').hidden = false;
  $('slash').querySelectorAll('li[data-i]').forEach((li) => { li.onmousedown = (e) => { e.preventDefault(); pickSlash(+li.dataset.i); }; });
}
function closeSlash() { $('slash').hidden = true; slashHits = []; }
function pickSlash(i) { const t = slashHits[i]; if (!t) return; input.value = '/' + t.name + ' '; closeSlash(); input.focus(); autosize(); }
input.addEventListener('input', () => { autosize(); slashSel = 0; openSlash(); });
input.addEventListener('keydown', (e) => {
  if (!$('slash').hidden) {
    if (e.key === 'ArrowDown') { slashSel = Math.min(slashSel + 1, slashHits.length - 1); openSlash(); e.preventDefault(); return; }
    if (e.key === 'ArrowUp') { slashSel = Math.max(slashSel - 1, 0); openSlash(); e.preventDefault(); return; }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { pickSlash(slashSel); e.preventDefault(); return; }
    if (e.key === 'Escape') { closeSlash(); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});
input.addEventListener('paste', (e) => { for (const it of e.clipboardData?.items || []) if (it.type.startsWith('image/')) { addImage(it.getAsFile()); e.preventDefault(); } });
$('file').onchange = (e) => { for (const f of e.target.files) addImage(f); e.target.value = ''; };
function addImage(f) {
  if (!f || f.size > 8e6) return;
  const r = new FileReader();
  r.onload = () => { const img = new Image(); img.onload = () => { const k = Math.min(1, 1280 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); S.images.push(c.toDataURL('image/jpeg', 0.85)); renderThumbs(); }; img.src = r.result; };
  r.readAsDataURL(f);
}
function renderThumbs() { $('thumbs').innerHTML = S.images.map((u, i) => `<span><img src="${u}" alt=""><b data-i="${i}">✕</b></span>`).join(''); $('thumbs').querySelectorAll('b').forEach((b) => { b.onclick = () => { S.images.splice(+b.dataset.i, 1); renderThumbs(); }; }); }
$('mode').value = S.mode;
$('mode').onchange = (e) => { S.mode = e.target.value; store.set('sc.mode', S.mode); };

// bảng lệnh
$('toolsBtn').onclick = () => { if (!$('toolPop').hidden) { $('toolPop').hidden = true; return; } $('modelPop').hidden = true; renderToolPop(''); };
function renderToolPop(q) {
  const k = A.norm(q); const groups = {};
  for (const t of S.tools) if (!k || A.norm(t.name + ' ' + t.title + ' ' + t.description).includes(k)) (groups[groupOf(t)] = groups[groupOf(t)] || []).push(t);
  $('toolPop').hidden = false;
  $('toolPop').innerHTML = `<input id="tpq" placeholder="Tìm lệnh (${S.tools.length})" value="${esc(q)}">${Object.entries(groups).map(([g, ts]) => `<h4>${esc(g)}</h4>${ts.map((t) => `<div class="it" data-n="${esc(t.name)}"><code>/${esc(t.name)}</code><span class="mut">${esc(t.title || '')}</span>${A.needsAsk(t.access) ? `<span class="acc ${t.access}">hỏi trước</span>` : ''}</div>`).join('')}`).join('') || '<p class="mut">Không có lệnh</p>'}<p class="mut sm">Thêm lệnh bằng cách cài plugin ở mục Plugin &amp; kết nối.</p>`;
  const qi = $('tpq'); qi.oninput = () => { renderToolPop(qi.value); const n = $('tpq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
  $('toolPop').querySelectorAll('.it').forEach((el) => { el.onclick = () => { input.value = '/' + el.dataset.n + ' '; $('toolPop').hidden = true; input.focus(); autosize(); }; });
}

// ---------- nút Model ----------
function renderModelBtn() { const m = S.llm ? S.llm.config.mode : 'auto'; $('modelBtn').textContent = 'Model: ' + MODE_LABEL[m]; }
$('modelBtn').onclick = async () => { if (!$('modelPop').hidden) { $('modelPop').hidden = true; return; } $('toolPop').hidden = true; await refreshLlm(); renderModelPop(); };
let pollT = null;
function renderModelPop() {
  const l = S.llm; const pop = $('modelPop'); pop.hidden = false;
  if (!l) { pop.innerHTML = '<p class="mut">Không đọc được trạng thái model.</p>'; return; }
  const ai = S.account.ai;
  const cur = A.LOCAL_MODELS.find((m) => m.id === l.config.model) || { label: l.config.model, sizeGb: '?', ramGb: '?' };
  const socinLine = !S.account.linked ? 'Chưa đăng nhập Socin.' : ai ? (ai.enabled ? `${esc(ai.provider_label || ai.provider)} · ${esc(ai.model)} (khoá trong admin Socin)` : 'Doanh nghiệp chưa bật AI: admin cài ở Socin → Cài đặt → AI.') : 'Không đọc được AI của Socin.';
  let local;
  if (l.pulling) local = `<div>Đang tải ${esc(l.pulling.model)}: ${l.pulling.percent}% <span class="mut sm">${esc(l.pulling.text)}</span></div><div class="bar"><i style="width:${l.pulling.percent}%"></i></div>`;
  else if (l.installing && l.installing.running) local = `<div>Đang cài Ollama… <span class="mut sm">${esc(l.installing.text || '')}</span></div>`;
  else if (!l.installed) local = `<div class="mut">Chưa có Ollama trên máy. ${l.brew ? 'S Hub cài bằng Homebrew.' : 'Chưa có Homebrew: S Hub mở trang tải Ollama.'}</div><div class="row"><button class="cta sm" id="llmInstall">Cài Ollama</button><button class="ghost sm" id="llmRecheck">Kiểm tra lại</button></div>`;
  else if (!l.running) local = `<div class="mut">Ollama đã cài nhưng chưa chạy.</div><div class="row"><button class="cta sm" id="llmStart">Khởi động Ollama</button></div>`;
  else if (!l.ready) local = `<div>Chưa có model ${esc(cur.label)} trên máy. Tải khoảng ${cur.sizeGb} GB, khi chạy dùng chừng ${cur.ramGb} GB RAM. Ollama dùng chung với S Draw nên model đã tải ở đó dùng luôn được.</div><div class="row"><button class="cta sm" id="llmPull">Đồng ý tải ${esc(cur.label)}</button></div>`;
  else local = `<div><span class="tag ok">Sẵn sàng</span> ${esc(cur.label)} chạy trên máy, không cần mạng.</div>`;
  pop.innerHTML = `<h4>Chế độ</h4><div class="modes">${['auto', 'socin', 'local'].map((m) => `<div class="opt ${l.config.mode === m ? 'on' : ''}" data-m="${m}"><b>${MODE_LABEL[m]}</b><span>${m === 'auto' ? 'AI Socin khi có mạng, mất mạng dùng model trên máy' : m === 'socin' ? 'Chỉ dùng AI của Socin' : 'Chỉ chạy trên máy, không gửi lên mạng'}</span></div>`).join('')}</div>
    <h4>AI Socin</h4><div class="sm">${socinLine}${!S.account.linked ? ' <a href="#" id="llmLogin">Đăng nhập</a>' : ''}</div>
    <h4>Model trên máy (Ollama)</h4>
    <div class="modes" style="grid-template-columns:1fr 1fr">${A.LOCAL_MODELS.map((m) => `<div class="opt ${l.config.model === m.id ? 'on' : ''}" data-model="${esc(m.id)}"><b>${esc(m.label)}${m.recommended ? ' · đề xuất' : ''}${l.models.some((x) => x === m.id || x === m.id + ':latest') ? ' ✓' : ''}</b><span>${m.sizeGb} GB tải · ~${m.ramGb} GB RAM. ${esc(m.note)}</span></div>`).join('')}</div>
    ${local}${l.installing && !l.installing.running && l.installing.text ? `<div class="sm ${l.installing.ok ? '' : 'err'}">${esc(l.installing.text)}</div>` : ''}`;
  pop.querySelectorAll('[data-m]').forEach((el) => { el.onclick = async () => { S.llm = await api('POST', '/api/ai/llm/config', { mode: el.dataset.m }); renderModelBtn(); renderModelPop(); }; });
  pop.querySelectorAll('[data-model]').forEach((el) => { el.onclick = async () => { S.llm = await api('POST', '/api/ai/llm/config', { model: el.dataset.model }); renderModelPop(); }; });
  const bind = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  bind('llmLogin', (e) => { e.preventDefault(); openLogin(); });
  bind('llmInstall', async () => { S.llm = await api('POST', '/api/ai/llm/install'); renderModelPop(); poll(); });
  bind('llmRecheck', async () => { await refreshLlm(); renderModelPop(); });
  bind('llmStart', async (e) => { e.target.textContent = 'Đang khởi động…'; S.llm = await api('POST', '/api/ai/llm/start').catch((er) => { alert(er.message); return S.llm; }); renderModelPop(); });
  bind('llmPull', async () => { S.llm = await api('POST', '/api/ai/llm/pull', { model: l.config.model }).catch((er) => { alert(er.message); return S.llm; }); renderModelPop(); poll(); });
}
function poll() { clearInterval(pollT); pollT = setInterval(async () => { await refreshLlm(); if (!$('modelPop').hidden) renderModelPop(); if (!S.llm || (!S.llm.pulling && !(S.llm.installing && S.llm.installing.running))) clearInterval(pollT); }, 1500); }
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#modelPop,#modelBtn')) $('modelPop').hidden = true; if (!e.target.closest('#toolPop,#toolsBtn')) $('toolPop').hidden = true; });

// ---------- dự án ----------
function renderProjects() {
  const el = $('v-projects');
  el.innerHTML = `<div class="page"><div class="pagein">
    <div class="row"><p class="mut" style="margin:0;flex:1">Mỗi dự án có hướng dẫn riêng và tài liệu làm ngữ cảnh. Cuộc trò chuyện trong dự án, trợ lý luôn đọc những thứ này trước khi trả lời.</p><button class="cta" id="pjNew">＋ Dự án mới</button></div>
    <div class="cards">${S.projects.map((p) => { const n = S.chats.filter((c) => c.projectId === p.id).length; return `<div class="pcard" data-p="${esc(p.id)}" style="cursor:pointer"><div class="hd"><span class="ic">${esc(p.icon)}</span><b>${esc(p.name)}</b></div><p>${esc((p.instructions || 'Chưa có hướng dẫn').slice(0, 140))}</p><div class="ft"><span class="tag">${n} cuộc trò chuyện</span><span class="tag">${p.notes.length} tài liệu</span></div></div>`; }).join('') || '<p class="mut">Chưa có dự án nào.</p>'}</div>
  </div></div>`;
  $('pjNew').onclick = async () => { const p = { id: 'p' + Date.now().toString(36), name: 'Dự án mới', icon: '📁', instructions: '', notes: [], createdAt: Date.now() }; S.projects.unshift(p); await saveProjects(); openProject(p.id); };
  el.querySelectorAll('[data-p]').forEach((c) => { c.onclick = () => openProject(c.dataset.p); });
}
function openProject(id) {
  const p = project(id); if (!p) return go('projects');
  if (S.view !== 'projects') go('projects');
  const chats = S.chats.filter((c) => c.projectId === p.id);
  $('title').textContent = p.icon + ' ' + p.name; $('crumb').innerHTML = '<a id="pjBack">Dự án</a>'; $('pjBack').onclick = () => go('projects');
  $('v-projects').innerHTML = `<div class="page"><div class="pagein">
    <div class="row"><button class="cta" id="pjChat">＋ Trò chuyện trong dự án</button><span class="flex"></span><button class="ghost sm" id="pjDel">Xoá dự án</button></div>
    <div class="box form"><div class="row" style="flex-wrap:nowrap"><label style="width:80px">Biểu tượng<input id="pjIcon" value="${esc(p.icon)}" maxlength="4"></label><label style="flex:1">Tên dự án<input id="pjName" value="${esc(p.name)}"></label></div>
      <label>Hướng dẫn cho trợ lý (giọng văn, quy tắc, mục tiêu, ứng dụng hay dùng…)<textarea id="pjIns" rows="5" placeholder="Ví dụ: Dự án vận hành VPS khách hàng. Luôn kiểm tra vps_status trước khi triển khai, báo kết quả ngắn gọn.">${esc(p.instructions)}</textarea></label>
      <div class="row"><span class="mut sm" id="pjSaved"></span><span class="flex"></span><button class="ghost" id="pjSave">Lưu</button></div></div>
    <h2>Tài liệu ngữ cảnh</h2>
    <div class="cards" id="pjNotes">${p.notes.map((n) => `<div class="pcard"><div class="hd"><span class="ic">📄</span><b>${esc(n.title || 'Ghi chú')}</b></div><p>${esc(n.text.slice(0, 160))}</p><div class="ft"><button class="ghost sm" data-ed="${esc(n.id)}">Sửa</button><button class="ghost sm" data-rm="${esc(n.id)}">Xoá</button></div></div>`).join('')}
      <div class="pcard"><b>Thêm tài liệu</b><input id="ntTitle" placeholder="Tên tài liệu"><textarea id="ntText" rows="3" placeholder="Dán nội dung (quy trình, thông tin khách, cấu hình…) hoặc chọn file chữ"></textarea><div class="ft"><label class="ghost sm" style="cursor:pointer;border:1px solid var(--line);border-radius:8px;padding:4px 10px">Chọn file<input type="file" id="ntFile" accept=".txt,.md,.json,.csv" hidden></label><span class="flex"></span><button class="cta sm" id="ntAdd">Thêm</button></div></div></div>
    <h2>Cuộc trò chuyện trong dự án</h2>
    <div class="cards">${chats.map((c) => `<div class="pcard" data-c="${esc(c.id)}" style="cursor:pointer"><b>${esc(c.title)}</b><p>${new Date(c.updatedAt).toLocaleString('vi-VN')}</p></div>`).join('') || '<p class="mut">Chưa có.</p>'}</div>
  </div></div>`;
  const save = async () => { p.name = $('pjName').value.trim() || 'Dự án'; p.icon = $('pjIcon').value.trim() || '📁'; p.instructions = $('pjIns').value; await saveProjects(); $('pjSaved').textContent = 'Đã lưu ' + new Date().toLocaleTimeString('vi-VN'); $('title').textContent = p.icon + ' ' + p.name; renderList(); };
  $('pjSave').onclick = save; $('pjIns').onblur = save; $('pjName').onblur = save;
  $('pjChat').onclick = () => newChat(p.id);
  $('pjDel').onclick = async () => { if (!confirm(`Xoá dự án "${p.name}"? Cuộc trò chuyện vẫn giữ, chỉ bỏ khỏi dự án.`)) return; S.projects = S.projects.filter((x) => x.id !== p.id); S.chats.forEach((c) => { if (c.projectId === p.id) c.projectId = null; }); persist(); await saveProjects(); go('projects'); };
  $('ntFile').onchange = (e) => { const f = e.target.files[0]; if (!f) return; if (f.size > 200000) return alert('File quá lớn (tối đa 200 KB chữ)'); const r = new FileReader(); r.onload = () => { $('ntText').value = String(r.result).slice(0, 8000); if (!$('ntTitle').value) $('ntTitle').value = f.name; }; r.readAsText(f); };
  $('ntAdd').onclick = async () => { const t = $('ntText').value.trim(); if (!t) return; p.notes.push({ id: 'n' + Date.now().toString(36), title: $('ntTitle').value.trim() || 'Ghi chú', text: t.slice(0, 8000) }); await saveProjects(); openProject(p.id); };
  $('v-projects').querySelectorAll('[data-rm]').forEach((b) => { b.onclick = async () => { p.notes = p.notes.filter((n) => n.id !== b.dataset.rm); await saveProjects(); openProject(p.id); }; });
  $('v-projects').querySelectorAll('[data-ed]').forEach((b) => { b.onclick = async () => { const n = p.notes.find((x) => x.id === b.dataset.ed); const v = prompt('Sửa nội dung "' + n.title + '"', n.text); if (v !== null) { n.text = v.slice(0, 8000); await saveProjects(); openProject(p.id); } }; });
  $('v-projects').querySelectorAll('[data-c]').forEach((c) => { c.onclick = () => { S.currentId = c.dataset.c; S.projectId = p.id; go('chat'); }; });
}

// ---------- plugin & kết nối ----------
async function renderPlugins() {
  const el = $('v-plugins');
  el.innerHTML = '<div class="page"><div class="pagein"><p class="mut">Đang tải…</p></div></div>';
  const [cat, gw] = await Promise.all([api('GET', '/api/ai/plugins').catch(() => ({ plugins: [], servers: [], store: [] })), api('GET', '/api/ai/gateway').catch(() => null)]);
  const servers = cat.servers || [];
  const instOf = (p) => servers.find((s) => s.pluginId === p.id);
  const a = S.account;
  const cats = { socin: 'Socin', design: 'Thiết kế & 3D', dev: 'Lập trình', content: 'Nội dung', data: 'Dữ liệu', system: 'Hệ thống' };
  el.innerHTML = `<div class="page"><div class="pagein">
    <div class="box row"><div style="flex:1"><b>${a.linked ? 'Đã đăng nhập Socin' : 'Đang dùng offline'}</b><div class="mut sm">${a.linked ? `${esc((a.me && a.me.name) || '')} ${a.me && a.me.tenant ? '· ' + esc(a.me.tenant) : ''} · ${esc(a.baseUrl)}. Kho plugin lấy từ Socin.` : 'Kho plugin dùng bản có sẵn trong S Hub. Đăng nhập để dùng AI Socin, lệnh Socin và kho plugin mới nhất.'}</div></div><button class="${a.linked ? 'ghost' : 'cta'}" id="plLogin">${a.linked ? 'Đổi tài khoản' : 'Đăng nhập Socin'}</button></div>
    <h2>Kho plugin ${cat.source === 'socin' ? 'Socin' : '(offline)'}</h2>
    <div class="cards">${cat.plugins.map((p) => { const s = instOf(p); const builtin = p.kind === 'builtin'; const blocked = p.needsSocin && !a.linked;
      const state = builtin ? (blocked ? '<span class="tag warn">Cần đăng nhập Socin</span>' : '<span class="tag ok">Có sẵn</span>') : s ? (!s.enabled ? '<span class="tag">Đã tắt</span>' : s.error ? '<span class="tag warn">Chưa kết nối được</span>' : `<span class="tag ok">Đã bật${s.tools != null ? ' · ' + s.tools + ' lệnh' : ''}</span>`) : '';
      return `<div class="pcard"><div class="hd"><span class="ic">${esc(p.icon)}</span><b>${esc(p.name)}</b></div><p>${esc(p.description)}</p>
        <div class="ft">${state}<span class="tag">${esc(cats[p.category] || p.category)}</span>${p.offline ? '<span class="tag">Chạy offline</span>' : '<span class="tag">Cần mạng</span>'}${p.requires ? `<span class="tag">cần ${esc(p.requires.join(', '))}</span>` : ''}</div>
        <div class="ft">${builtin ? (blocked ? '<button class="cta sm" data-login="1">Đăng nhập</button>' : '') : s ? `<button class="ghost sm" data-test="${esc(s.id)}">Thử</button><button class="ghost sm" data-tog="${esc(s.id)}" data-on="${s.enabled ? 0 : 1}">${s.enabled ? 'Tắt' : 'Bật'}</button>` : `<button class="cta sm" data-inst="${esc(p.id)}">Cài</button>`}${p.homepage ? `<a class="sm" href="${esc(p.homepage)}" target="_blank" rel="noopener">Trang chủ</a>` : ''}</div><div class="sm mut" data-res="${esc(s ? s.id : p.id)}"></div></div>`; }).join('')}</div>
    ${cat.store && cat.store.length ? `<h2>Dịch vụ trong Store Socin</h2><div class="cards">${cat.store.map((i) => `<div class="pcard"><b>${esc(i.name)}</b><p>${esc(i.description)}</p><div class="ft"><span class="tag">${Number(i.price_vnd).toLocaleString('vi-VN')}đ${i.recurring ? '/tháng' : ''}</span>${cat.storeUrl ? `<a class="sm" href="${esc(cat.storeUrl)}" target="_blank" rel="noopener">Mua trong Socin</a>` : ''}</div></div>`).join('')}</div>` : ''}
    <h2>Máy chủ MCP đã kết nối</h2>
    <div class="box">${servers.map((s) => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)"><b style="min-width:150px">${esc(s.name)}</b><span class="mut sm" style="flex:1;word-break:break-all">${esc(s.kind === 'mcp-http' ? (s.url === 'auto' ? 'tự dò cổng S Draw' : s.url) : [s.command, ...(s.args || [])].join(' '))}${s.hasToken ? ' · có mã khoá' : ''}${s.error ? ` · <span class="err">${esc(s.error)}</span>` : ''}</span><span class="tag ${s.enabled ? 'ok' : ''}">${s.enabled ? 'Bật' : 'Tắt'}</span><button class="ghost sm" data-test="${esc(s.id)}">Thử</button><button class="ghost sm" data-tog="${esc(s.id)}" data-on="${s.enabled ? 0 : 1}">${s.enabled ? 'Tắt' : 'Bật'}</button>${s.builtin ? '' : `<button class="ghost sm" data-rm="${esc(s.id)}">Gỡ</button>`}</div><div class="sm mut" data-res="${esc(s.id)}"></div>`).join('') || '<p class="mut">Chưa có.</p>'}
      <details style="margin-top:10px"><summary style="cursor:pointer"><b>Thêm máy chủ MCP khác</b></summary><div class="form" style="margin-top:10px">
        <div class="row"><label style="flex:1">Tên<input id="mxName" placeholder="Ví dụ: Notion của tôi"></label><label>Kiểu<select id="mxKind"><option value="mcp-http">HTTP (URL)</option><option value="mcp-stdio">Chạy lệnh trên máy (stdio)</option></select></label></div>
        <label id="mxUrlL">Địa chỉ<input id="mxUrl" placeholder="https://…/mcp hoặc http://127.0.0.1:cổng/mcp"></label>
        <div class="row" id="mxCmdL" hidden><label style="width:140px">Lệnh<input id="mxCmd" placeholder="npx"></label><label style="flex:1">Tham số<input id="mxArgs" placeholder="-y @scope/server"></label></div>
        <label>Mã khoá (tuỳ chọn, gửi dạng Bearer; lưu trên máy này)<input id="mxTok" type="password" autocomplete="off"></label>
        <div class="row"><span class="err" id="mxErr"></span><span class="flex"></span><button class="cta" id="mxAdd">Thêm</button></div></div></details></div>
    ${gw ? `<h2>Cổng MCP của S Hub: cho Claude, ChatGPT, Cursor gọi vào các ứng dụng Socin</h2>
    <div class="box form">
      <div class="row"><b style="flex:1">Cho AI khác kết nối</b><span class="tag ${gw.enabled ? 'ok' : ''}">${gw.enabled ? 'Đang bật' : 'Đang tắt'}</span><button class="${gw.enabled ? 'ghost' : 'cta'}" id="gwTog">${gw.enabled ? 'Tắt' : 'Bật'}</button></div>
      <label>Quyền của AI bên ngoài<select id="gwMode"><option value="read" ${gw.mode === 'read' ? 'selected' : ''}>Chỉ xem</option><option value="edit" ${gw.mode === 'edit' ? 'selected' : ''}>Xem và thao tác (không triển khai, không tạo bài)</option><option value="full" ${gw.mode === 'full' ? 'selected' : ''}>Đầy đủ (cả triển khai VPS, tạo bài nháp Socin)</option></select></label>
      <div class="sm"><b>Claude Desktop</b> (stdio, không lộ mã khoá trong file cấu hình): <button class="ghost sm" id="gwClaude">Thêm vào Claude Desktop</button> <span class="mut" id="gwClaudeRes"></span><pre>${esc(JSON.stringify({ mcpServers: { socin: gw.stdio } }, null, 2))}</pre></div>
      <div class="sm"><b>Cursor, Claude Code, Windsurf, VS Code</b> (HTTP): địa chỉ <code>${esc(gw.url)}</code>, header <code>Authorization: Bearer …</code> <button class="ghost sm" id="gwShow">Hiện mã khoá</button> <button class="ghost sm" id="gwNew">Đổi mã khoá</button><pre id="gwCursor">${esc(JSON.stringify({ mcpServers: { socin: { url: gw.url, headers: { Authorization: 'Bearer ••••••' } } } }, null, 2))}</pre></div>
      <div class="sm mut"><b>ChatGPT</b> chỉ kết nối máy chủ MCP qua https công khai, chưa gọi thẳng được vào máy này; dùng Claude Desktop hoặc Cursor, hoặc mở cổng qua đường hầm (Tailscale Funnel, Cloudflare Tunnel) nếu thật sự cần.</div>
      ${gw.log && gw.log.length ? `<div class="sm mut">Gọi gần đây: ${gw.log.map((l) => `${esc(l.tool)} ${l.ok ? '✓' : '✗'} ${new Date(l.at).toLocaleTimeString('vi-VN')}`).join(' · ')}</div>` : ''}
    </div>` : ''}
  </div></div>`;
  const q = (s) => el.querySelectorAll(s);
  $('plLogin').onclick = openLogin; q('[data-login]').forEach((b) => { b.onclick = openLogin; });
  q('[data-inst]').forEach((b) => { b.onclick = async () => {
    const p = cat.plugins.find((x) => x.id === b.dataset.inst);
    let token = '';
    if (p.tokenLabel) { token = prompt(p.tokenLabel + ' (lưu trên máy này, không gửi lên Socin)') || ''; if (!token) return; }
    let args = p.args;
    if (p.id === 'filesystem') { const d = prompt('Thư mục cho AI đọc/ghi', args[args.length - 1]); if (!d) return; args = [...args.slice(0, -1), d]; }
    try { await api('POST', '/api/ai/mcp/servers', { pluginId: p.id, id: p.id, name: p.name, kind: p.kind, url: p.url, command: p.command, args, token }); await loadTools(); renderPlugins(); } catch (e) { alert(e.message); }
  }; });
  q('[data-tog]').forEach((b) => { b.onclick = async () => { await api('POST', '/api/ai/mcp/toggle', { id: b.dataset.tog, enabled: b.dataset.on === '1' }); await loadTools(); renderPlugins(); }; });
  q('[data-rm]').forEach((b) => { b.onclick = async () => { if (!confirm('Gỡ máy chủ MCP này?')) return; await api('POST', '/api/ai/mcp/remove', { id: b.dataset.rm }); await loadTools(); renderPlugins(); }; });
  q('[data-test]').forEach((b) => { b.onclick = async () => {
    const out = el.querySelector(`[data-res="${b.dataset.test}"]`); if (out) out.textContent = 'Đang thử…';
    const r = await api('POST', '/api/ai/mcp/test', { id: b.dataset.test });
    if (out) out.innerHTML = r.ok ? `✓ ${r.tools.length} lệnh: ${r.tools.slice(0, 12).map((t) => esc(t.name)).join(', ')}${r.tools.length > 12 ? '…' : ''}` : `<span class="err">${esc(r.error)}</span>`;
    await loadTools();
  }; });
  $('mxKind').onchange = () => { const st = $('mxKind').value === 'mcp-stdio'; $('mxUrlL').hidden = st; $('mxCmdL').hidden = !st; };
  $('mxAdd').onclick = async () => { try { await api('POST', '/api/ai/mcp/servers', { name: $('mxName').value, kind: $('mxKind').value, url: $('mxUrl').value, command: $('mxCmd').value, args: $('mxArgs').value, token: $('mxTok').value }); await loadTools(); renderPlugins(); } catch (e) { $('mxErr').textContent = e.message; } };
  if (gw) {
    $('gwTog').onclick = async () => { await api('POST', '/api/ai/gateway', { enabled: !gw.enabled }); renderPlugins(); };
    $('gwMode').onchange = async (e) => { await api('POST', '/api/ai/gateway', { mode: e.target.value }); };
    $('gwClaude').onclick = async () => { try { const r = await api('POST', '/api/ai/gateway/claude-desktop'); $('gwClaudeRes').textContent = r.error ? r.error : `Đã ghi ${r.path}. ${r.note}${gw.enabled ? '' : ' Nhớ bật cổng.'}`; } catch (e) { $('gwClaudeRes').textContent = e.message; } };
    $('gwShow').onclick = async () => { const g = await api('GET', '/api/ai/gateway'); $('gwCursor').textContent = JSON.stringify(g.cursor, null, 2); };
    $('gwNew').onclick = async () => { if (!confirm('Đổi mã khoá? Client HTTP đang dùng mã cũ phải cập nhật lại.')) return; await api('POST', '/api/ai/gateway', { newToken: true }); renderPlugins(); };
  }
}

// ---------- khởi động ----------
(async () => {
  renderAcct(); renderModelBtn();
  const [c, p] = await Promise.all([api('GET', '/api/ai/chats').catch(() => ({ chats: [] })), api('GET', '/api/ai/projects').catch(() => ({ projects: [] }))]);
  S.chats = c.chats || []; S.projects = p.projects || [];
  if (S.projectId && !project(S.projectId)) S.projectId = null;
  await loadApps(); renderAll();
  await Promise.all([loadAccount(), loadTools(), refreshLlm()]);
  renderAll();
  const h = location.hash.slice(1);
  if (['plugins', 'projects', 'flows', 'agents'].includes(h)) go(h);
  if (h === 'model') $('modelBtn').click();
  if (!S.account.linked && !store.get('sc.offlineOk', false)) { openLogin(); store.set('sc.offlineOk', true); }
  setInterval(() => { if (!S.busy) loadApps(); }, 20000);
})();
})();
