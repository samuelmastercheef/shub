// Socin Studio: menu Flow (thiết kế luồng công việc kéo thả cho agent) và menu Agent (tạo, quản lý, giao việc).
// Gắn vào chat.js qua window.FlowUI.render(view, el, h). Dữ liệu và chạy ở server: /api/flow/*.
(() => {
'use strict';
const FC = window.FlowCore, A = window.AICore;
const T = FC.TYPES;
let H = null; // trợ giúp từ chat.js: { api, esc, head(title, crumbHtml), tools(), loadTools(), projects(), goChat(text) }
const esc = (s) => H.esc(s);
const uid = (t) => t + '-' + Math.random().toString(36).slice(2, 6);
const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'vừa xong' : s < 3600 ? Math.round(s / 60) + ' phút trước' : s < 86400 ? Math.round(s / 3600) + ' giờ trước' : new Date(t).toLocaleDateString('vi-VN'); };
const ST = { running: 'Đang chạy', waiting: 'Chờ duyệt', done: 'Xong', error: 'Lỗi', stopped: 'Đã dừng', skipped: 'Bỏ qua' };
const ACCESS = { read: 'xem', edit: 'thao tác', files: 'lớn, hỏi trước', paid: 'tốn phí' };
const groupOf = (t) => (/^mcp_/.test(t.name) ? (t.title || '').split(':')[0] || 'MCP' : t.plugin === 'socin' ? 'Socin' : t.plugin === 'flow' ? 'Flow' : 'S Hub');
const toast = (m, bad) => { let x = document.getElementById('fxToast'); if (!x) { x = document.createElement('div'); x.id = 'fxToast'; document.body.appendChild(x); } x.textContent = m; x.className = bad ? 'bad' : ''; x.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (x.hidden = true), 4200); };
let agentsCache = [];
const CONN_LABEL = (k) => (k === 'shub' ? 'S Hub' : k === 'socin' ? 'Socin' : k.startsWith('mcp:') ? 'MCP ' + k.slice(4) : k);
const CONN_ICON = (k) => (k === 'shub' ? '🧭' : k === 'socin' ? '🌐' : '🧩');
function conns() { const m = {}; H.tools().filter((t) => t.plugin !== 'flow').forEach((t) => { const k = FC.connOf(t); (m[k] = m[k] || []).push(t); }); return m; }
/** Kết nối agent đang dùng (rỗng tools = mọi kết nối hợp quyền). */
function agentConns(a) { const m = conns(); return Object.keys(m).filter((k) => (a.tools.length ? m[k].some((t) => a.tools.includes(t.name)) : m[k].some((t) => A.allowedBy(a.mode, t.access)))); }
async function saveAgent(a) { const r = await H.api('POST', '/api/flow/agents/save', { agent: a }); if (r.error) throw new Error(r.error); agentsCache = r.agents; return r.agent; }
/** Gắn / gỡ cả nhóm lệnh của một kết nối cho agent. */
async function toggleConn(a, k, on) {
  const m = conns(); let tools = a.tools.length ? a.tools.slice() : Object.values(m).flat().filter((t) => A.allowedBy(a.mode, t.access)).map((t) => t.name);
  const names = (m[k] || []).map((t) => t.name);
  tools = on ? [...new Set([...tools, ...names])] : tools.filter((n) => !names.includes(n));
  if (!tools.length) throw new Error('Agent cần ít nhất một kết nối');
  return saveAgent({ ...a, tools });
}
const loadAgents = async () => { try { agentsCache = (await H.api('GET', '/api/flow/agents')).agents || []; } catch { agentsCache = []; } return agentsCache; };

// ===================================================== lượt chạy (dùng chung)
let pollT = null;
function stopPoll() { clearTimeout(pollT); pollT = null; }
/** Hiện một lượt chạy trong el, tự cập nhật đến khi xong. onStep(run) để tô màu bước trên khung. */
function watchRun(el, runId, onStep) {
  stopPoll();
  const tick = async () => {
    let r; try { r = (await H.api('GET', '/api/flow/run?id=' + encodeURIComponent(runId))).run; } catch (e) { el.innerHTML = `<p class="fx-err">${esc(e.message)}</p>`; return; }
    if (!el.isConnected) return;
    renderRun(el, r); onStep && onStep(r);
    if (r.status === 'running' || r.status === 'waiting') pollT = setTimeout(tick, r.status === 'waiting' ? 1500 : 700);
  };
  tick();
}
function renderRun(el, r) {
  const open = new Set([...el.querySelectorAll('details[open]')].map((d) => d.dataset.k));
  const live = r.status === 'running' || r.status === 'waiting';
  const p = r.pending;
  el.innerHTML = `<div class="fx-runhd"><span class="fx-st ${r.status}">${ST[r.status] || r.status}</span><b>${esc(r.icon || '')} ${esc(r.title)}</b><span class="mut sm">${ago(r.startedAt)}${r.endedAt ? ' · ' + ((r.endedAt - r.startedAt) / 1000).toFixed(1) + ' giây' : ''}${r.via && r.via !== 'tay' ? ' · từ ' + esc(r.via) : ''}</span><span class="flex"></span>${live ? '<button class="ghost sm" data-stop>Dừng</button>' : ''}</div>
    ${p ? `<div class="fx-ask"><b>${p.kind === 'tool' ? '⚠ ' : '✋ '}${esc(p.title)}</b>${p.detail ? `<pre>${esc(p.detail)}</pre>` : ''}<div class="row"><button class="cta sm" data-d="ok">${p.kind === 'tool' ? 'Cho phép' : 'Duyệt'}</button><button class="ghost sm" data-d="no">Từ chối</button></div></div>` : ''}
    ${r.error ? `<p class="fx-err">${esc(r.error)}</p>` : ''}
    <ol class="fx-steps">${r.steps.map((s, i) => `<li class="${s.status}"><details data-k="${i}" ${open.has(String(i)) || (s.status === 'error') || (i === r.steps.length - 1 && r.status !== 'running') ? 'open' : ''}><summary><i style="background:${(T[s.type] || {}).color || '#999'}"></i><b>${esc(s.name)}</b><span class="mut sm">${esc((T[s.type] || {}).label || s.type)}${s.agent ? ' · ' + esc(s.agent) : ''}${s.engine ? ' · ' + (s.engine === 'socin' ? 'AI Socin' : s.engine === 'device' ? 'trên máy' : 'bộ hiểu lệnh') : ''}${s.port ? ' → ' + esc(FC.PORT_LABEL[s.port] || s.port) : ''}</span><span class="flex"></span><span class="fx-st ${s.status}">${ST[s.status] || s.status}${s.endedAt ? ' · ' + ((s.endedAt - s.startedAt) / 1000).toFixed(1) + 's' : ''}</span></summary>
      ${(s.calls || []).map((c) => `<div class="fx-call ${c.ok === false ? 'bad' : ''}"><code>${esc(c.name)}</code> <span class="mut sm">${esc(JSON.stringify(c.input)).slice(0, 160)}</span>${c.out ? `<pre>${esc(c.out)}</pre>` : ''}</div>`).join('')}
      ${s.note ? `<div class="mut sm">${esc(s.note)}</div>` : ''}${s.out ? `<pre>${esc(s.out)}</pre>` : ''}</details></li>`).join('')}</ol>
    ${r.status === 'done' && r.result ? `<div class="fx-result"><div class="mut sm">Kết quả</div><div class="fx-md">${esc(r.result)}</div></div>` : ''}`;
  el.querySelectorAll('[data-d]').forEach((b) => { b.onclick = async () => { b.disabled = true; try { await H.api('POST', '/api/flow/run/decide', { id: r.id, decision: b.dataset.d }); } catch (e) { toast(e.message, 1); } watchRun(el, r.id, el._onStep); }; });
  const sb = el.querySelector('[data-stop]'); if (sb) sb.onclick = async () => { await H.api('POST', '/api/flow/run/stop', { id: r.id }).catch(() => {}); watchRun(el, r.id, el._onStep); };
}
const runRow = (r) => `<li data-run="${esc(r.id)}"><span class="fx-st ${r.status}">${ST[r.status] || r.status}</span><span class="nm">${esc(r.icon || '')} ${esc(r.title)}</span><span class="mut sm">${r.via && r.via !== 'tay' ? esc(r.via) + ' · ' : ''}${ago(r.startedAt)}</span></li>`;

// ===================================================== menu Flow
const FV = { flow: null, sel: null, selE: null, V: { x: 40, y: 40, z: 1 }, dirty: false, st: {}, runId: null };
async function renderFlows(el, openId) {
  stopPoll(); FV.flow = null;
  if (openId) return openFlow(el, openId);
  H.head('Flow', 'Thiết kế luồng công việc cho agent: kéo thả bước, nối đường, chạy và duyệt');
  el.innerHTML = '<div class="page"><div class="pagein"><p class="mut">Đang tải…</p></div></div>';
  const [d, rs] = await Promise.all([H.api('GET', '/api/flow/flows').catch(() => ({ flows: [], templates: [] })), H.api('GET', '/api/flow/runs').catch(() => ({ runs: [] })), loadAgents()]);
  el.innerHTML = `<div class="page"><div class="pagein">
    <div class="fx-hero"><div><h2>Flow cho agent</h2><p class="mut">Ghép các bước: lệnh Socin, S Hub, MCP; hỏi AI; giao cho agent; rẽ nhánh; dừng chờ bạn duyệt. Chạy tay, theo giờ, hoặc nhờ trợ lý chat "chạy flow …".</p></div>
      <div class="fx-ai"><input id="fxAsk" placeholder="✨ Mô tả quy trình, ví dụ: mỗi sáng xem VPS, có lỗi thì báo và chờ mình duyệt khởi động lại"><button class="cta" id="fxAskGo">AI thiết kế</button><button class="ghost" id="fxNew">＋ Flow trống</button></div></div>
    <h2>Flow của bạn</h2>
    <div class="cards">${d.flows.map((f) => `<div class="pcard fx-card" data-open="${esc(f.id)}"><div class="hd"><span class="ic">${esc(f.icon)}</span><b>${esc(f.name)}</b></div><p>${esc(f.summary || 'Chưa có mô tả')}</p>
      <div class="fx-chips">${Object.entries(f.types).map(([k, v]) => `<span class="fx-chip"><i style="background:${T[k].color}"></i>${T[k].label}${v > 1 ? ' ×' + v : ''}</span>`).join('')}</div>
      <div class="ft"><span class="tag">${f.steps} bước</span>${f.schedule ? `<span class="tag">⏰ ${esc(f.schedule)} hằng ngày</span>` : ''}<span class="flex"></span><button class="ghost sm" data-run="${esc(f.id)}">▶ Chạy</button><button class="ghost sm" data-del="${esc(f.id)}">Xoá</button></div></div>`).join('') || '<p class="mut">Chưa có flow nào. Bắt đầu từ một mẫu bên dưới hoặc nhờ AI thiết kế.</p>'}</div>
    <h2>Mẫu có sẵn</h2>
    <div class="cards">${d.templates.map((t) => `<div class="pcard fx-card" data-tpl="${esc(t.id)}"><div class="hd"><span class="ic">${esc(t.icon)}</span><b>${esc(t.name)}</b></div><p>${esc(t.summary)}</p><div class="ft"><span class="tag">${t.steps} bước</span><span class="flex"></span><button class="ghost sm">Dùng mẫu</button></div></div>`).join('')}</div>
    <h2>Lượt chạy gần đây</h2>
    <ul class="fx-runs" id="fxRuns">${rs.runs.map(runRow).join('') || '<li class="mut">Chưa chạy lần nào.</li>'}</ul>
    <div class="box fx-runbox" id="fxRunBox" hidden></div>
  </div></div>`;
  const q = (s) => el.querySelectorAll(s);
  q('[data-open]').forEach((c) => { c.onclick = (e) => { if (e.target.closest('button')) return; openFlow(el, c.dataset.open); }; });
  q('[data-tpl]').forEach((c) => { c.onclick = async () => { const f = (await H.api('GET', '/api/flow/template?id=' + c.dataset.tpl)).flow; openEditor(el, f); }; });
  q('[data-del]').forEach((b) => { b.onclick = async () => { if (!confirm('Xoá flow này? Không hoàn tác được.')) return; await H.api('POST', '/api/flow/flow/delete', { id: b.dataset.del }); renderFlows(el); }; });
  q('.fx-card [data-run]').forEach((b) => { b.onclick = async () => { const r = (await H.api('POST', '/api/flow/flow/run', { id: b.dataset.run, input: '' })).run; showRunBox(el, r.id); }; });
  q('#fxRuns [data-run]').forEach((li) => { li.onclick = () => showRunBox(el, li.dataset.run); });
  el.querySelector('#fxNew').onclick = () => openEditor(el, { id: '', name: 'Flow mới', icon: '🔀', summary: '', mode: 'edit', nodes: [{ id: 'start', type: 'trigger', name: 'Bắt đầu', x: 60, y: 120, cfg: FC.defaultCfg('trigger') }], edges: [] });
  const ask = async () => { const v = el.querySelector('#fxAsk').value.trim(); if (!v) return toast('Hãy mô tả quy trình cần tạo', 1); const b = el.querySelector('#fxAskGo'); b.disabled = true; b.textContent = 'AI đang thiết kế…'; try { const r = await H.api('POST', '/api/flow/flow/suggest', { request: v }); if (r.error) throw new Error(r.error); openEditor(el, { ...r.flow, id: '' }); toast('AI đã đề xuất ' + r.flow.nodes.length + ' bước. Chỉnh rồi bấm Lưu.'); } catch (e) { toast(e.message, 1); } b.disabled = false; b.textContent = 'AI thiết kế'; };
  el.querySelector('#fxAskGo').onclick = ask; el.querySelector('#fxAsk').onkeydown = (e) => { if (e.key === 'Enter') ask(); };
}
function showRunBox(el, id) { const box = el.querySelector('#fxRunBox'); box.hidden = false; watchRun(box, id); box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
async function openFlow(el, id) { try { const f = (await H.api('GET', '/api/flow/flow?id=' + encodeURIComponent(id))).flow; openEditor(el, f); } catch (e) { toast(e.message, 1); renderFlows(el); } }

function openEditor(el, flow) {
  stopPoll();
  Object.assign(FV, { flow: JSON.parse(JSON.stringify(flow)), sel: null, selE: null, dirty: !flow.id, st: {}, runId: null, V: { x: 40, y: 40, z: 1 } });
  H.head(flow.name, '<a id="fxBack">Flow</a>'); document.getElementById('fxBack').onclick = () => leave(el);
  el.innerHTML = `<div class="fe">
    <div class="fe-bar"><input id="feIcon" class="ic" value="${esc(flow.icon)}" maxlength="4" title="Biểu tượng"><input id="feName" class="nm" value="${esc(flow.name)}" placeholder="Tên flow">
      <label class="mut sm" title="Mức quyền khi bước Lệnh chạy">Quyền lệnh <select id="feMode">${Object.entries(FC.MODES).map(([k, v]) => `<option value="${k}" ${flow.mode === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <span class="flex"></span><input id="feIn" class="in" placeholder="Dữ liệu vào khi chạy (bỏ trống = mẫu)"><button class="cta" id="feSave">Lưu</button></div>
    <div class="fe-sum"><input id="feSum" value="${esc(flow.summary)}" placeholder="Mô tả ngắn: flow này làm gì"><span class="fe-warn" id="feWarn"></span></div>
    <div class="fe-main"><aside class="fe-pal"><h3>Kéo bước vào khung</h3>${Object.entries(T).map(([k, t]) => `<div class="fe-pi" draggable="true" data-t="${k}"><i style="background:${t.color}">${t.icon}</i><div><b>${t.label}</b><small>${t.desc}</small></div></div>`).join('')}<h3 class="sp">Agent của bạn</h3><div id="fePalAg"></div><div class="fe-agai"><input id="feAgAsk" placeholder="✨ Mô tả agent cần tạo"><button class="ghost sm" id="feAgGo">Tạo bằng AI</button></div>
      <h3 class="sp">Kết nối</h3><div id="fePalCn"></div><p class="mut sm" style="margin-top:8px">Kéo kết nối thả lên một bước Agent để cho agent dùng; thả ra khung trống để tạo bước Lệnh. Nhấp đúp để thêm vào giữa khung.</p></aside>
      <div class="fe-cv" id="feCv"><div class="fe-world" id="feWorld"><svg class="fe-edges" id="feEdges"></svg><div id="feNodes"></div></div><div class="fe-dock"><button class="fe-runbtn" id="feRun" title="Chạy một lần"><span>▶</span></button><div class="fe-docklb"><b>Chạy một lần</b><small id="feDockSt">Lưu rồi chạy từ bước Bắt đầu</small></div><span class="fe-sep"></span><button class="fe-tb" id="feLay" title="Tự xếp gọn">⇶</button><button class="fe-tb" id="feFit" title="Vừa khung">⤢</button><button class="fe-tb" id="feZo" title="Thu nhỏ">−</button><button class="fe-tb" id="feZi" title="Phóng to">＋</button></div><div class="fe-hint">Bấm ＋ cạnh một bước để nối bước tiếp • kéo chấm sang bước khác để nối • Delete xoá</div><div class="fe-quick" id="feQuick" hidden></div></div>
      <aside class="fe-ins" id="feIns"></aside></div>
    <div class="fe-run" id="feRunP" hidden></div></div>`;
  const $ = (id) => el.querySelector('#' + id);
  const F = FV.flow;
  $('feName').oninput = (e) => { F.name = e.target.value; FV.dirty = true; H.head(F.name || 'Flow', '<a id="fxBack">Flow</a>'); document.getElementById('fxBack').onclick = () => leave(el); };
  $('feIcon').oninput = (e) => { F.icon = e.target.value; FV.dirty = true; };
  $('feSum').oninput = (e) => { F.summary = e.target.value; FV.dirty = true; };
  $('feMode').onchange = (e) => { F.mode = e.target.value; FV.dirty = true; };
  const cv = $('feCv');
  const toW = (cx, cy) => { const r = cv.getBoundingClientRect(); return [(cx - r.left - FV.V.x) / FV.V.z, (cy - r.top - FV.V.y) / FV.V.z]; };
  const center = () => { const r = cv.getBoundingClientRect(); return [(r.width / 2 - FV.V.x) / FV.V.z - 85, (r.height / 2 - FV.V.y) / FV.V.z - 36]; };
  const apply = () => { $('feWorld').style.transform = `translate(${FV.V.x}px,${FV.V.y}px) scale(${FV.V.z})`; };
  // Nút dạng bong bóng tròn (kiểu trình dựng kịch bản): tâm (x+85, y+36), bán kính 36
  const NW = 170, R = 36, cxy = (n) => [n.x + NW / 2, n.y + R];
  const outXY = (n, i) => { const [cx, cy] = cxy(n), k = T[n.type].outs.length; if (k <= 1) return [cx + R + 7, cy]; const a = (i === 0 ? -1 : 1) * 0.72; return [cx + (R + 7) * Math.cos(a), cy + (R + 7) * Math.sin(a)]; };
  const inXY = (n) => { const [cx, cy] = cxy(n); return [cx - R - 7, cy]; };
  const CONN_COLOR = { shub: '#0B7F8F', socin: '#2F6FED', flow: '#5F7A8A' };
  const look = (n) => {
    if (n.type === 'tool') { const t = H.tools().find((x) => x.name === n.cfg.tool); const k = t ? FC.connOf(t) : n.cfg.conn || ''; return { icon: k ? CONN_ICON(k) : T.tool.icon, color: CONN_COLOR[k] || (k.startsWith('mcp:') ? '#7A5AF8' : T.tool.color), sub: t ? t.title : k ? CONN_LABEL(k) : T.tool.label }; }
    if (n.type === 'agent') { const a = agentsCache.find((x) => x.id === n.cfg.agentId); return { icon: a ? a.icon : T.agent.icon, color: T.agent.color, sub: a ? 'Agent · ' + a.name : 'Agent' }; }
    return { icon: T[n.type].icon, color: T[n.type].color, sub: T[n.type].label };
  };
  let lastAdd = null;
  function add(type, x, y) { const n = { id: uid(type), type, name: T[type].label + ' ' + (F.nodes.filter((a) => a.type === type).length + 1), x: Math.round(x), y: Math.round(y), cfg: FC.defaultCfg(type) }; F.nodes.push(n); lastAdd = n; FV.sel = n.id; FV.selE = null; FV.dirty = true; draw(); return n; }
  function palette() {
    $('fePalAg').innerHTML = agentsCache.map((a) => `<div class="fe-pi" draggable="true" data-d="ag:${esc(a.id)}"><i style="background:${T.agent.color}">${esc(a.icon)}</i><div><b>${esc(a.name)}</b><small>${esc((a.role || '').slice(0, 60))}</small></div></div>`).join('') || '<p class="mut sm">Chưa có agent.</p>';
    $('fePalCn').innerHTML = Object.entries(conns()).map(([k, list]) => `<div class="fe-pi cn" draggable="true" data-d="cn:${esc(k)}"><i style="background:${T.tool.color}">${CONN_ICON(k)}</i><div><b>${esc(CONN_LABEL(k))}</b><small>${list.length} lệnh</small></div></div>`).join('');
    el.querySelectorAll('.fe-pi').forEach((p) => { p.ondragstart = (e) => { e.dataTransfer.setData('text/plain', p.dataset.d || 't:' + p.dataset.t); }; p.ondblclick = () => drop(p.dataset.d || 't:' + p.dataset.t, ...center(), null); });
  }
  async function drop(d, x, y, target) {
    const [kind, v] = [d.slice(0, d.indexOf(':')), d.slice(d.indexOf(':') + 1)];
    if (kind === 't' && T[v]) return add(v, x, y);
    if (kind === 'ag') { add('agent', x, y); const n = F.nodes[F.nodes.length - 1]; const a = agentsCache.find((z) => z.id === v); n.cfg.agentId = v; if (a) n.name = a.name; return draw(); }
    if (kind === 'cn') {
      const tn = target && F.nodes.find((n) => n.id === target);
      if (tn && tn.type === 'agent') {
        const a = agentsCache.find((z) => z.id === tn.cfg.agentId); if (!a) return toast('Chọn agent cho bước này trước', 1);
        try { await toggleConn(a, v, true); toast(`Đã gắn ${CONN_LABEL(v)} cho agent ${a.name}`); FV.sel = tn.id; draw(); } catch (e) { toast(e.message, 1); } return;
      }
      add('tool', x, y); const n = F.nodes[F.nodes.length - 1]; n.cfg.conn = v; n.name = CONN_LABEL(v); return draw();
    }
  }
  cv.ondragover = (e) => e.preventDefault();
  cv.ondrop = (e) => { e.preventDefault(); const d = e.dataTransfer.getData('text/plain'); const [x, y] = toW(e.clientX, e.clientY); const t = e.target.closest && e.target.closest('.fe-nd'); drop(d, x - 85, y - 36, t ? t.dataset.id : null); };
  const agAsk = async () => { const v = $('feAgAsk').value.trim(); if (!v) return toast('Mô tả agent cần tạo', 1); const b = $('feAgGo'); b.disabled = true; b.textContent = 'AI đang tạo…'; try { const r = await H.api('POST', '/api/flow/agents/suggest', { request: v }); if (r.error) throw new Error(r.error); const a = await saveAgent(r.agent); $('feAgAsk').value = ''; palette(); const [x, y] = center(); drop('ag:' + a.id, x, y, null); toast(`Đã tạo agent ${a.name} (${a.tools.length} lệnh) và thêm vào flow`); } catch (e) { toast(e.message, 1); } b.disabled = false; b.textContent = 'Tạo bằng AI'; };
  $('feAgGo').onclick = agAsk; $('feAgAsk').onkeydown = (e) => { if (e.key === 'Enter') agAsk(); };
  palette();
  const bodyOf = (n) => {
    const c = n.cfg;
    if (n.type === 'trigger') return c.schedule ? `⏰ ${c.schedule} hằng ngày` + (c.sample ? ' · ' + c.sample : '') : c.sample || 'Chạy tay hoặc từ chat';
    if (n.type === 'ai') return (c.prompt || '').replace(/\s+/g, ' ');
    if (n.type === 'agent') { const a = agentsCache.find((x) => x.id === c.agentId); return a ? `${a.icon} ${a.name} · ${agentConns(a).map(CONN_LABEL).join(', ') || 'chưa có kết nối'}` : '⚠ Chưa chọn agent'; }
    if (n.type === 'tool') { const t = H.tools().find((x) => x.name === c.tool); return c.tool ? (t ? t.title : c.tool) + (c.args && c.args !== '{}' ? ' ' + c.args : '') : '⚠ Chưa chọn lệnh'; }
    if (n.type === 'condition') return c.how === 'empty' ? 'Dữ liệu rỗng?' : `${FC.HOW[c.how]}: ${c.value || '…'}`;
    if (n.type === 'approval') return c.message;
    return c.template === '{{input}}' ? 'Gom kết quả' : c.template;
  };
  function draw() {
    apply();
    const free = new Set(); F.nodes.forEach((n) => T[n.type].outs.forEach((o) => { if (!F.edges.some((e) => e.from === n.id && e.port === o)) free.add(n.id + '|' + o); }));
    $('feNodes').innerHTML = F.nodes.map((n) => { const t = T[n.type], L = look(n), s = FV.st[n.id] || ''; const [cx, cy] = cxy(n);
      return `<div class="fe-nd ${n.id === FV.sel ? 'sel' : ''} ${s}" data-id="${esc(n.id)}" style="left:${n.x}px;top:${n.y}px;--c:${L.color}">
      <div class="bub" title="${esc(bodyOf(n))}"><span class="ico">${esc(L.icon)}</span>${n.type !== 'tool' && n.type !== 'agent' ? '' : `<span class="badge">${t.icon}</span>`}${s ? `<span class="stb ${s}"></span>` : ''}</div>
      <div class="lb"><b>${esc(n.name)}</b><small>${esc(L.sub)}</small><em>${esc(bodyOf(n).slice(0, 60))}</em></div>
      ${t.ins === false ? '' : `<span class="in" style="left:${inXY(n)[0] - n.x - 6}px;top:${inXY(n)[1] - n.y - 6}px"></span>`}
      ${t.outs.map((o, i) => { const [ox, oy] = outXY(n, i); return `<span class="out" data-p="${o}" style="left:${ox - n.x - 7}px;top:${oy - n.y - 7}px"></span>${free.has(n.id + '|' + o) && (n.id === FV.sel || F.nodes.length < 12) ? `<button class="plus" data-p="${o}" title="Thêm bước tiếp theo${FC.PORT_LABEL[o] ? ' (' + FC.PORT_LABEL[o] + ')' : ''}" style="left:${ox - n.x + (t.outs.length > 1 ? 18 : 22)}px;top:${oy - n.y - 13 + (t.outs.length > 1 ? (i ? 10 : -10) : 0)}px">＋${t.outs.length > 1 ? `<i>${FC.PORT_LABEL[o]}</i>` : ''}</button>` : ''}`; }).join('')}</div>`; void cx; void cy; }).join('');
    edges(); inspector(); warn();
  }
  function edges(tmp) {
    const g = [];
    F.edges.forEach((e, i) => { const a = F.nodes.find((n) => n.id === e.from), b = F.nodes.find((n) => n.id === e.to); if (!a || !b) return; const ai = Math.max(0, T[a.type].outs.indexOf(e.port)); const [x1, y1] = outXY(a, ai), [x2, y2] = inXY(b), dx = Math.max(40, Math.abs(x2 - x1) / 2);
      const d = `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
      g.push(`<path class="hit" data-e="${i}" d="${d}"/><path data-e="${i}" class="ln ${FV.selE === i ? 'sel' : ''} p-${e.port}" d="${d}"/>`);
      if (FC.PORT_LABEL[e.port]) { const mx = (x1 + x2) / 2, my = (y1 + y2) / 2; g.push(`<g class="pill p-${e.port}"><rect x="${mx - 24}" y="${my - 10}" width="48" height="20" rx="10"/><text x="${mx}" y="${my + 4}" text-anchor="middle">${FC.PORT_LABEL[e.port]}</text></g>`); } });
    if (tmp) g.push(`<path class="ln tmp" d="M${tmp[0]} ${tmp[1]} C${tmp[0] + 60} ${tmp[1]} ${tmp[2] - 60} ${tmp[3]} ${tmp[2]} ${tmp[3]}"/>`);
    $('feEdges').innerHTML = g.join('');
  }
  // menu thêm nhanh khi bấm ＋
  function quick(nodeId, port, px, py) {
    const q = $('feQuick'); const src = F.nodes.find((n) => n.id === nodeId); const r = cv.getBoundingClientRect();
    const items = [...Object.entries(T).filter(([k]) => k !== 'trigger').map(([k, t]) => ({ d: 't:' + k, icon: t.icon, color: t.color, l: t.label, s: t.desc })),
      ...agentsCache.map((a) => ({ d: 'ag:' + a.id, icon: a.icon, color: T.agent.color, l: a.name, s: 'Agent' })),
      ...Object.entries(conns()).map(([k, list]) => ({ d: 'cn:' + k, icon: CONN_ICON(k), color: CONN_COLOR[k] || '#7A5AF8', l: CONN_LABEL(k), s: list.length + ' lệnh' }))];
    q.innerHTML = `<input placeholder="Tìm bước, agent, kết nối…" id="feQs"><div class="qi">${items.map((it, i) => `<button data-i="${i}"><i style="background:${it.color}">${esc(it.icon)}</i><span><b>${esc(it.l)}</b><small>${esc(it.s)}</small></span></button>`).join('')}</div>`;
    q.hidden = false; q.style.left = Math.min(px - r.left, r.width - 280) + 'px'; q.style.top = Math.min(py - r.top, r.height - 330) + 'px';
    const close = () => { q.hidden = true; removeEventListener('pointerdown', off, true); };
    const off = (e) => { if (!q.contains(e.target)) close(); }; setTimeout(() => addEventListener('pointerdown', off, true), 0);
    q.querySelector('#feQs').oninput = (e) => { const v = FC.norm(e.target.value); q.querySelectorAll('.qi button').forEach((b) => (b.hidden = v && !FC.norm(b.textContent).includes(v))); };
    q.querySelector('#feQs').focus();
    q.querySelectorAll('.qi button').forEach((b) => { b.onclick = async () => { close(); const it = items[+b.dataset.i]; const i = T[src.type].outs.indexOf(port), k = T[src.type].outs.length; lastAdd = null; await drop(it.d, src.x + 230, src.y + (k > 1 ? (i ? 90 : -90) : 0), null); if (lastAdd) { F.edges.push({ from: src.id, to: lastAdd.id, port }); FV.sel = lastAdd.id; FV.dirty = true; draw(); } }; });
  }
  function warn() { const w = FC.check(F, { tools: H.tools(), agents: agentsCache }); $('feWarn').textContent = w.length ? '⚠ ' + w[0] + (w.length > 1 ? ` (+${w.length - 1})` : '') : '✓ Sẵn sàng chạy'; $('feWarn').className = 'fe-warn ' + (w.length ? 'w' : 'ok'); $('feWarn').title = w.join('\n'); }
  cv.addEventListener('pointerdown', (e) => {
    const plus = e.target.closest('.plus'); if (plus) { e.stopPropagation(); quick(plus.closest('.fe-nd').dataset.id, plus.dataset.p, e.clientX, e.clientY); return; }
    const out = e.target.closest('.out'), nd = e.target.closest('.fe-nd'), hd = e.target.closest('.fe-nd .bub, .fe-nd .lb');
    if (out) {
      e.preventDefault(); const n = F.nodes.find((x) => x.id === nd.dataset.id), p = out.dataset.p, i = T[n.type].outs.indexOf(p); const [sx, sy] = outXY(n, i);
      const mv = (ev) => { const [x, y] = toW(ev.clientX, ev.clientY); edges([sx, sy, x, y]); };
      const up = (ev) => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); const t = document.elementFromPoint(ev.clientX, ev.clientY), tn = t && t.closest('.fe-nd');
        if (tn && tn.dataset.id !== n.id && T[F.nodes.find((x) => x.id === tn.dataset.id).type].ins !== false && !F.edges.some((x) => x.from === n.id && x.to === tn.dataset.id && x.port === p)) { F.edges.push({ from: n.id, to: tn.dataset.id, port: p }); FV.dirty = true; }
        edges(); warn(); };
      addEventListener('pointermove', mv); addEventListener('pointerup', up); return;
    }
    if (e.target.closest('.fe-edges path[data-e]')) { FV.selE = +e.target.closest('path').dataset.e; FV.sel = null; edges(); inspector(); return; }
    if (nd) {
      FV.sel = nd.dataset.id; FV.selE = null; const n = F.nodes.find((x) => x.id === FV.sel);
      if (hd) { const ox = e.clientX, oy = e.clientY, nx = n.x, ny = n.y; const mv = (ev) => { n.x = Math.round(nx + (ev.clientX - ox) / FV.V.z); n.y = Math.round(ny + (ev.clientY - oy) / FV.V.z); nd.style.left = n.x + 'px'; nd.style.top = n.y + 'px'; edges(); FV.dirty = true; }; const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); }; addEventListener('pointermove', mv); addEventListener('pointerup', up); }
      el.querySelectorAll('.fe-nd').forEach((x) => x.classList.toggle('sel', x.dataset.id === FV.sel)); edges(); inspector(); return;
    }
    FV.sel = null; FV.selE = null; cv.classList.add('pan'); const ox = e.clientX, oy = e.clientY, vx = FV.V.x, vy = FV.V.y;
    const mv = (ev) => { FV.V.x = vx + ev.clientX - ox; FV.V.y = vy + ev.clientY - oy; apply(); }; const up = () => { cv.classList.remove('pan'); removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); el.querySelectorAll('.fe-nd.sel').forEach((x) => x.classList.remove('sel')); edges(); inspector();
  });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(), k = Math.exp(-e.deltaY * 0.0015), z = Math.min(1.8, Math.max(0.3, FV.V.z * k)), mx = e.clientX - r.left, my = e.clientY - r.top; FV.V.x = mx - ((mx - FV.V.x) * z) / FV.V.z; FV.V.y = my - ((my - FV.V.y) * z) / FV.V.z; FV.V.z = z; apply(); }, { passive: false });
  const onKey = (e) => { if (!el.isConnected || !FV.flow) return removeEventListener('keydown', onKey); if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return; if (e.key === 'Delete' || e.key === 'Backspace') { if (FV.selE !== null) { F.edges.splice(FV.selE, 1); FV.selE = null; FV.dirty = true; draw(); } else if (FV.sel) delNode(FV.sel); } };
  addEventListener('keydown', onKey);
  function delNode(id) { F.nodes = F.nodes.filter((n) => n.id !== id); F.edges = F.edges.filter((x) => x.from !== id && x.to !== id); FV.sel = null; FV.dirty = true; draw(); }
  const nameOf = (id) => (F.nodes.find((n) => n.id === id) || {}).name || '?';
  function inspector() {
    const b = $('feIns');
    if (FV.selE !== null && F.edges[FV.selE]) { const e = F.edges[FV.selE]; b.innerHTML = `<h3>Đường nối</h3><p><b>${esc(nameOf(e.from))}</b>${FC.PORT_LABEL[e.port] ? ' [' + FC.PORT_LABEL[e.port] + ']' : ''} → <b>${esc(nameOf(e.to))}</b></p><button class="ghost sm" id="fiDelE">Xoá đường nối</button>`; b.querySelector('#fiDelE').onclick = () => { F.edges.splice(FV.selE, 1); FV.selE = null; FV.dirty = true; draw(); }; return; }
    const n = F.nodes.find((x) => x.id === FV.sel);
    if (!n) { b.innerHTML = `<h3>Cấu hình</h3><p class="mut">Chọn một bước để chỉnh.</p><div class="fe-tip"><b>Biến dữ liệu</b><p class="mut sm"><code>{{input}}</code> là kết quả bước ngay trước. <code>{{Tên bước}}</code> lấy kết quả của bước bất kỳ phía trước.</p></div><div class="fe-tip"><b>An toàn</b><p class="mut sm">Lệnh thay đổi lớn (triển khai, tạo bài, xoá…) luôn dừng chờ bạn cho phép. Bước <b>Chờ duyệt</b> dừng lại để bạn xem trước.</p></div>`; return; }
    const t = T[n.type], c = n.cfg;
    const fld = (k, label, kind, extra = '') => kind === 'a' ? `<label>${label}<textarea data-k="${k}" ${extra}>${esc(c[k])}</textarea></label>` : `<label>${label}<input data-k="${k}" value="${esc(c[k])}" ${extra}></label>`;
    const sel = (k, label, opts) => `<label>${label}<select data-k="${k}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${c[k] === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    let h = `<h3><i class="dot" style="background:${t.color}"></i>${t.label}</h3><label>Tên bước<input id="fiName" value="${esc(n.name)}"></label>`;
    if (n.type === 'trigger') h += fld('sample', 'Dữ liệu mẫu (dùng khi chạy không nhập gì)', 'a', 'rows="3"') + fld('schedule', 'Chạy hằng ngày lúc (HH:MM, bỏ trống = chạy tay)', 't', 'placeholder="08:00"');
    if (n.type === 'ai') h += fld('system', 'Vai trò của AI', 't', 'placeholder="Bạn là trợ lý vận hành…"') + fld('prompt', 'Câu hỏi / yêu cầu', 'a', 'rows="6"') + sel('model', 'Model', Object.entries(FC.MODELS));
    if (n.type === 'agent') h += sel('agentId', 'Agent thực hiện', [['', '— Chọn agent —'], ...agentsCache.map((a) => [a.id, a.icon + ' ' + a.name])]) + fld('task', 'Việc giao cho agent', 'a', 'rows="5"') + (() => { const a = agentsCache.find((x) => x.id === c.agentId); if (!a) return ''; const on = new Set(agentConns(a)); return `<div><b class="sm">Kết nối của agent</b><div class="fi-conns">${Object.entries(conns()).map(([k, list]) => `<label class="ag-t"><input type="checkbox" data-cn="${esc(k)}" ${on.has(k) ? 'checked' : ''}><span>${CONN_ICON(k)} ${esc(CONN_LABEL(k))}</span><em>${list.length} lệnh</em></label>`).join('')}</div><p class="mut sm">${FC.MODELS[a.model]} · ${FC.MODES[a.mode]} · ${a.tools.length ? a.tools.length + ' lệnh' : 'mọi lệnh hợp quyền'}. Có thể kéo kết nối từ cột trái thả lên bước này.</p></div>`; })()
        + `<p class="mut sm"><a id="fiEditAg">Sửa agent</a> · <a id="fiNewAg">＋ Tạo agent mới</a></p>`;
    if (n.type === 'tool') {
      const all = H.tools().filter((x) => !c.conn || FC.connOf(x) === c.conn); const list0 = () => true; const groups = {}; all.forEach((x) => (groups[groupOf(x)] = groups[groupOf(x)] || []).push(x));
      const def = all.find((x) => x.name === c.tool);
      const props = def && def.inputSchema && def.inputSchema.properties ? Object.entries(def.inputSchema.properties) : [];
      h += `<label>Lệnh<select data-k="tool"><option value="">— Chọn lệnh —</option>${Object.entries(groups).filter(([g]) => g !== 'Flow' && (!c.conn || list0(g, c.conn))).map(([g, list]) => `<optgroup label="${esc(g)}">${list.map((x) => `<option value="${esc(x.name)}" ${c.tool === x.name ? 'selected' : ''}>${esc(x.title || x.name)}</option>`).join('')}</optgroup>`).join('')}${c.tool && !def ? `<option selected value="${esc(c.tool)}">${esc(c.tool)} (không có trên máy)</option>` : ''}</select></label>`;
      if (def) h += `<p class="mut sm">${esc(def.description)}<br>Mức: <b>${ACCESS[def.access] || def.access}</b></p>`;
      h += fld('args', 'Tham số (JSON)', 'a', 'rows="4" spellcheck="false" class="mono"') + (props.length ? `<p class="mut sm">Tham số: ${props.map(([k, v]) => `<code>${esc(k)}</code> ${esc(v.description || '')}`).join(' · ')}</p>` : '');
    }
    if (n.type === 'condition') h += sel('how', 'Kiểu so sánh', Object.entries(FC.HOW)) + (c.how === 'empty' ? '' : fld('value', c.how === 'ai' ? 'Câu hỏi Có / Không' : 'Chữ cần tìm (nhiều cụm cách nhau bởi |)', c.how === 'ai' ? 'a' : 't')) + '<p class="mut sm">Cổng <b>Đúng</b> ở trên, <b>Sai</b> ở dưới.</p>';
    if (n.type === 'approval') h += fld('message', 'Điều cần duyệt', 'a', 'rows="3"') + '<p class="mut sm">Flow dừng tại đây, hiện nút Duyệt / Từ chối. Duyệt đi cổng trên, từ chối đi cổng dưới.</p>';
    if (n.type === 'output') h += fld('template', 'Mẫu kết quả', 'a', 'rows="4"');
    h += `<button class="ghost sm fi-del" id="fiDel">Xoá bước</button>`;
    b.innerHTML = h;
    b.querySelector('#fiName').oninput = (e) => { n.name = e.target.value; FV.dirty = true; const x = el.querySelector(`.fe-nd[data-id="${n.id}"] .lb b`); if (x) x.textContent = n.name; };
    b.querySelectorAll('[data-k]').forEach((i) => { const ev = i.tagName === 'SELECT' ? 'onchange' : 'oninput'; i[ev] = () => { c[i.dataset.k] = i.value; FV.dirty = true; const x = el.querySelector(`.fe-nd[data-id="${n.id}"] .lb em`); if (x) x.textContent = bodyOf(n).slice(0, 60); warn(); if (i.tagName === 'SELECT') { if (i.dataset.k === 'tool' && (!c.args || c.args === '{}')) { const d = H.tools().find((x) => x.name === c.tool); const req = d && d.inputSchema && d.inputSchema.required; c.args = req && req.length ? JSON.stringify(Object.fromEntries(req.map((k) => [k, '']))) : '{}'; } inspector(); } }; });
    b.querySelectorAll('[data-cn]').forEach((i) => { i.onchange = async () => { const a = agentsCache.find((x) => x.id === c.agentId); try { await toggleConn(a, i.dataset.cn, i.checked); draw(); } catch (e) { toast(e.message, 1); i.checked = !i.checked; } }; });
    const ea = b.querySelector('#fiEditAg'); if (ea) ea.onclick = () => { if (FV.dirty && !confirm('Rời trang thiết kế? Thay đổi chưa lưu sẽ mất.')) return; FV.dirty = false; H.go('agents', c.agentId); };
    const na = b.querySelector('#fiNewAg'); if (na) na.onclick = () => { if (FV.dirty && !confirm('Rời trang thiết kế? Thay đổi chưa lưu sẽ mất.')) return; FV.dirty = false; H.go('agents'); };
    b.querySelector('#fiDel').onclick = () => delNode(n.id);
  }
  function fit() { if (!F.nodes.length) return; const r = cv.getBoundingClientRect(); const x0 = Math.min(...F.nodes.map((n) => n.x)), y0 = Math.min(...F.nodes.map((n) => n.y)), x1 = Math.max(...F.nodes.map((n) => n.x + NW + 40)), y1 = Math.max(...F.nodes.map((n) => n.y + 140)); FV.V.z = Math.min(1.1, Math.max(0.3, Math.min((r.width - 60) / (x1 - x0), (r.height - 60) / (y1 - y0)))); FV.V.x = (r.width - (x1 - x0) * FV.V.z) / 2 - x0 * FV.V.z; FV.V.y = (r.height - (y1 - y0) * FV.V.z) / 2 - y0 * FV.V.z; apply(); }
  $('feLay').onclick = () => { FC.layout(F); FV.dirty = true; draw(); fit(); };
  $('feFit').onclick = fit;
  $('feZo').onclick = () => { FV.V.z = Math.max(0.3, FV.V.z / 1.2); apply(); };
  $('feZi').onclick = () => { FV.V.z = Math.min(1.8, FV.V.z * 1.2); apply(); };
  async function save() {
    F.name = $('feName').value.trim() || 'Flow'; if (!F.nodes.length) throw new Error('Kéo ít nhất một bước vào khung');
    const r = await H.api('POST', '/api/flow/flow/save', { id: F.id || undefined, flow: F }); if (r.error) throw new Error(r.error);
    F.id = r.flow.id; FV.dirty = false; toast('Đã lưu flow'); return r.flow;
  }
  $('feSave').onclick = () => save().catch((e) => toast(e.message, 1));
  $('feRun').onclick = async () => {
    try {
      await save(); FV.st = {}; draw();
      const r = (await H.api('POST', '/api/flow/flow/run', { id: F.id, input: $('feIn').value })).run;
      const p = $('feRunP'); p.hidden = false; p.innerHTML = ''; requestAnimationFrame(fit);
      p._onStep = (run) => { $('feDockSt').textContent = ({ running: 'Đang chạy…', waiting: 'Đang chờ bạn duyệt', done: 'Xong', error: 'Lỗi, xem bên dưới', stopped: 'Đã dừng' })[run.status] || run.status; $('feRun').classList.toggle('busy', run.status === 'running' || run.status === 'waiting'); FV.st = {}; run.steps.forEach((s) => { FV.st[s.id] = s.status === 'skipped' ? 'skip' : s.status; }); if (run.pending) FV.st[run.pending.stepId] = 'waiting'; el.querySelectorAll('.fe-nd').forEach((x) => { x.classList.remove('running', 'done', 'error', 'waiting', 'skip'); if (FV.st[x.dataset.id]) x.classList.add(FV.st[x.dataset.id]); }); };
      watchRun(p, r.id, p._onStep);
    } catch (e) { toast(e.message, 1); }
  };
  draw(); requestAnimationFrame(() => (F.nodes.length > 1 ? fit() : apply()));
}
function leave(el) { if (FV.dirty && !confirm('Rời trang thiết kế? Thay đổi chưa lưu sẽ mất.')) return; FV.dirty = false; renderFlows(el); }

// ===================================================== menu Agent
async function renderAgents(el, openId) {
  stopPoll();
  await loadAgents();
  if (openId) { const a = agentsCache.find((x) => x.id === openId); if (a) return openAgent(el, a); }
  H.head('Agent', 'Tạo agent thực thi việc và flow: vai trò, model, quyền, lệnh được phép');
  const [tpl, rs] = await Promise.all([H.api('GET', '/api/flow/agents').then((d) => d.templates || []).catch(() => []), H.api('GET', '/api/flow/runs').catch(() => ({ runs: [] }))]);
  const flows = (await H.api('GET', '/api/flow/flows').catch(() => ({ flows: [] }))).flows;
  el.innerHTML = `<div class="page"><div class="pagein">
    <div class="row"><p class="mut" style="margin:0;flex:1">Mỗi agent có vai trò, hướng dẫn riêng, model (AI Socin hoặc trên máy), mức quyền và danh sách lệnh được dùng. Agent làm việc trong bước <b>Agent</b> của flow, khi bạn giao việc trực tiếp, hoặc khi trợ lý chat nhờ.</p><button class="cta" id="agNew">＋ Agent mới</button></div>
    <div class="fx-ai" style="margin:4px 0 6px"><input id="agAsk" placeholder="✨ Mô tả agent bạn cần, ví dụ: agent theo dõi VPS, thấy ổ đĩa đầy thì báo và chờ mình duyệt dọn rác"><button class="cta" id="agAskGo">AI tạo agent</button></div>
    <div class="cards">${agentsCache.map((a) => `<div class="pcard fx-card" data-ag="${esc(a.id)}"><div class="hd"><span class="ic">${esc(a.icon)}</span><b>${esc(a.name)}</b></div><p>${esc(a.role || 'Chưa có vai trò')}</p>
      <div class="ft"><span class="tag">${FC.MODELS[a.model]}</span><span class="tag">${FC.MODES[a.mode]}</span><span class="tag">${a.tools.length ? a.tools.length + ' lệnh' : 'mọi lệnh hợp quyền'}</span>${a.flows.length ? `<span class="tag">${a.flows.length} flow</span>` : ''}</div></div>`).join('') || '<p class="mut">Chưa có agent. Tạo mới hoặc dùng mẫu bên dưới.</p>'}</div>
    <h2>Mẫu agent</h2>
    <div class="cards">${tpl.map((t, i) => `<div class="pcard fx-card" data-tpl="${i}"><div class="hd"><span class="ic">${esc(t.icon)}</span><b>${esc(t.name)}</b></div><p>${esc(t.role)}</p><div class="ft"><span class="tag">${FC.MODES[t.mode]}</span><span class="tag">${t.tools.length} lệnh</span><span class="flex"></span><button class="ghost sm">Tạo từ mẫu</button></div></div>`).join('')}</div>
    <h2>Việc agent đã làm</h2>
    <ul class="fx-runs" id="agRuns">${rs.runs.filter((r) => r.kind === 'agent').map(runRow).join('') || '<li class="mut">Chưa có.</li>'}</ul>
    <div class="box fx-runbox" id="fxRunBox" hidden></div>
  </div></div>`;
  el.querySelector('#agNew').onclick = () => openAgent(el, { id: '', name: 'Agent mới', icon: '🤖', role: '', instructions: '', model: 'auto', mode: 'edit', tools: [], flows: [], projectId: '', maxSteps: 8 });
  el.querySelectorAll('[data-ag]').forEach((c) => { c.onclick = () => openAgent(el, agentsCache.find((a) => a.id === c.dataset.ag)); });
  el.querySelectorAll('[data-tpl]').forEach((c) => { c.onclick = () => openAgent(el, { id: '', flows: [], projectId: '', maxSteps: 8, model: 'auto', ...tpl[+c.dataset.tpl] }); });
  const agAsk = async () => { const v = el.querySelector('#agAsk').value.trim(); if (!v) return toast('Mô tả agent cần tạo', 1); const b = el.querySelector('#agAskGo'); b.disabled = true; b.textContent = 'AI đang tạo…'; try { await H.loadTools(); const r = await H.api('POST', '/api/flow/agents/suggest', { request: v }); if (r.error) throw new Error(r.error); openAgent(el, r.agent); toast('AI đã đề xuất agent. Xem lại rồi bấm Lưu.'); } catch (e) { toast(e.message, 1); } b.disabled = false; b.textContent = 'AI tạo agent'; };
  el.querySelector('#agAskGo').onclick = agAsk; el.querySelector('#agAsk').onkeydown = (e) => { if (e.key === 'Enter') agAsk(); };
  el.querySelectorAll('#agRuns [data-run]').forEach((li) => { li.onclick = () => showRunBox(el, li.dataset.run); });
  void flows;
}
async function openAgent(el, a0) {
  stopPoll();
  const a = JSON.parse(JSON.stringify(a0));
  H.head(a.icon + ' ' + a.name, '<a id="agBack">Agent</a>'); document.getElementById('agBack').onclick = () => renderAgents(el);
  await H.loadTools();
  const flows = (await H.api('GET', '/api/flow/flows').catch(() => ({ flows: [] }))).flows;
  const all = H.tools().filter((t) => t.plugin !== 'flow');
  const groups = {}; all.forEach((t) => (groups[groupOf(t)] = groups[groupOf(t)] || []).push(t));
  el.innerHTML = `<div class="page"><div class="pagein ag-wrap">
    <div class="box form ag-form">
      <div class="row" style="flex-wrap:nowrap"><label style="width:80px">Biểu tượng<input id="agIcon" value="${esc(a.icon)}" maxlength="4"></label><label style="flex:1">Tên agent<input id="agName" value="${esc(a.name)}"></label></div>
      <label>Vai trò (một câu)<input id="agRole" value="${esc(a.role)}" placeholder="Ví dụ: Theo dõi VPS và báo sự cố"></label>
      <label>Hướng dẫn chi tiết<textarea id="agIns" rows="5" placeholder="Quy tắc, thứ tự làm việc, cách báo kết quả…">${esc(a.instructions)}</textarea></label>
      <div class="row"><label style="flex:1">Model<select id="agModel">${Object.entries(FC.MODELS).map(([k, v]) => `<option value="${k}" ${a.model === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label style="flex:1">Mức quyền<select id="agMode">${Object.entries(FC.MODES).map(([k, v]) => `<option value="${k}" ${a.mode === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label style="width:110px">Tối đa bước<input id="agSteps" type="number" min="1" max="20" value="${a.maxSteps}"></label></div>
      <label>Dự án làm ngữ cảnh<select id="agProj"><option value="">Không dùng</option>${H.projects().map((p) => `<option value="${esc(p.id)}" ${a.projectId === p.id ? 'selected' : ''}>${esc(p.icon + ' ' + p.name)}</option>`).join('')}</select></label>
      <div><div class="row"><b style="flex:1">Lệnh được dùng</b><span class="mut sm" id="agToolsN"></span><button class="ghost sm" id="agAll">Bỏ chọn hết (= mọi lệnh hợp quyền)</button></div>
        <div class="ag-tools" id="agTools">${Object.entries(groups).map(([g, list]) => `<fieldset><legend>${esc(g)}</legend>${list.map((t) => `<label class="ag-t" data-acc="${t.access}"><input type="checkbox" value="${esc(t.name)}" ${a.tools.includes(t.name) ? 'checked' : ''}><span>${esc(t.title || t.name)}</span><em>${ACCESS[t.access] || t.access}</em></label>`).join('')}</fieldset>`).join('')}</div></div>
      <div><b>Flow agent được chạy</b><div class="ag-flows">${flows.map((f) => `<label class="ag-t"><input type="checkbox" data-flow value="${esc(f.id)}" ${a.flows.includes(f.id) ? 'checked' : ''}><span>${esc(f.icon + ' ' + f.name)}</span></label>`).join('') || '<span class="mut sm">Chưa có flow. Tạo ở menu Flow.</span>'}</div></div>
      <div class="row"><span class="mut sm" id="agSaved"></span><span class="flex"></span>${a.id ? '<button class="ghost sm" id="agDel">Xoá agent</button>' : ''}<button class="cta" id="agSave">Lưu agent</button></div>
    </div>
    <div class="ag-side">
      <div class="box"><b>Giao việc</b><textarea id="agTask" rows="4" placeholder="Ví dụ: kiểm tra Zoom worker, nếu tắt thì bật lại rồi báo mình"></textarea><div class="row"><span class="mut sm">Lệnh lớn vẫn chờ bạn cho phép.</span><span class="flex"></span><button class="cta" id="agRun">▶ Giao việc</button></div></div>
      <div class="box fx-runbox" id="agRunBox" hidden></div>
      <div class="box"><b>Việc gần đây</b><ul class="fx-runs" id="agHist"><li class="mut">…</li></ul></div>
    </div></div></div>`;
  const $ = (id) => el.querySelector('#' + id);
  const shade = () => { const mode = $('agMode').value; el.querySelectorAll('#agTools .ag-t').forEach((l) => l.classList.toggle('off', !A.allowedBy(mode, l.dataset.acc))); const n = el.querySelectorAll('#agTools input:checked').length; $('agToolsN').textContent = n ? n + ' lệnh đã chọn' : 'mọi lệnh hợp quyền'; };
  $('agMode').onchange = shade; el.querySelectorAll('#agTools input').forEach((i) => (i.onchange = shade)); shade();
  $('agAll').onclick = () => { el.querySelectorAll('#agTools input').forEach((i) => (i.checked = false)); shade(); };
  const collect = () => ({ ...a, icon: $('agIcon').value, name: $('agName').value, role: $('agRole').value, instructions: $('agIns').value, model: $('agModel').value, mode: $('agMode').value, maxSteps: +$('agSteps').value || 8, projectId: $('agProj').value, tools: [...el.querySelectorAll('#agTools input:checked')].map((i) => i.value), flows: [...el.querySelectorAll('[data-flow]:checked')].map((i) => i.value) });
  const save = async () => { const r = await H.api('POST', '/api/flow/agents/save', { agent: collect() }); if (r.error) throw new Error(r.error); Object.assign(a, r.agent); agentsCache = r.agents; $('agSaved').textContent = 'Đã lưu ' + new Date().toLocaleTimeString('vi-VN'); H.head(a.icon + ' ' + a.name, '<a id="agBack">Agent</a>'); document.getElementById('agBack').onclick = () => renderAgents(el); return a; };
  $('agSave').onclick = () => save().catch((e) => toast(e.message, 1));
  if ($('agDel')) $('agDel').onclick = async () => { if (!confirm(`Xoá agent "${a.name}"? Flow đang dùng agent này sẽ báo lỗi ở bước Agent.`)) return; await H.api('POST', '/api/flow/agents/delete', { id: a.id }); renderAgents(el); };
  const hist = async () => { if (!a.id) { $('agHist').innerHTML = '<li class="mut">Lưu agent để giao việc.</li>'; return; } const rs = (await H.api('GET', '/api/flow/runs?agent=' + encodeURIComponent(a.id)).catch(() => ({ runs: [] }))).runs; $('agHist').innerHTML = rs.map(runRow).join('') || '<li class="mut">Chưa có.</li>'; el.querySelectorAll('#agHist [data-run]').forEach((li) => { li.onclick = () => { $('agRunBox').hidden = false; watchRun($('agRunBox'), li.dataset.run); }; }); };
  $('agRun').onclick = async () => {
    const task = $('agTask').value.trim(); if (!task) return toast('Nhập việc cần giao', 1);
    try { await save(); const r = (await H.api('POST', '/api/flow/agents/run', { id: a.id, task })).run; if (!r) throw new Error('Không bắt đầu được'); $('agRunBox').hidden = false; $('agRunBox')._onStep = (x) => { if (x.status !== 'running' && x.status !== 'waiting') hist(); }; watchRun($('agRunBox'), r.id, $('agRunBox')._onStep); } catch (e) { toast(e.message, 1); }
  };
  hist();
}

window.FlowUI = {
  render(view, el, h) { H = h; return view === 'flows' ? renderFlows(el, h.openId) : renderAgents(el, h.openId); },
  leave() { stopPoll(); if (FV.dirty && FV.flow) { const ok = confirm('Rời trang thiết kế? Thay đổi chưa lưu sẽ mất.'); if (ok) FV.dirty = false; return ok; } return true; },
};
})();
