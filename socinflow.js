// Socin Studio: Flow (thiết kế luồng công việc kéo thả) và Agent (tác tử thực thi).
// - Flow lưu ở <workspace>/socin-studio/flows/<id>.json, agent ở agents.json, lịch sử chạy ở runs.json.
// - Chạy ở server S Hub: bước Lệnh gọi sổ lệnh chung (S Hub, Socin, MCP), bước AI và Agent dùng model của Socin Studio
//   (AI Socin hoặc Ollama trên máy). Lệnh thay đổi lớn và bước Chờ duyệt dừng lại chờ người bấm Duyệt.
// - Thêm lệnh list_flows, run_flow, list_agents, ask_agent vào sổ lệnh để trợ lý chat (và AI khác qua MCP) dùng được.
const fs = require('fs');
const path = require('path');
const AI = require('./public/aicore.js');
const FC = require('./public/flowcore.js');

module.exports = function socinFlow({ WS, json, body, ai, now = () => Date.now(), tickMs = 30000 }) {
  const DIR = path.join(WS, 'socin-studio'); const FLOWS = path.join(DIR, 'flows');
  const F = { agents: path.join(DIR, 'agents.json'), runs: path.join(DIR, 'runs.json'), sched: path.join(DIR, 'flow-schedule.json') };
  fs.mkdirSync(FLOWS, { recursive: true });
  const rj = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const wj = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); };
  const bad = (m, code = 400) => { const e = new Error(m); e.code = code; throw e; };
  const ID = /^[\w-]{1,40}$/;
  const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'flow';

  // ---------- lưu trữ ----------
  const fp = (id) => path.join(FLOWS, id + '.json');
  const getFlow = (id) => (ID.test(String(id || '')) ? rj(fp(id), null) : null);
  const listFlows = () => { try { return fs.readdirSync(FLOWS).filter((f) => f.endsWith('.json')).map((f) => rj(path.join(FLOWS, f), null)).filter((x) => x && x.id).sort((a, b) => b.updated - a.updated); } catch { return []; } };
  const brief = (f) => ({ id: f.id, name: f.name, icon: f.icon, summary: f.summary, steps: f.nodes.length, schedule: (f.nodes.find((n) => n.type === 'trigger' && n.cfg.schedule) || { cfg: {} }).cfg.schedule || '', updated: f.updated, types: f.nodes.reduce((a, n) => ((a[n.type] = (a[n.type] || 0) + 1), a), {}) });
  function saveFlow(raw, id) {
    if (!id) { const base = slug(raw && raw.name); let n = base, i = 2; while (fs.existsSync(fp(n))) n = base + '-' + i++; id = n; }
    if (!ID.test(id)) bad('Mã flow không hợp lệ');
    if (!fs.existsSync(fp(id)) && listFlows().length >= FC.LIMITS.flows) bad('Đã đủ ' + FC.LIMITS.flows + ' flow, xoá bớt trước');
    const f = FC.cleanFlow({ ...raw, updated: now() }, id); wj(fp(id), f); return f;
  }
  const agents = () => { const a = rj(F.agents, []); return Array.isArray(a) ? a.map((x) => { try { return FC.cleanAgent(x); } catch { return null; } }).filter(Boolean) : []; };
  const findAgent = (k) => { const s = String(k || '').trim(); const list = agents(); return list.find((a) => a.id === s) || list.find((a) => FC.norm(a.name) === FC.norm(s)) || null; };
  const findFlow = (k) => { const s = String(k || '').trim(); return getFlow(s) || listFlows().find((f) => FC.norm(f.name) === FC.norm(s)) || listFlows().find((f) => s && FC.norm(f.name).includes(FC.norm(s))) || null; };

  // ---------- lượt chạy ----------
  const runs = new Map();
  const waiters = new Map(); // runId → resolve(decision)
  (rj(F.runs, []) || []).forEach((r) => { if (r && r.id) { if (r.status === 'running' || r.status === 'waiting') { r.status = 'error'; r.error = 'S Hub đã khởi động lại giữa chừng'; r.pending = null; } runs.set(r.id, r); } });
  let saveT = null;
  const persistRuns = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { wj(F.runs, [...runs.values()].slice(-60)); } catch {} }, 300); };
  const pub = (r) => ({ id: r.id, kind: r.kind, flowId: r.flowId, agentId: r.agentId, title: r.title, icon: r.icon, status: r.status, via: r.via, input: r.input, result: r.result, error: r.error, startedAt: r.startedAt, endedAt: r.endedAt, pending: r.pending, steps: r.steps });
  function newRun(o) {
    const r = { id: 'r' + now().toString(36) + Math.random().toString(36).slice(2, 5), status: 'running', steps: [], startedAt: now(), endedAt: 0, result: '', error: '', pending: null, stop: false, ...o };
    runs.set(r.id, r); while (runs.size > 60) runs.delete(runs.keys().next().value); persistRuns(); return r;
  }
  /** Dừng lại chờ người dùng: kind approval (bước Chờ duyệt) hoặc tool (lệnh thay đổi lớn). Trả 'ok' | 'no'. */
  function waitFor(run, pending) {
    if (run.stop) return Promise.resolve('no');
    run.status = 'waiting'; run.pending = { ...pending, at: now() }; persistRuns();
    return new Promise((resolve) => waiters.set(run.id, (d) => { waiters.delete(run.id); run.pending = null; if (!run.stop) run.status = 'running'; persistRuns(); resolve(d); }));
  }
  function decide(id, decision) {
    const r = runs.get(id); if (!r) bad('Không thấy lượt chạy', 404);
    const w = waiters.get(id); if (!w) bad('Lượt chạy này không chờ duyệt');
    w(decision === 'ok' ? 'ok' : 'no'); return pub(r);
  }
  function stopRun(id) {
    const r = runs.get(id); if (!r) bad('Không thấy lượt chạy', 404);
    r.stop = true; const w = waiters.get(id); if (w) w('no');
    if (r.status === 'running' || r.status === 'waiting') { r.status = 'stopped'; r.endedAt = now(); }
    persistRuns(); return pub(r);
  }

  // ---------- model và lệnh ----------
  const textOf = (content) => (content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  async function askText(prompt, system, pref) {
    const r = await ai.ask({ messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }], tools: [], context: system || '', pref });
    if (!r.ok) throw new Error(r.error || 'Không hỏi được model');
    return { text: textOf(r.content), engine: r.engine };
  }
  async function toolDefs() { return (await ai.allTools(true)).filter((t) => t.plugin !== 'flow'); }

  /** Chạy lệnh trong flow/agent: kiểm quyền theo mode, lệnh lớn thì chờ duyệt. */
  async function runToolStep(run, step, name, args, mode, who) {
    const def = (await toolDefs()).find((t) => t.name === name);
    if (!def) return { text: `Không có lệnh "${name}" trên máy này`, isError: true };
    if (!AI.allowedBy(mode, def.access)) return { text: `${who} đang để quyền "${FC.MODES[mode]}", lệnh ${name} chưa được phép.`, isError: true };
    if (AI.needsAsk(def.access)) {
      const d = await waitFor(run, { kind: 'tool', stepId: step.id, title: `${who} muốn chạy: ${def.title || name}`, detail: `${name} ${JSON.stringify(args)}`, paid: def.access === 'paid' });
      if (d !== 'ok') return { text: 'Người dùng đã từ chối lệnh này.', isError: true };
    }
    const call = { name, title: def.title || name, input: args, at: now() }; step.calls = [...(step.calls || []), call]; persistRuns();
    const r = await ai.callTool(name, args, { confirmed: true, mode, via: 'chat' });
    call.ok = !r.isError; call.out = String(r.text || '').slice(0, 1500); persistRuns();
    return r;
  }

  /** Agent làm một việc: vòng lặp model ↔ lệnh (AICore.runTurn), lệnh theo quyền của agent. */
  async function runAgent(run, step, agent, task, depth) {
    const all = await toolDefs();
    let tools = FC.agentTools(agent, all, AI.allowedBy);
    const flows = agent.flows.map(getFlow).filter(Boolean);
    if (flows.length && depth < 2) tools = [...tools, { name: 'run_flow', title: 'Chạy flow', access: 'edit', description: `Chạy một flow được gắn cho agent này. Có: ${flows.map((f) => `${f.id} (${f.name})`).join(', ')}.`, inputSchema: { type: 'object', properties: { flow: { type: 'string', description: 'id flow' }, input: { type: 'string', description: 'dữ liệu vào' } }, required: ['flow'] } }];
    const proj = agent.projectId ? (ai.projects ? ai.projects() : []).find((p) => p.id === agent.projectId) : null;
    const context = FC.agentContext(agent, proj ? AI.contextText({ project: proj }) : '') ;
    const apiTools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
    let engine = '';
    const res = await AI.runTurn([{ role: 'user', content: [{ type: 'text', text: task }] }], {
      model: async (messages) => {
        const r = await ai.ask({ messages, tools: apiTools, context, pref: agent.model });
        if (r.ok) { engine = r.engine; step.engine = engine; return r; }
        return { ok: false, fallback: !!r.noModel, error: r.error };
      },
      localCtx: { toolNames: tools.map((t) => t.name), apps: [] },
      runTool: async (name, input) => {
        if (name === 'run_flow') {
          const f = flows.find((x) => x.id === input.flow || FC.norm(x.name) === FC.norm(input.flow));
          if (!f) return { text: 'Flow này không gắn cho agent', isError: true };
          const sub = await execFlow(f, String(input.input || ''), { via: 'agent:' + agent.id, depth: depth + 1, parent: run });
          return { text: sub.status === 'done' ? sub.result || '(xong)' : `Flow dừng: ${sub.error || sub.status}`, isError: sub.status !== 'done' };
        }
        if (!tools.some((t) => t.name === name)) return { text: `Lệnh ${name} không nằm trong danh sách được phép của agent`, isError: true };
        return runToolStep(run, step, name, input, agent.mode, 'Agent ' + agent.name);
      },
      onUpdate: () => {},
      aborted: () => run.stop,
      maxSteps: agent.maxSteps,
    });
    if (res.source === 'local') step.engine = 'rules';
    const last = [...res.messages].reverse().find((m) => m.role === 'assistant');
    const text = last ? textOf(last.content) : '';
    if (res.error) throw new Error(res.error);
    return text || '(agent không trả lời)';
  }

  /** Chạy flow. Trả về lượt chạy khi xong (hoặc khi dừng). */
  async function execFlow(flow, input, { via = 'tay', depth = 0, parent = null, run: given } = {}) {
    const run = given || newRun({ kind: 'flow', flowId: flow.id, title: flow.name, icon: flow.icon, via, input: String(input || '').slice(0, 20000) });
    const order = FC.topo(flow);
    const fin = (status, error) => { run.status = run.stop ? 'stopped' : status; run.error = error || ''; run.endedAt = now(); run.pending = null; persistRuns(); return run; };
    if (!order) return fin('error', 'Flow có vòng lặp, chưa chạy được');
    if (depth > 2) return fin('error', 'Flow gọi lồng quá sâu');
    const outs = {}; const ctx = { input: run.input };
    for (const id of order) {
      if (run.stop) return fin('stopped');
      const n = flow.nodes.find((x) => x.id === id); const c = n.cfg;
      const step = { id, name: n.name, type: n.type, status: 'running', startedAt: now() };
      let inText = '';
      if (n.type !== 'trigger') {
        const live = flow.edges.filter((e) => e.to === id && outs[e.from] && outs[e.from].ports.includes(e.port));
        if (!live.length) { run.steps.push({ ...step, status: 'skipped' }); continue; }
        inText = live.map((e) => outs[e.from].text).filter(Boolean).join('\n\n');
      }
      run.steps.push(step); persistRuns();
      const vars = { ...ctx, input: n.type === 'trigger' ? run.input : inText };
      let text = '', ports = ['out'];
      try {
        if (n.type === 'trigger') text = run.input || c.sample || '';
        else if (n.type === 'ai') {
          const prompt = FC.interp(c.prompt || '{{input}}', vars);
          const r = await askText(/\{\{\s*input\s*\}\}/.test(c.prompt || '{{input}}') ? prompt : prompt + '\n\n' + inText, FC.interp(c.system, vars), c.model);
          text = r.text; step.engine = r.engine;
        } else if (n.type === 'agent') {
          const ag = agents().find((a) => a.id === c.agentId); if (!ag) throw new Error('Chưa chọn agent hoặc agent đã bị xoá');
          step.agent = ag.name;
          text = await runAgent(run, step, ag, FC.interp(c.task || '{{input}}', vars) || inText, depth);
        } else if (n.type === 'tool') {
          if (!c.tool) throw new Error('Chưa chọn lệnh');
          const r = await runToolStep(run, step, c.tool, FC.toolArgs(c.args, vars), flow.mode, 'Flow');
          if (r.isError) throw new Error(r.text);
          text = String(r.text || '');
        } else if (n.type === 'condition') {
          text = inText;
          let yes;
          if (c.how === 'ai') { const r = await askText(`Trả lời đúng một từ: CO hoặc KHONG.\nCâu hỏi: ${FC.interp(c.value, vars)}\n\nNội dung:\n${inText.slice(0, 8000)}`, '', 'auto'); yes = /^(co|yes|dung)\b/.test(FC.norm(r.text).replace(/[^a-z ]/g, '').trim()); step.note = 'AI: ' + r.text.slice(0, 60); }
          else yes = FC.checkText(c.how, FC.interp(c.value, vars), inText);
          ports = [yes ? 'true' : 'false']; step.port = ports[0];
        } else if (n.type === 'approval') {
          text = inText;
          const d = await waitFor(run, { kind: 'approval', stepId: id, title: FC.interp(c.message, vars) || 'Duyệt bước tiếp theo?', detail: inText.slice(0, 3000) });
          if (run.stop) return fin('stopped');
          ports = [d === 'ok' ? 'ok' : 'no']; step.port = ports[0];
        } else if (n.type === 'output') {
          text = FC.interp(c.template || '{{input}}', vars); ports = [];
          run.result = (run.result ? run.result + '\n\n' : '') + text;
        }
        outs[id] = { text, ports }; ctx[n.name] = text; ctx[n.id] = text;
        Object.assign(step, { status: 'done', endedAt: now(), out: String(text).slice(0, 4000) }); persistRuns();
      } catch (e) {
        Object.assign(step, { status: 'error', endedAt: now(), out: String(e.message || e) });
        return fin('error', `${n.name}: ${e.message || e}`);
      }
    }
    if (!run.result) { const last = [...run.steps].reverse().find((s) => s.status === 'done' && s.out); run.result = last ? last.out : ''; }
    return fin('done');
  }

  /** Giao việc thẳng cho agent (không qua flow). */
  async function execAgent(agent, task, { via = 'tay', run: given } = {}) {
    const run = given || newRun({ kind: 'agent', agentId: agent.id, title: agent.name, icon: agent.icon, via, input: String(task).slice(0, 20000) });
    const step = { id: 'agent', name: agent.name, type: 'agent', agent: agent.name, status: 'running', startedAt: now() }; run.steps.push(step); persistRuns();
    try {
      const text = await runAgent(run, step, agent, run.input, 0);
      Object.assign(step, { status: 'done', endedAt: now(), out: text.slice(0, 4000) }); run.result = text;
      run.status = run.stop ? 'stopped' : 'done';
    } catch (e) { Object.assign(step, { status: 'error', endedAt: now(), out: e.message }); run.status = run.stop ? 'stopped' : 'error'; run.error = e.message; }
    run.endedAt = now(); run.pending = null; persistRuns(); return run;
  }
  /** Bắt đầu chạy nền; chờ tối đa waitMs (xong sớm thì trả luôn). */
  async function start(kind, target, input, via, waitMs = 0) {
    const run = kind === 'flow'
      ? newRun({ kind: 'flow', flowId: target.id, title: target.name, icon: target.icon, via, input: String(input || '').slice(0, 20000) })
      : newRun({ kind: 'agent', agentId: target.id, title: target.name, icon: target.icon, via, input: String(input || '').slice(0, 20000) });
    const p = (kind === 'flow' ? execFlow(target, input, { via, run }) : execAgent(target, input, { via, run })).catch((e) => { run.status = 'error'; run.error = e.message; run.endedAt = now(); persistRuns(); });
    if (waitMs) await Promise.race([p, new Promise((r) => setTimeout(r, waitMs)), new Promise((r) => { const t = setInterval(() => { if (run.status === 'waiting') { clearInterval(t); r(); } }, 200); p.finally(() => clearInterval(t)); })]);
    return run;
  }

  // ---------- chạy theo giờ ----------
  function tick() {
    const d = new Date(now()); const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); const day = d.toISOString().slice(0, 10);
    const done = rj(F.sched, {});
    for (const f of listFlows()) {
      const t = f.nodes.find((n) => n.type === 'trigger' && n.cfg.schedule === hm); if (!t) continue;
      const key = f.id + '@' + t.id; if (done[key] === day) continue;
      done[key] = day; wj(F.sched, done);
      start('flow', f, t.cfg.sample || '', 'lịch ' + hm);
    }
  }
  const timer = tickMs ? setInterval(() => { try { tick(); } catch {} }, tickMs) : null; if (timer && timer.unref) timer.unref();

  // ---------- lệnh cho trợ lý chat ----------
  const summary = (r) => r.status === 'done' ? `Flow/agent "${r.title}" chạy xong.\nKết quả:\n${r.result || '(trống)'}` : r.status === 'waiting' ? `"${r.title}" đang chờ bạn duyệt: ${r.pending && r.pending.title}. Mở menu ${r.kind === 'flow' ? 'Flow' : 'Agent'} để bấm Duyệt hoặc Từ chối (lượt ${r.id}).` : r.status === 'running' ? `"${r.title}" đang chạy (lượt ${r.id}). Xem tiến độ ở menu ${r.kind === 'flow' ? 'Flow' : 'Agent'}.` : `"${r.title}" dừng: ${r.error || r.status}`;
  ai.register([
    { name: 'list_flows', title: 'Danh sách flow', access: 'read', plugin: 'flow', description: 'Các flow (quy trình tự động) đã thiết kế trong menu Flow của Socin Studio: id, tên, mô tả, số bước, lịch chạy.', inputSchema: { type: 'object', properties: {} },
      async run() { return JSON.stringify(listFlows().map(brief), null, 1).slice(0, 12000); } },
    { name: 'run_flow', title: 'Chạy flow', access: 'edit', plugin: 'flow', description: 'Chạy một flow theo id hoặc tên (xem list_flows) với dữ liệu vào. Lệnh lớn trong flow vẫn chờ người dùng duyệt ở menu Flow.', inputSchema: { type: 'object', properties: { flow: { type: 'string', description: 'id hoặc tên flow' }, input: { type: 'string', description: 'dữ liệu vào cho bước Bắt đầu' } }, required: ['flow'] },
      async run({ flow, input }) { const f = findFlow(flow); if (!f) return { text: `Không thấy flow "${flow}". Dùng list_flows.`, isError: true }; const r = await start('flow', f, input || '', 'chat', 90000); return { text: summary(r), isError: r.status === 'error' }; } },
    { name: 'list_agents', title: 'Danh sách agent', access: 'read', plugin: 'flow', description: 'Các agent đã tạo trong menu Agent: id, tên, vai trò, model, quyền, lệnh được phép, flow gắn kèm.', inputSchema: { type: 'object', properties: {} },
      async run() { return JSON.stringify(agents().map((a) => ({ id: a.id, name: a.name, role: a.role, model: a.model, mode: a.mode, tools: a.tools.length ? a.tools : 'mọi lệnh hợp quyền', flows: a.flows })), null, 1).slice(0, 12000); } },
    { name: 'ask_agent', title: 'Giao việc cho agent', access: 'edit', plugin: 'flow', description: 'Giao một việc cho agent (theo id hoặc tên, xem list_agents); agent tự gọi lệnh trong phạm vi quyền của nó rồi trả kết quả.', inputSchema: { type: 'object', properties: { agent: { type: 'string', description: 'id hoặc tên agent' }, task: { type: 'string', description: 'việc cần làm' } }, required: ['agent', 'task'] },
      async run({ agent, task }) { const a = findAgent(agent); if (!a) return { text: `Không thấy agent "${agent}". Dùng list_agents.`, isError: true }; const r = await start('agent', a, task || '', 'chat', 120000); return { text: summary(r), isError: r.status === 'error' }; } },
  ]);

  // ---------- HTTP ----------
  const handler = async (req, res, u) => {
    if (!u.pathname.startsWith('/api/flow/')) return false;
    const r = u.pathname.slice(10); const post = req.method === 'POST'; const q = u.searchParams;
    try {
      const b = post ? await body(req) : {};
      if (r === 'flows') return json(res, 200, { flows: listFlows().map(brief), templates: FC.TEMPLATES.map((t) => ({ id: t.id, icon: t.icon, name: t.name, summary: t.summary, steps: t.nodes.length })) }), true;
      if (r === 'flow' && !post) { const f = getFlow(q.get('id')); if (!f) bad('Không thấy flow', 404); return json(res, 200, { flow: f }), true; }
      if (r === 'template') { const t = FC.TEMPLATES.find((x) => x.id === q.get('id')); if (!t) bad('Không có mẫu', 404); return json(res, 200, { flow: FC.fromTemplate(t) }), true; }
      if (r === 'flow/save' && post) { const id = b.id && ID.test(b.id) && fs.existsSync(fp(b.id)) ? b.id : ''; return json(res, 200, { ok: true, flow: saveFlow(b.flow, id) }), true; }
      if (r === 'flow/delete' && post) { if (!getFlow(b.id)) bad('Không thấy flow', 404); fs.unlinkSync(fp(b.id)); return json(res, 200, { ok: true }), true; }
      if (r === 'flow/run' && post) {
        let f = getFlow(b.id); if (!f) bad('Không thấy flow', 404);
        if (b.flow) f = saveFlow(b.flow, f.id);
        return json(res, 200, { ok: true, run: pub(await start('flow', f, b.input || '', 'tay')) }), true;
      }
      if (r === 'flow/suggest' && post) {
        const req0 = String(b.request || '').trim(); if (req0.length < 5) bad('Hãy mô tả quy trình (vài câu)');
        const out = await askText(FC.suggestPrompt(req0, await toolDefs(), agents()), 'Bạn thiết kế flow tự động hoá. Chỉ trả JSON.', 'auto');
        return json(res, 200, { ok: true, flow: FC.parseSuggestion(out.text), engine: out.engine }), true;
      }
      if (r === 'agents' && !post) return json(res, 200, { agents: agents(), templates: FC.AGENT_TEMPLATES }), true;
      if (r === 'agents/save' && post) {
        const a = FC.cleanAgent({ ...b.agent, updated: now() }); const list = agents().filter((x) => x.id !== a.id);
        if (list.length >= FC.LIMITS.agents) bad('Đã đủ ' + FC.LIMITS.agents + ' agent');
        wj(F.agents, [a, ...list]); return json(res, 200, { ok: true, agent: a, agents: [a, ...list] }), true;
      }
      if (r === 'agents/suggest' && post) {
        const req0 = String(b.request || '').trim(); if (req0.length < 5) bad('Hãy mô tả agent cần tạo (vài câu)');
        const tools = await toolDefs();
        const out = await askText(FC.agentSuggestPrompt(req0, tools), 'Bạn thiết kế agent tự động hoá. Chỉ trả JSON.', 'auto');
        return json(res, 200, { ok: true, agent: FC.parseAgentSuggestion(out.text, tools), engine: out.engine }), true;
      }
      if (r === 'agents/delete' && post) { const list = agents(); if (!list.some((a) => a.id === b.id)) bad('Không thấy agent', 404); wj(F.agents, list.filter((a) => a.id !== b.id)); return json(res, 200, { ok: true }), true; }
      if (r === 'agents/run' && post) { const a = agents().find((x) => x.id === b.id); if (!a) bad('Không thấy agent', 404); const t = String(b.task || '').trim(); if (!t) bad('Hãy nhập việc cần giao'); return json(res, 200, { ok: true, run: pub(await start('agent', a, t, 'tay')) }), true; }
      if (r === 'runs') { const f = q.get('flow'), a = q.get('agent'); return json(res, 200, { runs: [...runs.values()].reverse().filter((x) => (!f || x.flowId === f) && (!a || x.agentId === a)).slice(0, 30).map((x) => ({ ...pub(x), steps: undefined, stepCount: x.steps.length })) }), true; }
      if (r === 'run' && !post) { const x = runs.get(q.get('id')); if (!x) bad('Không thấy lượt chạy', 404); return json(res, 200, { run: pub(x) }), true; }
      if (r === 'run/decide' && post) return json(res, 200, { ok: true, run: decide(b.id, b.decision) }), true;
      if (r === 'run/stop' && post) return json(res, 200, { ok: true, run: stopRun(b.id) }), true;
      return json(res, 404, { error: 'not found' }), true;
    } catch (e) { return json(res, e.code === 404 ? 404 : 400, { error: String(e.message || e) }), true; }
  };
  handler.tick = tick; handler.execFlow = execFlow; handler.execAgent = execAgent; handler.runs = runs;
  return handler;
};
