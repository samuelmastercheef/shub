// Test Socin Studio: lõi trợ lý (aicore), sổ lệnh, Socin giả (AI có gọi lệnh, kho plugin), máy chủ MCP giả (HTTP + stdio),
// cổng MCP của S Hub và cầu nối stdio. Không cần mạng, không cần Ollama.
const { spawn } = require('child_process'); const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
const A = require('./public/aicore.js');
const { parseRpcBody } = require('./mcpclient.js');
const bridge = require('./mcp-stdio.js');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'shubai-')); const WS = path.join(T, 'ws');
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL', m)); if (c) console.log('ok  ', m); };
const SPCR = 'spcr_chat_key_0123456789abcdef';
const P = 4793;
const req = (p, o, headers = {}) => new Promise((res) => { const rq = http.request({ host: '127.0.0.1', port: P, path: p, method: o !== undefined ? 'POST' : 'GET', headers: { ...(o !== undefined ? { Origin: 'http://127.0.0.1:' + P, 'content-type': 'application/json' } : {}), ...headers } }, (r) => { let d = ''; r.on('data', (x) => (d += x)); r.on('end', () => res({ s: r.statusCode, t: d, j: (() => { try { return JSON.parse(d || '{}'); } catch { return {}; } })() })); }); rq.end(o !== undefined ? JSON.stringify(o) : undefined); });

// ---- lõi (thuần) ----
(async () => {
  const apps = [{ id: 'vps', name: 'S VPS' }, { id: 'zoom', name: 'S Zoom worker' }, { id: 'build', name: 'S Build Hub' }];
  const names = ['hub_status', 'open_app', 'zoom_start', 'zoom_stop', 'vps_servers', 'list_plugins'];
  ok(A.localPlan('mở s vps', { toolNames: names, apps }).calls[0]?.input.id === 'vps', 'bộ hiểu lệnh: "mở s vps" → open_app vps');
  ok(A.localPlan('bật zoom worker giúp mình', { toolNames: names, apps }).calls[0]?.name === 'zoom_start', 'bộ hiểu lệnh: bật zoom');
  ok(A.localPlan('/open_app build', { toolNames: names, apps, firstArg: { open_app: 'id' } }).calls[0]?.input.id === 'build', 'lệnh gạch chéo có tham số đầu');
  ok(A.localPlan('/vps_servers {"x":1}', { toolNames: names }).calls[0]?.input.x === 1, 'lệnh gạch chéo nhận JSON');
  ok(/hiểu các lệnh/.test(A.localPlan('xin chào', { toolNames: names }).text), 'câu lạ → hướng dẫn lệnh');
  ok(A.allowedBy('read', 'edit') === false && A.allowedBy('edit', 'files') === true && A.needsAsk('files'), 'quyền: chỉ xem chặn thao tác; lệnh lớn hỏi trước');
  let step = 0; const ran = [];
  const res = await A.runTurn([{ role: 'user', content: [{ type: 'text', text: 'trạng thái?' }] }], {
    model: async () => (step++ === 0 ? { ok: true, content: [{ type: 'tool_use', id: 't1', name: 'hub_status', input: {} }] } : { ok: true, content: [{ type: 'text', text: 'Ổn.' }] }),
    runTool: async (n) => { ran.push(n); return { text: 'ok' }; }, onUpdate: () => {}, aborted: () => false,
  });
  ok(ran[0] === 'hub_status' && res.messages.length === 4 && res.messages[2].content[0].type === 'tool_result', 'vòng lặp: model gọi lệnh → kết quả → trả lời');
  const fb = await A.runTurn([{ role: 'user', content: [{ type: 'text', text: 'mở s vps' }] }], { model: async () => ({ ok: false, fallback: true, error: 'x' }), localCtx: { toolNames: names, apps }, runTool: async () => ({ text: 'ok' }), onUpdate: () => {}, aborted: () => false });
  ok(fb.source === 'local', 'model báo fallback → bộ hiểu lệnh');
  const oc = A.fromOllama({ content: '```json\n{"name":"hub_status","arguments":{}}\n```' }, new Set(['hub_status']));
  ok(oc[0]?.type === 'tool_use' && oc[0].name === 'hub_status', 'Ollama: nhận lệnh viết dạng JSON trong chữ');
  const ob = A.ollamaBody('qwen3.5:4b', [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], [{ name: 'hub_status', description: 'x', input_schema: { type: 'object' } }], 'ctx');
  ok(ob.model === 'qwen3.5:4b' && ob.messages[0].role === 'system' && /Socin AI/.test(ob.messages[0].content) && ob.tools[0].function.name === 'hub_status', 'gói Ollama đúng dạng, mặc định Qwen3.5 4B');
  ok(A.cleanLlmConfig({ mode: 'x', model: 'bad model!' }).model === 'qwen3.5:4b' && A.cleanLlmConfig({}).mode === 'auto', 'cấu hình model mặc định');
  const ctx = A.contextText({ project: { name: 'VPS khách', instructions: 'Luôn kiểm tra trước', notes: [{ title: 'Quy trình', text: 'B1...' }] } });
  ok(/VPS khách/.test(ctx) && /Luôn kiểm tra/.test(ctx) && /Quy trình/.test(ctx), 'ngữ cảnh dự án gồm hướng dẫn và tài liệu');
  ok(parseRpcBody('event: message\ndata: {"jsonrpc":"2.0","id":3,"result":{"x":1}}\n\n', 'text/event-stream', 3).result.x === 1, 'đọc trả lời MCP dạng SSE');
})();

// ---- Socin giả ----
let proposalSeen = null; let agentSeen = null;
const socin = http.createServer((q, r) => {
  const j = (c, o) => { r.writeHead(c, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(o)); };
  if (q.headers.authorization !== 'Bearer ' + SPCR) return j(401, { error: 'unauthorized' });
  let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => {
    if (q.url === '/api/integration/creator/me') return j(200, { name: 'Lucid', admin: true, owner: true, tenant: 'Socin' });
    if (q.url === '/api/integration/creator/ai/info') return j(200, { enabled: true, provider: 'anthropic', provider_label: 'Claude (Anthropic)', model: 'claude-sonnet-5-5', source: 'main' });
    if (q.url === '/api/integration/creator/plugins') return j(200, { version: 1, plugins: [{ id: 'sdraw', name: 'S Draw', icon: '📐', category: 'design', kind: 'mcp-http', url: 'auto', needsSocin: false, offline: true, description: 'x' }, { id: 'socin', name: 'Socin', icon: '🌐', category: 'socin', kind: 'builtin', needsSocin: true, offline: false, description: 'y' }], store: [{ code: 'ai', kind: 'ai', name: 'Gói AI', description: 'Thêm lượt', price_vnd: 100000, recurring: true }], store_url: 'https://app.socin.test/#store' });
    if (q.url.startsWith('/api/integration/creator/knowledge/search')) return j(200, { hits: [{ doc_id: 'rule.facebook', status: 'ap-dung', text: 'Luật Facebook: AI soạn, người bấm. q=' + new URL(q.url, 'http://x').searchParams.get('q') }] });
    if (q.url === '/api/integration/creator/knowledge/proposals' && q.method === 'POST') { proposalSeen = JSON.parse(b); return j(201, { id: 'p1', doc_id: 'playbook.thu', status: 'pending' }); }
    if (q.url === '/api/integration/creator/knowledge') return j(200, { hash: 'h1', brief: '# Luật cốt lõi\n1. Tiếng Việt.' });
    if (q.url === '/api/integration/creator/accounts') return j(200, { accounts: [{ id: 'a1', platform: 'tiktok', display_name: 'TikTok A' }] });
    if (q.url === '/api/integration/creator/ai/agent') { agentSeen = JSON.parse(b); return j(200, { content: [{ type: 'text', text: 'Chào từ AI Socin' }], provider: 'anthropic', model: 'claude-sonnet-5-5' }); }
    j(404, {});
  });
});

// ---- máy chủ MCP giả (HTTP, trả SSE, có phiên) ----
let mcpAuth = '';
const fakeMcp = http.createServer((q, r) => {
  let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => {
    mcpAuth = q.headers.authorization || '';
    const m = JSON.parse(b || '{}');
    if (m.id === undefined) { r.writeHead(202); return r.end(); }
    const reply = (result) => { r.writeHead(200, { 'Content-Type': 'text/event-stream', 'mcp-session-id': 'sess1' }); r.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result })}\n\n`); };
    if (m.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake' } });
    if (q.headers['mcp-session-id'] !== 'sess1') { r.writeHead(400); return r.end(); }
    if (m.method === 'tools/list') return reply({ tools: [{ name: 'echo', description: 'Lặp lại', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, annotations: { readOnlyHint: true } }, { name: 'wipe', description: 'Xoá', inputSchema: { type: 'object' }, annotations: { destructiveHint: true } }] });
    if (m.method === 'tools/call') return reply({ content: [{ type: 'text', text: 'echo: ' + (m.params.arguments.text || '') }] });
    reply({});
  });
});
// máy chủ MCP stdio giả
const STDIO = path.join(T, 'stdio-mcp.js');
fs.writeFileSync(STDIO, `let b='';process.stdin.on('data',d=>{b+=d;let i;while((i=b.indexOf('\\n'))>=0){const l=b.slice(0,i);b=b.slice(i+1);if(!l.trim())continue;const m=JSON.parse(l);if(m.id===undefined)continue;const out=(result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');if(m.method==='initialize')out({protocolVersion:'2025-06-18',capabilities:{}});else if(m.method==='tools/list')out({tools:[{name:'add',description:'Cộng',inputSchema:{type:'object'},annotations:{readOnlyHint:true}}]});else if(m.method==='tools/call')out({content:[{type:'text',text:String(m.params.arguments.a+m.params.arguments.b)}]});}});`);

let srv;
socin.listen(0, () => fakeMcp.listen(0, async () => {
  const SOCIN = 'http://127.0.0.1:' + socin.address().port; const MCPURL = `http://127.0.0.1:${fakeMcp.address().port}/mcp`;
  const cfgFile = path.join(T, 'config.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ port: P, workspace: WS }));
  srv = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env, SHUB_CONFIG: cfgFile, SDRAW_USERDATA: path.join(T, 'no-sdraw') }, stdio: ['ignore', 'pipe', 'inherit'] });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 200)); if ((await req('/api/env').catch(() => ({}))).s === 200) break; }
  try {
    const home = await req('/'); ok(home.s === 200 && /Socin Studio/.test(home.t) && /chat\.js/.test(home.t), 'trang chính là Socin Studio');
    ok((await req('/apps.html')).t.includes('CATS'), 'trang Ứng dụng (S Hub cũ) vẫn còn');
    let tools = (await req('/api/ai/tools')).j.tools.map((t) => t.name);
    ok(tools.includes('hub_status') && tools.includes('open_app') && !tools.some((n) => n.startsWith('socin_')), 'sổ lệnh: lệnh S Hub có, lệnh Socin ẩn khi offline');
    ok(!tools.includes('xpub') && !tools.some((n) => /xpub|sweep/.test(n)), 'không có lệnh ví');
    const st = await req('/api/ai/call', { name: 'hub_status', input: {} });
    ok(!st.j.isError && /apps/.test(st.j.text), 'chạy lệnh hub_status');
    ok((await req('/api/ai/call', { name: 'vps_deploy', input: { server: 'x', project: 'y' } })).j.isError, 'lệnh lớn chưa đồng ý thì không chạy');
    ok((await req('/api/ai/call', { name: 'zoom_start', input: {}, mode: 'read' })).j.isError, 'quyền Chỉ xem chặn lệnh thao tác');
    ok((await req('/api/ai/call', { name: 'hub_status', input: {} }, { Origin: 'https://evil.example' })).s === 403, 'trang web lạ không gọi được lệnh');
    const op = await req('/api/ai/call', { name: 'open_app', input: { id: 'vps' } });
    ok(op.j.open && op.j.open.id === 'vps', 'open_app trả thông tin để mở ở khung bên');
    ok((await req('/api/ai/account')).j.linked === false, 'chưa đăng nhập Socin');
    ok((await req('/api/ai/socin', { messages: [], tools: [] })).j.fallback === true, 'AI Socin khi offline → fallback');
    ok((await req('/api/ai/plugins')).j.source === 'offline', 'kho plugin offline khi chưa đăng nhập');

    // đăng nhập Socin (lưu chung với S Creator)
    ok((await req('/api/cr/settings/save', { socinBaseUrl: SOCIN, socinToken: SPCR })).j.ok, 'đăng nhập Socin');
    const acc = (await req('/api/ai/account')).j;
    ok(acc.linked && acc.me.name === 'Lucid' && acc.ai.provider === 'anthropic', 'thông tin tài khoản và AI doanh nghiệp');
    tools = (await req('/api/ai/tools')).j.tools.map((t) => t.name);
    ok(tools.includes('socin_accounts') && tools.includes('socin_create_draft'), 'lệnh Socin hiện sau khi đăng nhập');
    ok(/TikTok A/.test((await req('/api/ai/call', { name: 'socin_accounts', input: {} })).j.text), 'lệnh Socin gọi API Socin bằng khoá S Creator');
    ok(/AI soạn, người bấm\. q=đăng nhóm/.test((await req('/api/ai/call', { name: 'knowledge_search', input: { q: 'đăng nhóm' } })).j.text), 'tra kho tri thức Socin');
    ok((await req('/api/ai/call', { name: 'knowledge_propose', input: { type: 'playbook', title: 'Thử', summary: 'Một quy trình thử.', body: '## Bước\nLàm thử.' } })).j.isError && !proposalSeen, 'đề xuất tri thức phải hỏi trước');
    const kp = await req('/api/ai/call', { name: 'knowledge_propose', input: { type: 'playbook', title: 'Thử', summary: 'Một quy trình thử.', body: '## Bước\nLàm thử.' }, confirmed: true });
    ok(!kp.j.isError && /hàng chờ/.test(kp.j.text) && proposalSeen.source === 'studio' && proposalSeen.title === 'Thử', 'đề xuất tri thức gửi lên Socin sau khi đồng ý');
    const ag = await req('/api/ai/socin', { messages: [{ role: 'user', content: [{ type: 'text', text: 'chào' }] }], tools: [{ name: 'hub_status', description: 'x', input_schema: { type: 'object' } }], context: 'Dự án: A' });
    ok(ag.j.ok && ag.j.content[0].text === 'Chào từ AI Socin' && agentSeen.tools[0].name === 'hub_status' && agentSeen.context === 'Dự án: A', 'AI Socin: gửi lịch sử + lệnh + ngữ cảnh, nhận khối trả lời');
    const pl = (await req('/api/ai/plugins')).j;
    ok(pl.source === 'socin' && pl.store[0].name === 'Gói AI' && pl.servers.some((s) => s.id === 'sdraw'), 'kho plugin từ Socin + Store, S Draw có sẵn');

    // máy chủ MCP khác
    ok((await req('/api/ai/mcp/servers', { name: 'Fake', kind: 'mcp-http', url: MCPURL, token: 'tok_fake_1234' })).j.server.hasToken, 'thêm máy chủ MCP HTTP (mã khoá không trả về)');
    ok(!(await req('/api/ai/mcp/servers')).t.includes('tok_fake_1234'), 'mã khoá máy chủ MCP không lộ ra trình duyệt');
    const tst = (await req('/api/ai/mcp/test', { id: 'fake' })).j;
    ok(tst.ok && tst.tools.length === 2 && mcpAuth === 'Bearer tok_fake_1234', 'thử máy chủ MCP: initialize + phiên + tools/list qua SSE');
    tools = (await req('/api/ai/tools')).j.tools;
    const echo = tools.find((t) => t.name === 'mcp_fake__echo'); const wipe = tools.find((t) => t.name === 'mcp_fake__wipe');
    ok(echo && echo.access === 'read' && wipe && wipe.access === 'files', 'lệnh MCP vào sổ lệnh, quyền theo annotations');
    ok((await req('/api/ai/call', { name: 'mcp_fake__echo', input: { text: 'xin chào' } })).j.text === 'echo: xin chào', 'gọi lệnh MCP HTTP');
    ok((await req('/api/ai/call', { name: 'mcp_fake__wipe', input: {} })).j.isError, 'lệnh MCP phá huỷ phải hỏi trước');
    ok((await req('/api/ai/mcp/servers', { name: 'Calc', kind: 'mcp-stdio', command: process.execPath, args: [STDIO] })).j.server.id === 'calc', 'thêm máy chủ MCP stdio');
    ok((await req('/api/ai/call', { name: 'mcp_calc__add', input: { a: 2, b: 3 } })).j.text === '5', 'gọi lệnh MCP stdio');
    const sd = (await req('/api/ai/mcp/test', { id: 'sdraw' })).j;
    ok(!sd.ok && /S Draw chưa mở/.test(sd.error), 'S Draw chưa bật cổng → báo rõ');

    // cổng MCP của S Hub
    ok((await req('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize' })).s === 503, 'cổng MCP mặc định tắt');
    const gw = (await req('/api/ai/gateway', { enabled: true })).j;
    ok(gw.enabled && gw.token.length >= 24 && /\/mcp$/.test(gw.url), 'bật cổng MCP, sinh mã khoá');
    ok((await req('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize' })).s === 401, 'cổng MCP cần mã khoá');
    const H = { Authorization: 'Bearer ' + gw.token };
    const ini = await req('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, H);
    ok(ini.j.result.serverInfo.name === 'socin-hub', 'initialize qua cổng MCP');
    const tl = (await req('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, H)).j.result.tools.map((t) => t.name);
    ok(tl.includes('hub_status') && !tl.includes('vps_deploy') && !tl.some((n) => n.startsWith('mcp_')), 'tools/list theo quyền (edit: không có triển khai), không mở lại lệnh MCP khác');
    const tc = (await req('/mcp', { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'hub_status', arguments: {} } }, H)).j.result;
    ok(!tc.isError && /apps/.test(tc.content[0].text), 'tools/call qua cổng MCP');
    ok((await req('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, H)).s === 202, 'thông báo MCP trả 202');
    // cầu nối stdio đọc run.json + mcp.json trong workspace
    const line = await bridge.forwardLine(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' }), () => bridge.target(WS));
    ok(JSON.parse(line).result.tools.length > 5, 'cầu nối stdio cho Claude Desktop chuyển tiếp được');
    ok(JSON.parse(await bridge.forwardLine('{"jsonrpc":"2.0","id":1,"method":"ping"}', () => null)).error.message.includes('S Hub chưa chạy'), 'cầu nối báo rõ khi S Hub chưa chạy');

    // cuộc trò chuyện + dự án
    await req('/api/ai/projects', { projects: [{ id: 'p1', name: 'VPS khách', instructions: 'Kiểm tra trước', notes: [{ title: 'QT', text: 'B1' }] }] });
    await req('/api/ai/chats', { chats: [{ id: 'c1', title: 'Thử', updatedAt: 1, projectId: 'p1', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }] });
    ok((await req('/api/ai/chats')).j.chats[0].projectId === 'p1' && (await req('/api/ai/projects')).j.projects[0].notes[0].title === 'QT', 'lưu cuộc trò chuyện và dự án');
    const llm = (await req('/api/ai/llm')).j;
    ok(llm.config.model === 'qwen3.5:4b' && llm.config.mode === 'auto' && llm.choices.length >= 3, 'trạng thái model trên máy, mặc định Qwen3.5 4B, Tự động');
    ok((await req('/api/ai/llm/config', { mode: 'local' })).j.config.mode === 'local', 'đổi chế độ Model');
  } catch (e) { fail++; console.log('FAIL lỗi', e); }
  srv.kill(); socin.close(); fakeMcp.close();
  console.log(`\n${pass} đạt, ${fail} lỗi`); process.exit(fail ? 1 : 0);
}));
