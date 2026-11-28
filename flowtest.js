// Test Flow và Agent của Socin Studio: lõi (flowcore), lưu flow/agent, chạy flow (lệnh, AI, điều kiện, chờ duyệt, lệnh lớn chờ cho phép),
// agent gọi lệnh qua AI Socin giả, AI tạo agent và flow từ mô tả, lệnh cho trợ lý chat, chạy theo giờ. Không cần mạng.
const { spawn } = require('child_process'); const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
const FC = require('./public/flowcore.js');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'shubflow-')); const WS = path.join(T, 'ws');
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL', m)); if (c) console.log('ok  ', m); };
const SPCR = 'spcr_flow_key_0123456789abcdef'; const P = 4794;
const req = (p, o) => new Promise((res) => { const rq = http.request({ host: '127.0.0.1', port: P, path: p, method: o !== undefined ? 'POST' : 'GET', headers: o !== undefined ? { Origin: 'http://127.0.0.1:' + P, 'content-type': 'application/json' } : {} }, (r) => { let d = ''; r.on('data', (x) => (d += x)); r.on('end', () => res({ s: r.statusCode, t: d, j: (() => { try { return JSON.parse(d || '{}'); } catch { return {}; } })() })); }); rq.end(o !== undefined ? JSON.stringify(o) : undefined); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(id, want, ms = 8000) { for (let i = 0; i < ms / 100; i++) { const r = (await req('/api/flow/run?id=' + id)).j.run; if (r && want.includes(r.status)) return r; await sleep(100); } return (await req('/api/flow/run?id=' + id)).j.run; }

// ---- lõi ----
{
  const f = FC.cleanFlow({ name: 'A', nodes: [{ id: 'a', type: 'trigger' }, { id: 'b', type: 'condition', cfg: { how: 'x' } }, { id: 'c', type: 'output' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', port: 'false' }, { from: 'c', to: 'a' }, { from: 'zz', to: 'a' }] }, 'a1');
  ok(f.edges.length === 2 && f.edges[1].port === 'false' && f.nodes[1].cfg.how === 'contains', 'làm sạch flow: bỏ đường nối sai, giữ cổng, cfg mặc định');
  let threw = false; try { FC.cleanFlow({ nodes: [{ id: 'a', type: 'hack' }] }); } catch { threw = true; } ok(threw, 'loại bước lạ bị từ chối');
  ok(FC.topo({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }] }) === null, 'phát hiện vòng lặp');
  ok(FC.interp('x {{input}} {{Bước 1}}', { input: 'I', 'Bước 1': 'B' }) === 'x I B', 'thay biến {{input}} và {{Tên bước}}');
  ok(FC.checkText('contains', 'lỗi|error', 'Có LỖI rồi') && FC.checkText('not_contains', 'ok', 'fail') && FC.checkText('empty', '', '  '), 'điều kiện chữ không dấu, nhiều cụm');
  ok(FC.toolArgs('{"repo":"{{input}}","n":2}', { input: 'a"b' }).repo === 'a"b', 'tham số lệnh thay biến an toàn trong JSON');
  ok(FC.TEMPLATES.every((t) => FC.check(FC.fromTemplate(t)).length === 0), 'các mẫu flow hợp lệ');
  const ag = FC.cleanAgent({ name: 'X', tools: ['hub_status', 'bad name!'], mode: 'zzz', maxSteps: 99 });
  ok(ag.tools.length === 1 && ag.mode === 'edit' && ag.maxSteps === 20, 'làm sạch agent');
  const sug = FC.parseAgentSuggestion('```json\n{"name":"VPS","icon":"🖥","role":"r","mode":"read","tools":["vps_status","khong_co"]}\n```', [{ name: 'vps_status' }]);
  ok(sug.name === 'VPS' && sug.tools.join() === 'vps_status' && sug.mode === 'read', 'đọc agent AI đề xuất, bỏ lệnh không có');
}

// ---- Socin giả: AI có gọi lệnh ----
const seen = [];
const socin = http.createServer((q, r) => {
  const j = (c, o) => { r.writeHead(c, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(o)); };
  if (q.headers.authorization !== 'Bearer ' + SPCR) return j(401, {});
  let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => {
    if (q.url === '/api/integration/creator/me') return j(200, { name: 'Lucid', tenant: 'Socin' });
    if (q.url === '/api/integration/creator/ai/info') return j(200, { enabled: true, provider: 'anthropic' });
    if (q.url !== '/api/integration/creator/ai/agent') return j(404, {});
    const x = JSON.parse(b); seen.push(x);
    const first = x.messages[0].content.find((c) => c.type === 'text')?.text || '';
    const last = x.messages[x.messages.length - 1];
    if (/Tạo một agent/.test(first)) return j(200, { content: [{ type: 'text', text: '{"name":"Trực VPS","icon":"🖥","role":"Theo dõi VPS","instructions":"Xem trạng thái","mode":"read","tools":["vps_servers","hub_status","khong_co"]}' }] });
    if (/Thiết kế một flow/.test(first)) return j(200, { content: [{ type: 'text', text: 'Đây: {"name":"Báo cáo","nodes":[{"id":"s","type":"start"},{"id":"t","type":"tool","cfg":{"tool":"hub_status","args":{}}},{"id":"e","type":"end"}],"edges":[{"from":"s","to":"t"},{"from":"t","to":"e"}]}' }] });
    if (x.tools.length) {
      if (last.content.some((c) => c.type === 'tool_result')) return j(200, { content: [{ type: 'text', text: 'Agent xong: máy ổn.' }] });
      const want = /bật zoom/.test(first) ? 'zoom_start' : /triển khai/.test(first) ? 'vps_deploy' : 'hub_status';
      return j(200, { content: [{ type: 'tool_use', id: 'tu1', name: want, input: want === 'vps_deploy' ? { server: 's', project: 'p' } : {} }] });
    }
    if (/CO hoặc KHONG/.test(first)) return j(200, { content: [{ type: 'text', text: 'CÓ' }] });
    return j(200, { content: [{ type: 'text', text: 'Tóm tắt: ' + first.slice(0, 40) }] });
  });
});

let srv;
socin.listen(0, async () => {
  const SOCIN = 'http://127.0.0.1:' + socin.address().port;
  const cfgFile = path.join(T, 'config.json'); fs.writeFileSync(cfgFile, JSON.stringify({ port: P, workspace: WS }));
  srv = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env, SHUB_CONFIG: cfgFile, SDRAW_USERDATA: path.join(T, 'no-sdraw') }, stdio: ['ignore', 'pipe', 'inherit'] });
  for (let i = 0; i < 40; i++) { await sleep(200); if ((await req('/api/env').catch(() => ({}))).s === 200) break; }
  try {
    const home = (await req('/')).t;
    ok(/data-view="flows"/.test(home) && /data-view="agents"/.test(home) && /flowui\.js/.test(home), 'Socin Studio có menu Flow và Agent');
    const tools0 = (await req('/api/ai/tools')).j.tools.map((t) => t.name);
    ok(['list_flows', 'run_flow', 'list_agents', 'ask_agent'].every((n) => tools0.includes(n)), 'sổ lệnh chat có lệnh flow và agent');

    // flow lệnh + điều kiện + kết quả (không cần model)
    const tpl = (await req('/api/flow/flows')).j.templates; ok(tpl.length === 3, 'có 3 mẫu flow');
    const f1 = { name: 'Kiểm tra', nodes: [
      { id: 's', type: 'trigger', cfg: { sample: 'mẫu' } }, { id: 't', type: 'tool', name: 'Trạng thái', cfg: { tool: 'hub_status', args: '{}' } },
      { id: 'c', type: 'condition', cfg: { how: 'contains', value: 'apps' } }, { id: 'y', type: 'output', cfg: { template: 'CÓ {{Trạng thái}}' } }, { id: 'n', type: 'output', cfg: { template: 'KHÔNG' } }],
      edges: [{ from: 's', to: 't' }, { from: 't', to: 'c' }, { from: 'c', to: 'y', port: 'true' }, { from: 'c', to: 'n', port: 'false' }] };
    const sv = (await req('/api/flow/flow/save', { flow: f1 })).j; ok(sv.ok && sv.flow.id === 'kiem-tra', 'lưu flow, id theo tên');
    let run = (await req('/api/flow/flow/run', { id: 'kiem-tra', input: '' })).j.run;
    run = await until(run.id, ['done', 'error']);
    ok(run.status === 'done' && /^CÓ /.test(run.result) && run.steps.find((s) => s.id === 'n').status === 'skipped', 'chạy flow: lệnh → điều kiện Đúng → kết quả, nhánh Sai bỏ qua');
    ok(run.steps.find((s) => s.id === 't').calls[0].name === 'hub_status', 'bước lệnh ghi lại lệnh đã gọi');

    // bước Chờ duyệt + lệnh lớn chờ cho phép
    await req('/api/flow/flow/save', { flow: { name: 'Triển khai', mode: 'full', nodes: [{ id: 's', type: 'trigger' }, { id: 'a', type: 'approval', cfg: { message: 'Duyệt?' } }, { id: 'd', type: 'tool', cfg: { tool: 'vps_deploy', args: '{"server":"x","project":"y"}' } }, { id: 'no', type: 'output', cfg: { template: 'Bị từ chối' } }], edges: [{ from: 's', to: 'a' }, { from: 'a', to: 'd', port: 'ok' }, { from: 'a', to: 'no', port: 'no' }] } });
    run = (await req('/api/flow/flow/run', { id: 'trien-khai' })).j.run; run = await until(run.id, ['waiting']);
    ok(run.status === 'waiting' && run.pending.kind === 'approval' && run.pending.title === 'Duyệt?', 'bước Chờ duyệt dừng lại chờ người');
    await req('/api/flow/run/decide', { id: run.id, decision: 'ok' }); run = await until(run.id, ['waiting']);
    ok(run.status === 'waiting' && run.pending.kind === 'tool' && /vps_deploy/.test(run.pending.detail), 'lệnh lớn trong flow chờ cho phép');
    await req('/api/flow/run/decide', { id: run.id, decision: 'no' }); run = await until(run.id, ['done', 'error']);
    ok(run.status === 'error' && /từ chối/.test(run.error), 'từ chối lệnh lớn thì flow dừng, không chạy');
    run = (await req('/api/flow/flow/run', { id: 'trien-khai' })).j.run; run = await until(run.id, ['waiting']);
    await req('/api/flow/run/decide', { id: run.id, decision: 'no' }); run = await until(run.id, ['done', 'error']);
    ok(run.status === 'done' && run.result === 'Bị từ chối', 'từ chối ở bước Chờ duyệt đi nhánh Từ chối');
    run = (await req('/api/flow/flow/run', { id: 'trien-khai' })).j.run; run = await until(run.id, ['waiting']);
    run = (await req('/api/flow/run/stop', { id: run.id })).j.run; ok(run.status === 'stopped', 'dừng lượt chạy đang chờ');
    await req('/api/flow/flow/save', { id: 'trien-khai', flow: { ...(await req('/api/flow/flow?id=trien-khai')).j.flow, mode: 'read' } });
    run = (await req('/api/flow/flow/run', { id: 'trien-khai' })).j.run; run = await until(run.id, ['waiting']); await req('/api/flow/run/decide', { id: run.id, decision: 'ok' }); run = await until(run.id, ['done', 'error']);
    ok(run.status === 'error' && /Chỉ xem/.test(run.error), 'flow để quyền Chỉ xem chặn lệnh thao tác');

    // chưa có model → bước AI báo rõ
    await req('/api/flow/flow/save', { flow: { name: 'Hỏi AI', nodes: [{ id: 's', type: 'trigger' }, { id: 'a', type: 'ai', name: 'Tóm', cfg: { prompt: 'Tóm tắt {{input}}', model: 'socin' } }], edges: [{ from: 's', to: 'a' }] } });
    run = (await req('/api/flow/flow/run', { id: 'hoi-ai', input: 'abc' })).j.run; run = await until(run.id, ['done', 'error']);
    ok(run.status === 'error' && /đăng nhập Socin/.test(run.error), 'bước AI khi chưa có model báo lỗi rõ');

    // đăng nhập Socin → AI và agent
    await req('/api/cr/settings/save', { socinBaseUrl: SOCIN, socinToken: SPCR });
    run = (await req('/api/flow/flow/run', { id: 'hoi-ai', input: 'abc' })).j.run; run = await until(run.id, ['done', 'error']);
    ok(run.status === 'done' && run.result === 'Tóm tắt: Tóm tắt abc' && run.steps[1].engine === 'socin', 'bước AI dùng AI Socin');

    const sug = (await req('/api/flow/agents/suggest', { request: 'agent theo dõi VPS' })).j;
    ok(sug.ok && sug.agent.name === 'Trực VPS' && sug.agent.tools.join() === 'vps_servers,hub_status' && sug.agent.id === '', 'AI tạo agent từ mô tả, chỉ giữ lệnh có thật');
    const ag = (await req('/api/flow/agents/save', { agent: { name: 'Vận hành', role: 'Theo dõi máy', mode: 'edit', tools: ['hub_status', 'zoom_start', 'vps_deploy'] } })).j.agent;
    ok(ag && ag.id && ag.tools.length === 3, 'lưu agent');
    run = (await req('/api/flow/agents/run', { id: ag.id, task: 'xem máy' })).j.run; run = await until(run.id, ['done', 'error']);
    ok(run.status === 'done' && run.result === 'Agent xong: máy ổn.' && run.steps[0].calls[0].name === 'hub_status', 'agent: AI gọi lệnh → kết quả → trả lời');
    const ctxSent = seen[seen.length - 1].context; ok(/agent "Vận hành"/.test(ctxSent) && /Theo dõi máy/.test(ctxSent), 'agent gửi vai trò làm ngữ cảnh');
    ok(seen[seen.length - 1].tools.map((t) => t.name).sort().join() === 'hub_status,vps_deploy,zoom_start', 'agent chỉ thấy lệnh được phép');
    run = (await req('/api/flow/agents/run', { id: ag.id, task: 'triển khai giúp' })).j.run; run = await until(run.id, ['waiting']);
    ok(run.status === 'waiting' && run.pending.kind === 'tool', 'agent gọi lệnh lớn → chờ cho phép');
    await req('/api/flow/run/decide', { id: run.id, decision: 'no' }); run = await until(run.id, ['done', 'error']);
    ok(run.status === 'done' && run.steps[0].calls === undefined, 'agent bị từ chối lệnh lớn thì không chạy lệnh');
    const ro = (await req('/api/flow/agents/save', { agent: { ...ag, mode: 'read' } })).j.agent;
    run = (await req('/api/flow/agents/run', { id: ro.id, task: 'bật zoom' })).j.run; run = await until(run.id, ['done', 'error']);
    ok(!seen[seen.length - 1].tools.some((t) => t.name === 'zoom_start'), 'agent quyền Chỉ xem không được đưa lệnh thao tác');

    // flow có bước agent + AI đề xuất flow
    await req('/api/flow/agents/save', { agent: { ...ag, mode: 'edit' } });
    await req('/api/flow/flow/save', { flow: { name: 'Nhờ agent', nodes: [{ id: 's', type: 'trigger' }, { id: 'g', type: 'agent', cfg: { agentId: ag.id, task: 'xem {{input}}' } }, { id: 'o', type: 'output' }], edges: [{ from: 's', to: 'g' }, { from: 'g', to: 'o' }] } });
    run = (await req('/api/flow/flow/run', { id: 'nho-agent', input: 'máy' })).j.run; run = await until(run.id, ['done', 'error']);
    ok(run.status === 'done' && run.result === 'Agent xong: máy ổn.' && run.steps[1].agent === 'Vận hành', 'bước Agent trong flow');
    const fs1 = (await req('/api/flow/flow/suggest', { request: 'báo cáo máy mỗi ngày' })).j;
    ok(fs1.ok && fs1.flow.nodes.map((n) => n.type).join() === 'trigger,tool,output' && fs1.flow.edges.length === 2, 'AI thiết kế flow từ mô tả');

    // trợ lý chat dùng flow/agent
    ok(/kiem-tra/.test((await req('/api/ai/call', { name: 'list_flows', input: {} })).j.text), 'chat: list_flows');
    const rf = (await req('/api/ai/call', { name: 'run_flow', input: { flow: 'Kiểm tra' } })).j;
    ok(!rf.isError && /chạy xong/.test(rf.text) && /CÓ/.test(rf.text), 'chat: run_flow theo tên, chờ kết quả');
    const aa = (await req('/api/ai/call', { name: 'ask_agent', input: { agent: 'vận hành', task: 'xem máy' } })).j;
    ok(!aa.isError && /Agent xong/.test(aa.text), 'chat: ask_agent theo tên');
    ok((await req('/api/ai/call', { name: 'run_flow', input: { flow: 'kiem-tra' }, mode: 'read' })).j.isError, 'chat quyền Chỉ xem không chạy flow');

    // chạy theo giờ
    const d = new Date(Date.now() + 60000 * 3); const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    const sch = (await req('/api/flow/flow/save', { flow: { name: 'Hẹn giờ', nodes: [{ id: 's', type: 'trigger', cfg: { schedule: hm, sample: 'sáng' } }, { id: 'o', type: 'output' }], edges: [{ from: 's', to: 'o' }] } })).j.flow;
    ok(sch.nodes[0].cfg.schedule === hm && (await req('/api/flow/flows')).j.flows.find((f) => f.id === 'hen-gio').schedule === hm, 'lưu lịch chạy hằng ngày');
    const bad = (await req('/api/flow/flow/save', { flow: { name: 'x', nodes: [{ id: 's', type: 'trigger', cfg: { schedule: '25:99' } }] } })).j.flow;
    ok(bad.nodes[0].cfg.schedule === '', 'giờ sai bị bỏ');
    ok((await req('/api/flow/flow/delete', { id: 'x' })).j.ok && (await req('/api/flow/flow?id=x')).s === 404, 'xoá flow');
    ok((await req('/api/flow/flow/save', { flow: f1 }, )).j.flow.id === 'kiem-tra-2', 'trùng tên thì thêm số');
    await sleep(500); const rl = (await req('/api/flow/runs')).j.runs; ok(rl.length > 5 && fs.existsSync(path.join(WS, 'socin-studio', 'runs.json')), 'lưu lịch sử chạy');
  } catch (e) { fail++; console.log('FAIL exception', e); }
  srv.kill(); socin.close();
  // tick theo giờ chạy trong tiến trình (giờ giả)
  {
    const WS2 = path.join(T, 'ws2'); const handlers = []; const reg = [];
    const ai = { register: (d) => reg.push(...d), allTools: async () => [], callTool: async () => ({ text: '' }), ask: async () => ({ ok: false, error: 'x' }), projects: () => [] };
    const at = new Date(2026, 10, 28, 8, 0, 10).getTime();
    const h = require('./socinflow.js')({ WS: WS2, json: () => {}, body: async () => ({}), ai, now: () => at, tickMs: 0 });
    fs.mkdirSync(path.join(WS2, 'socin-studio', 'flows'), { recursive: true });
    fs.writeFileSync(path.join(WS2, 'socin-studio', 'flows', 'sang.json'), JSON.stringify(FC.cleanFlow({ name: 'Sáng', nodes: [{ id: 's', type: 'trigger', cfg: { schedule: '08:00', sample: 'hi' } }, { id: 'o', type: 'output' }], edges: [{ from: 's', to: 'o' }] }, 'sang')));
    h.tick(); h.tick(); await sleep(50);
    const rs = [...h.runs.values()]; ok(rs.length === 1 && rs[0].status === 'done' && rs[0].result === 'hi' && /lịch 08:00/.test(rs[0].via), 'chạy theo giờ đúng một lần mỗi ngày');
    void handlers;
  }
  console.log(`\n${pass} đạt, ${fail} lỗi`); process.exit(fail ? 1 : 0);
});
