// Lõi Flow và Agent của Socin Studio, dùng chung cho trình duyệt (window.FlowCore) và server Node (require).
// Flow: các bước kéo thả (bắt đầu, hỏi AI, agent, lệnh/app, điều kiện, chờ duyệt, kết quả) nối bằng đường có cổng.
// Agent: tên, vai trò, hướng dẫn, model, mức quyền, lệnh được phép, dự án làm ngữ cảnh, flow gắn kèm.
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.FlowCore = m;
})(typeof self !== 'undefined' ? self : this, function () {
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const S = (v, n) => String(v == null ? '' : v).slice(0, n);
  const ID = /^[\w-]{1,40}$/;
  const TOOL = /^[\w.:-]{1,80}$/;

  // ---------- loại bước ----------
  // cfg: [khoá, nhãn, kiểu] kiểu: t = một dòng, a = nhiều dòng, s = chọn
  const TYPES = {
    trigger: { label: 'Bắt đầu', color: '#3FCB8A', icon: '▶', desc: 'Dữ liệu vào, chạy tay hoặc theo giờ', outs: ['out'], ins: false, cfg: ['sample', 'schedule'] },
    ai: { label: 'Hỏi AI', color: '#0B7F8F', icon: '✦', desc: 'Một lượt hỏi model, không gọi lệnh', outs: ['out'], cfg: ['system', 'prompt', 'model'] },
    agent: { label: 'Agent', color: '#5B6CFF', icon: '🤖', desc: 'Giao việc cho agent, agent tự gọi lệnh', outs: ['out'], cfg: ['agentId', 'task'] },
    tool: { label: 'Lệnh / app', color: '#5F7A8A', icon: '⚙', desc: 'Gọi một lệnh Socin, S Hub hoặc MCP', outs: ['out'], cfg: ['tool', 'args', 'conn'] },
    condition: { label: 'Điều kiện', color: '#E09A00', icon: '◇', desc: 'Rẽ nhánh Đúng / Sai', outs: ['true', 'false'], cfg: ['how', 'value'] },
    approval: { label: 'Chờ duyệt', color: '#C4547F', icon: '✋', desc: 'Dừng lại chờ bạn bấm Duyệt', outs: ['ok', 'no'], cfg: ['message'] },
    output: { label: 'Kết quả', color: '#8E7CFF', icon: '■', desc: 'Điểm kết thúc, gom kết quả', outs: [], cfg: ['template'] },
  };
  const PORT_LABEL = { out: '', true: 'Đúng', false: 'Sai', ok: 'Duyệt', no: 'Từ chối' };
  const MODELS = { auto: 'Tự động', socin: 'AI Socin', local: 'Trên máy' };
  const MODES = { read: 'Chỉ xem', edit: 'Xem và thao tác', full: 'Đầy đủ' };
  const HOW = { contains: 'Có chứa chữ', not_contains: 'Không chứa chữ', empty: 'Rỗng', ai: 'Hỏi AI (Có / Không)' };
  const LIMITS = { nodes: 60, cfg: 8000, flows: 200, agents: 50, agentSteps: 20 };

  function defaultCfg(type) {
    switch (type) {
      case 'trigger': return { sample: '', schedule: '' };
      case 'ai': return { system: '', prompt: '{{input}}', model: 'auto' };
      case 'agent': return { agentId: '', task: '{{input}}' };
      case 'tool': return { tool: '', args: '{}', conn: '' };
      case 'condition': return { how: 'contains', value: '' };
      case 'approval': return { message: 'Duyệt bước tiếp theo?' };
      case 'output': return { template: '{{input}}' };
      default: return {};
    }
  }

  // ---------- làm sạch dữ liệu ----------
  function cleanFlow(f, id) {
    if (!isObj(f) || !Array.isArray(f.nodes)) throw new Error('Flow không hợp lệ: cần danh sách bước');
    if (!f.nodes.length) throw new Error('Flow cần ít nhất một bước');
    if (f.nodes.length > LIMITS.nodes) throw new Error(`Flow tối đa ${LIMITS.nodes} bước`);
    const seen = new Set();
    const nodes = f.nodes.map((n) => {
      if (!isObj(n) || !ID.test(String(n.id)) || !TYPES[n.type]) throw new Error('Bước không hợp lệ: ' + JSON.stringify(n && n.id));
      if (seen.has(String(n.id))) throw new Error('Trùng mã bước: ' + n.id);
      seen.add(String(n.id));
      const cfg = defaultCfg(n.type);
      for (const k of TYPES[n.type].cfg) if (isObj(n.cfg) && n.cfg[k] != null) cfg[k] = S(n.cfg[k], LIMITS.cfg);
      if (n.type === 'ai' && !MODELS[cfg.model]) cfg.model = 'auto';
      if (n.type === 'condition' && !HOW[cfg.how]) cfg.how = 'contains';
      if (n.type === 'trigger' && cfg.schedule && !/^([01]\d|2[0-3]):[0-5]\d$/.test(cfg.schedule)) cfg.schedule = '';
      return { id: String(n.id), type: n.type, name: S(n.name || TYPES[n.type].label, 80) || TYPES[n.type].label, x: Math.round(Number(n.x) || 0), y: Math.round(Number(n.y) || 0), cfg };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = [];
    for (const e of Array.isArray(f.edges) ? f.edges : []) {
      if (!isObj(e)) continue;
      const a = byId.get(e.from), b = byId.get(e.to);
      if (!a || !b || a === b || TYPES[b.type].ins === false) continue;
      const port = TYPES[a.type].outs.includes(e.port) ? e.port : TYPES[a.type].outs[0];
      if (!port || edges.some((x) => x.from === a.id && x.to === b.id && x.port === port)) continue;
      edges.push({ from: a.id, to: b.id, port });
    }
    return {
      id: id || S(f.id, 40), name: S(f.name || 'Flow mới', 80) || 'Flow mới', summary: S(f.summary, 400),
      icon: S(f.icon || '🔀', 8) || '🔀', mode: MODES[f.mode] ? f.mode : 'edit', nodes, edges, updated: Number(f.updated) || Date.now(),
    };
  }

  function cleanAgent(a) {
    if (!isObj(a)) throw new Error('Agent không hợp lệ');
    const name = S(a.name, 60).trim(); if (!name) throw new Error('Agent cần có tên');
    return {
      id: ID.test(String(a.id || '')) ? String(a.id) : 'ag' + Date.now().toString(36),
      name, icon: S(a.icon || '🤖', 8) || '🤖', role: S(a.role, 300), instructions: S(a.instructions, 4000),
      model: MODELS[a.model] ? a.model : 'auto', mode: MODES[a.mode] ? a.mode : 'edit',
      tools: Array.isArray(a.tools) ? [...new Set(a.tools.map(String).filter((t) => TOOL.test(t)))].slice(0, 100) : [],
      flows: Array.isArray(a.flows) ? [...new Set(a.flows.map(String).filter((t) => ID.test(t)))].slice(0, 20) : [],
      projectId: a.projectId && ID.test(String(a.projectId)) ? String(a.projectId) : '',
      maxSteps: Math.min(LIMITS.agentSteps, Math.max(1, Math.round(Number(a.maxSteps) || 8))),
      updated: Number(a.updated) || Date.now(),
    };
  }

  // ---------- chạy ----------
  /** Thứ tự chạy (topo). null nếu có vòng lặp. */
  function topo(f) {
    const indeg = {}; f.nodes.forEach((n) => (indeg[n.id] = 0)); f.edges.forEach((e) => indeg[e.to]++);
    const q = f.nodes.filter((n) => !indeg[n.id]).map((n) => n.id), out = [];
    while (q.length) { const i = q.shift(); out.push(i); f.edges.filter((e) => e.from === i).forEach((e) => { if (--indeg[e.to] === 0) q.push(e.to); }); }
    return out.length === f.nodes.length ? out : null;
  }
  /** Thay {{input}}, {{Tên bước}} hoặc {{mã-bước}} bằng dữ liệu. */
  function interp(s, ctx) {
    return String(s || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, k) => (ctx[k] !== undefined ? String(ctx[k]) : ''));
  }
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
  /** Điều kiện không cần AI. value có thể nhiều cụm cách nhau bởi "|" (khớp một cụm là đủ). */
  function checkText(how, value, text) {
    if (how === 'empty') return !String(text || '').trim();
    const words = String(value || '').split('|').map((w) => norm(w).trim()).filter(Boolean);
    const hit = words.some((w) => norm(text).includes(w));
    return how === 'not_contains' ? !hit : hit;
  }
  /** Đọc tham số JSON của bước lệnh sau khi thay biến; chuỗi được thay an toàn trong giá trị. */
  function toolArgs(raw, ctx) {
    const src = String(raw || '').trim() || '{}';
    let j; try { j = JSON.parse(src); } catch { throw new Error('Tham số lệnh phải là JSON, ví dụ {"server":"vps1"}'); }
    if (!isObj(j)) throw new Error('Tham số lệnh phải là một object JSON');
    const walk = (v) => (typeof v === 'string' ? interp(v, ctx) : Array.isArray(v) ? v.map(walk) : isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v);
    return walk(j);
  }
  /** Kiểm tra trước khi chạy: trả danh sách cảnh báo (chuỗi). */
  function check(f, { tools = [], agents = [] } = {}) {
    const w = [];
    const names = new Set(tools.map((t) => (typeof t === 'string' ? t : t.name)));
    if (!f.nodes.some((n) => n.type === 'trigger')) w.push('Chưa có bước Bắt đầu');
    if (!topo(f)) w.push('Flow có vòng lặp, chưa chạy được');
    for (const n of f.nodes) {
      const into = f.edges.some((e) => e.to === n.id), from = f.edges.some((e) => e.from === n.id);
      if (n.type !== 'trigger' && !into) w.push(`"${n.name}" chưa có đường nối vào`);
      if (TYPES[n.type].outs.length && !from && f.nodes.length > 1) w.push(`"${n.name}" chưa nối tới bước nào`);
      if (n.type === 'tool' && !n.cfg.tool) w.push(`"${n.name}" chưa chọn lệnh`);
      else if (n.type === 'tool' && tools.length && !names.has(n.cfg.tool)) w.push(`"${n.name}": lệnh ${n.cfg.tool} không có trên máy này`);
      if (n.type === 'agent' && !agents.some((a) => a.id === n.cfg.agentId)) w.push(`"${n.name}" chưa chọn agent`);
      if (n.type === 'tool') { try { JSON.parse(n.cfg.args || '{}'); } catch { w.push(`"${n.name}": tham số không phải JSON`); } }
    }
    return w;
  }
  /** Tự xếp theo tầng (từ trái sang phải). */
  function layout(f) {
    const lv = {}; const order = topo(f) || f.nodes.map((n) => n.id);
    for (const id of order) for (const e of f.edges.filter((x) => x.from === id)) lv[e.to] = Math.max(lv[e.to] || 0, (lv[id] || 0) + 1);
    const cols = {};
    f.nodes.forEach((n) => (cols[lv[n.id] || 0] = cols[lv[n.id] || 0] || []).push(n));
    Object.entries(cols).forEach(([c, ns]) => ns.forEach((n, i) => { n.x = 40 + Number(c) * 205; n.y = 60 + i * 180 + (ns.length === 1 ? 90 : 0); }));
    return f;
  }

  /** Đọc flow AI đề xuất (có thể kèm chữ thừa, ```json). */
  function parseSuggestion(text) {
    const t = String(text || ''); const i = t.indexOf('{'), j = t.lastIndexOf('}');
    if (i < 0 || j <= i) throw new Error('AI không trả về JSON flow, thử mô tả rõ hơn');
    let raw; try { raw = JSON.parse(t.slice(i, j + 1)); } catch { throw new Error('Không đọc được JSON AI trả về, thử lại'); }
    const alias = { claude: 'ai', llm: 'ai', human: 'approval', start: 'trigger', end: 'output', command: 'tool', app: 'tool' };
    if (isObj(raw) && Array.isArray(raw.nodes)) raw.nodes = raw.nodes.map((n, k) => ({ ...n, id: ID.test(String(n && n.id)) ? n.id : 'n' + (k + 1), type: alias[n && n.type] || (n && n.type), cfg: isObj(n && n.cfg) ? Object.fromEntries(Object.entries(n.cfg).map(([a, b]) => [a, isObj(b) || Array.isArray(b) ? JSON.stringify(b) : b])) : {} }));
    return layout(cleanFlow(raw, 'tmp'));
  }
  function suggestPrompt(request, tools, agents) {
    return `Thiết kế một flow (quy trình tự động) cho Socin Studio theo yêu cầu bên dưới. Trả về DUY NHẤT một JSON, không giải thích:
{"name":"...","summary":"...","nodes":[{"id":"n1","type":"trigger","name":"...","cfg":{}}],"edges":[{"from":"n1","to":"n2","port":"out"}]}
Loại bước và cfg:
- trigger {sample: dữ liệu mẫu, schedule: "HH:MM" nếu chạy hằng ngày hoặc ""}  (luôn có đúng 1 bước này, đứng đầu)
- ai {system: vai trò, prompt: câu hỏi, dùng {{input}} cho dữ liệu bước trước}
- agent {agentId: id agent có sẵn, task: việc giao, dùng {{input}}}
- tool {tool: tên lệnh có sẵn, args: JSON chuỗi tham số, dùng {{input}} được}
- condition {how: "contains"|"not_contains"|"empty"|"ai", value: chữ cần tìm (nhiều cụm cách bằng |) hoặc câu hỏi Có/Không nếu how=ai}; cổng ra "true"/"false"
- approval {message: điều cần duyệt}; cổng ra "ok"/"no" (dùng trước mọi việc thay đổi lớn: triển khai, đăng bài, xoá)
- output {template: "{{input}}"}  (kết thúc)
port là "out" trừ condition và approval. 3 đến 9 bước. id chỉ chữ thường, số, gạch ngang. Viết tiếng Việt.
Lệnh có sẵn: ${tools.slice(0, 50).map((t) => t.name + (t.title ? ' (' + t.title + ')' : '')).join(', ') || '(không có)'}
Agent có sẵn: ${agents.map((a) => a.id + ' (' + a.name + ': ' + (a.role || '') + ')').join(', ') || '(chưa có, đừng dùng bước agent)'}
Yêu cầu: ${String(request).slice(0, 1500)}`;
  }

  /** Lời dặn agent (đưa vào ngữ cảnh mỗi lượt). */
  function agentContext(agent, extra) {
    const p = [`Bạn đang làm agent "${agent.name}" trong Socin Studio.`];
    if (agent.role) p.push('Vai trò: ' + agent.role);
    if (agent.instructions) p.push('Hướng dẫn:\n' + agent.instructions);
    p.push('Làm việc được giao bằng các lệnh được phép, lần lượt từng bước. Xong thì trả lời ngắn gọn kết quả cuối cùng (không hỏi lại trừ khi thiếu thông tin bắt buộc).');
    if (extra) p.push(extra);
    return p.join('\n');
  }
  /** Lệnh agent được dùng: theo mức quyền và danh sách chọn (rỗng = mọi lệnh hợp quyền). */
  function agentTools(agent, all, allowedBy) {
    const pick = new Set(agent.tools || []);
    return all.filter((t) => allowedBy(agent.mode, t.access) && (!pick.size || pick.has(t.name)));
  }


  // ---------- AI tạo agent từ mô tả ----------
  function agentSuggestPrompt(request, tools) {
    return `Tạo một agent cho Socin Studio theo nhu cầu bên dưới. Trả về DUY NHẤT một JSON, không giải thích:
{"name":"tên ngắn","icon":"1 emoji","role":"vai trò một câu","instructions":"hướng dẫn làm việc từng bước, quy tắc an toàn","mode":"read|edit|full","model":"auto","tools":["tên lệnh", "..."]}
Chọn ít lệnh nhất đủ dùng, chỉ lấy từ danh sách. mode: read nếu chỉ xem, edit nếu cần bật/tắt/mở, full nếu cần thay đổi lớn (triển khai, tạo bài...). Viết tiếng Việt.
Lệnh có sẵn (tên: mô tả [mức]):
${tools.slice(0, 80).map((t) => `${t.name}: ${(t.title || '')} ${String(t.description || '').slice(0, 90)} [${t.access}]`).join('\n')}
Nhu cầu: ${String(request).slice(0, 1500)}`;
  }
  function parseAgentSuggestion(text, tools) {
    const t = String(text || ''); const i = t.indexOf('{'), j = t.lastIndexOf('}');
    if (i < 0 || j <= i) throw new Error('AI không trả về JSON agent, thử mô tả rõ hơn');
    let raw; try { raw = JSON.parse(t.slice(i, j + 1)); } catch { throw new Error('Không đọc được JSON AI trả về, thử lại'); }
    const names = new Set(tools.map((x) => x.name));
    const a = cleanAgent({ ...raw, id: undefined, tools: (Array.isArray(raw.tools) ? raw.tools : []).filter((n) => names.has(n)) });
    a.id = ''; return a;
  }
  /** Nhóm kết nối của lệnh: S Hub, Socin, hoặc tên máy chủ MCP. */
  function connOf(t) { return /^mcp_/.test(t.name) ? 'mcp:' + (t.plugin || '').replace(/^mcp:/, '') : t.plugin === 'socin' ? 'socin' : t.plugin === 'flow' ? 'flow' : 'shub'; }

  // ---------- mẫu ----------
  const TEMPLATES = [
    { id: 'tpl-morning', icon: '☀️', name: 'Kiểm tra máy mỗi sáng', summary: 'Mỗi sáng 8:00 xem trạng thái S Hub và Zoom worker, AI tóm tắt việc cần chú ý.',
      nodes: [
        { id: 'start', type: 'trigger', name: 'Mỗi sáng 8:00', cfg: { sample: 'Kiểm tra định kỳ', schedule: '08:00' } },
        { id: 'status', type: 'tool', name: 'Trạng thái S Hub', cfg: { tool: 'hub_status', args: '{}' } },
        { id: 'zoom', type: 'tool', name: 'Zoom worker', cfg: { tool: 'zoom_status', args: '{}' } },
        { id: 'sum', type: 'ai', name: 'Tóm tắt', cfg: { system: 'Bạn là trợ lý vận hành.', prompt: 'Tóm tắt ngắn tình trạng máy, nêu việc cần làm nếu có:\n{{Trạng thái S Hub}}\n\nZoom: {{input}}', model: 'auto' } },
        { id: 'out', type: 'output', name: 'Báo cáo', cfg: { template: '{{input}}' } },
      ], edges: [{ from: 'start', to: 'status' }, { from: 'status', to: 'zoom' }, { from: 'zoom', to: 'sum' }, { from: 'sum', to: 'out' }] },
    { id: 'tpl-deploy', icon: '🚀', name: 'Duyệt rồi triển khai', summary: 'Đọc kết quả kiểm thử gần nhất của repo; không lỗi thì chờ bạn duyệt rồi mới triển khai lên VPS.',
      nodes: [
        { id: 'start', type: 'trigger', name: 'Repo cần triển khai', cfg: { sample: 'social' } },
        { id: 'rep', type: 'tool', name: 'Kết quả kiểm thử', cfg: { tool: 'test_reports', args: '{"repo":"{{input}}","limit":1}' } },
        { id: 'pass', type: 'condition', name: 'Không có lỗi?', cfg: { how: 'contains', value: '"failed": 0|"failed":0' } },
        { id: 'ok', type: 'approval', name: 'Duyệt triển khai', cfg: { message: 'Kiểm thử đạt. Triển khai lên VPS?' } },
        { id: 'deploy', type: 'tool', name: 'Triển khai', cfg: { tool: 'vps_deploy', args: '{"server":"","project":""}' } },
        { id: 'done', type: 'output', name: 'Đã triển khai', cfg: { template: '{{input}}' } },
        { id: 'fail', type: 'output', name: 'Dừng vì lỗi', cfg: { template: 'Kiểm thử chưa đạt hoặc chưa chạy:\n{{Kết quả kiểm thử}}' } },
      ], edges: [{ from: 'start', to: 'rep' }, { from: 'rep', to: 'pass' }, { from: 'pass', to: 'ok', port: 'true' }, { from: 'pass', to: 'fail', port: 'false' }, { from: 'ok', to: 'deploy', port: 'ok' }, { from: 'deploy', to: 'done' }] },
    { id: 'tpl-post', icon: '✍️', name: 'Soạn bài nháp mạng xã hội', summary: 'Agent soạn bài từ ý tưởng, bạn duyệt nội dung, rồi tạo bài nháp trên Socin.',
      nodes: [
        { id: 'start', type: 'trigger', name: 'Ý tưởng bài', cfg: { sample: 'Giới thiệu tính năng Flow của Socin Studio' } },
        { id: 'write', type: 'ai', name: 'Soạn bài', cfg: { system: 'Bạn là người viết nội dung mạng xã hội, giọng thân thiện, ngắn gọn.', prompt: 'Viết một bài Threads dưới 400 chữ về: {{input}}', model: 'auto' } },
        { id: 'ok', type: 'approval', name: 'Duyệt nội dung', cfg: { message: 'Đọc bài AI soạn, duyệt để tạo bài nháp.' } },
        { id: 'acc', type: 'tool', name: 'Tài khoản MXH', cfg: { tool: 'socin_accounts', args: '{}' } },
        { id: 'out', type: 'output', name: 'Bài đã duyệt', cfg: { template: '{{Soạn bài}}' } },
      ], edges: [{ from: 'start', to: 'write' }, { from: 'write', to: 'ok' }, { from: 'ok', to: 'acc', port: 'ok' }, { from: 'acc', to: 'out' }] },
  ];
  const AGENT_TEMPLATES = [
    { name: 'Vận hành máy', icon: '🛠', role: 'Theo dõi S Hub, Zoom worker và VPS; báo việc bất thường.', instructions: 'Luôn xem hub_status trước. Chỉ bật/tắt dịch vụ khi được giao rõ. Báo kết quả gạch đầu dòng.', mode: 'edit', tools: ['hub_status', 'list_apps', 'zoom_status', 'zoom_start', 'zoom_restart', 'vps_servers', 'vps_status', 'vps_logs'] },
    { name: 'Triển khai', icon: '🚀', role: 'Kiểm thử repo và triển khai lên VPS an toàn.', instructions: 'Chạy run_tests và đọc test_reports trước. Chỉ triển khai khi kiểm thử đạt. Việc triển khai luôn chờ người duyệt.', mode: 'full', tools: ['list_repos', 'run_tests', 'test_reports', 'vps_servers', 'vps_status', 'vps_deploy', 'vps_logs'] },
    { name: 'Nội dung', icon: '✍️', role: 'Soạn bài mạng xã hội và tạo bài nháp trên Socin.', instructions: 'Viết tiếng Việt tự nhiên. Chỉ tạo bài NHÁP, không bao giờ tự đăng.', mode: 'full', tools: ['socin_accounts', 'socin_create_draft', 'creator_projects'] },
  ];
  function fromTemplate(t) { return layout(cleanFlow({ ...t, id: undefined, nodes: t.nodes.map((n) => ({ ...n })), edges: t.edges.map((e) => ({ port: 'out', ...e })) }, '')); }

  return { TYPES, PORT_LABEL, MODELS, MODES, HOW, LIMITS, defaultCfg, cleanFlow, cleanAgent, topo, interp, norm, checkText, toolArgs, check, layout, parseSuggestion, suggestPrompt, agentContext, agentTools, TEMPLATES, AGENT_TEMPLATES, fromTemplate, agentSuggestPrompt, parseAgentSuggestion, connOf };
});
