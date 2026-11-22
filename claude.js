// S Claude: quản lý hệ sinh thái Claude trên Mac (workflow agent, dọn cache, tài liệu, plugin, MCP, artifacts, dự án).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

module.exports = function init({ WS, json, body }) {
  const HOME = process.env.SHUB_HOME || os.homedir();
  const CL = path.join(HOME, '.claude');
  const APPSUP = path.join(HOME, 'Library', 'Application Support', 'Claude');
  const DIR = path.join(WS, 'claude'); const FLOWS = path.join(DIR, 'flows');
  fs.mkdirSync(FLOWS, { recursive: true });
  const bad = (m, s = 400) => { const e = new Error(m); e.status = s; throw e; };
  const rj = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
  const wj = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p + '.tmp', JSON.stringify(o, null, 2)); fs.renameSync(p + '.tmp', p); };
  const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
  const ID = /^[a-z0-9-]{1,48}$/;
  const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'flow';

  // ---------- đo dung lượng ----------
  function sizeOf(dir, cutoff = 0, del = false, depth = 0) {
    let bytes = 0, files = 0; let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return { bytes, files }; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory() && depth < 8) { const r = sizeOf(p, cutoff, del, depth + 1); bytes += r.bytes; files += r.files; if (del) { try { fs.rmdirSync(p); } catch {} } }
      else if (e.isFile()) { let st; try { st = fs.statSync(p); } catch { continue; } if (st.mtimeMs <= cutoff || !cutoff) { if (!cutoff && !del) { bytes += st.size; files++; } else if (cutoff && st.mtimeMs <= cutoff) { bytes += st.size; files++; if (del) { try { fs.unlinkSync(p); } catch { bytes -= st.size; files--; } } } } }
    }
    return { bytes, files };
  }
  // measure(dir, days): chỉ tính file cũ hơn days (days=0 -> tất cả)
  const measure = (dir, days, del) => { if (!exists(dir)) return { bytes: 0, files: 0 }; const cutoff = days > 0 ? Date.now() - days * 864e5 : Date.now() + 1e9; return sizeOf(dir, cutoff, del); };

  // Danh sách mục dọn (chỉ cache/nhật ký sinh ra, KHÔNG đụng cấu hình, plugin, MCP, CLAUDE.md)
  const projDirs = () => { try { return fs.readdirSync(path.join(CL, 'projects'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(CL, 'projects', d.name)); } catch { return []; } };
  const TARGETS = [
    { id: 'shell', label: 'Shell snapshots', desc: 'Ảnh chụp môi trường shell của Claude Code', dirs: () => [path.join(CL, 'shell-snapshots')], days: 3, safe: true },
    { id: 'debug', label: 'Nhật ký debug', desc: 'File log debug của Claude Code', dirs: () => [path.join(CL, 'debug')], days: 7, safe: true },
    { id: 'todos', label: 'Todos cũ', desc: 'Danh sách việc của các phiên đã đóng', dirs: () => [path.join(CL, 'todos')], days: 14, safe: true },
    { id: 'paste', label: 'Paste / ảnh cache', desc: 'Nội dung dán và ảnh đã cache', dirs: () => [path.join(CL, 'paste-cache'), path.join(CL, 'image-cache')], days: 7, safe: true },
    { id: 'filehist', label: 'Lịch sử file', desc: 'Bản sao file để hoàn tác (file-history)', dirs: () => [path.join(CL, 'file-history')], days: 30, safe: true },
    { id: 'statsig', label: 'Statsig / telemetry', desc: 'Cache cờ tính năng và thống kê', dirs: () => [path.join(CL, 'statsig')], days: 0, safe: true },
    { id: 'cli', label: 'Cache Claude CLI', desc: 'Cache Node của Claude CLI', dirs: () => [path.join(HOME, 'Library', 'Caches', 'claude-cli-nodejs'), path.join(HOME, '.cache', 'claude-cli-nodejs')], days: 7, safe: true },
    { id: 'appcache', label: 'Cache app Claude Desktop', desc: 'Cache, Code Cache, GPUCache, logs', dirs: () => ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'logs'].map((x) => path.join(APPSUP, x)), days: 0, safe: true },
    { id: 'sessions', label: 'Transcript phiên cũ', desc: 'File .jsonl hội thoại Claude Code (mất khả năng resume)', dirs: () => projDirs(), days: 60, safe: false },
  ];
  function cacheScan(over = {}) {
    return TARGETS.map((t) => { const days = over[t.id] !== undefined ? Number(over[t.id]) : t.days; let b = 0, f = 0; t.dirs().forEach((d) => { const r = t.id === 'sessions' ? measureJsonl(d, days) : measure(d, days); b += r.bytes; f += r.files; }); return { id: t.id, label: t.label, desc: t.desc, days, safe: t.safe, bytes: b, files: f }; });
  }
  function measureJsonl(dir, days, del) {
    const cutoff = Date.now() - Math.max(1, days) * 864e5; let bytes = 0, files = 0; let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return { bytes, files }; }
    for (const e of ents) { if (!e.isFile() || !e.name.endsWith('.jsonl')) continue; const p = path.join(dir, e.name); let st; try { st = fs.statSync(p); } catch { continue; } if (st.mtimeMs <= cutoff) { bytes += st.size; files++; if (del) { try { fs.unlinkSync(p); } catch { bytes -= st.size; files--; } } } }
    return { bytes, files };
  }
  function cacheClean(ids, over) {
    const out = []; for (const id of ids) { const t = TARGETS.find((x) => x.id === id); if (!t) continue; const days = over && over[id] !== undefined ? Number(over[id]) : t.days; let b = 0, f = 0; t.dirs().forEach((d) => { const r = t.id === 'sessions' ? measureJsonl(d, days, true) : exists(d) ? measure(d, days, true) : { bytes: 0, files: 0 }; b += r.bytes; f += r.files; }); out.push({ id, freed: b, files: f }); }
    return out;
  }

  // ---------- plugin / MCP / tài liệu / dự án ----------
  const maskEnv = (o) => { const r = {}; Object.keys(o || {}).forEach((k) => (r[k] = /key|token|secret|pass|auth/i.test(k) ? '••••' : String(o[k]).slice(0, 80))); return r; };
  const mcpOf = (srv, source) => Object.entries(srv || {}).map(([name, c]) => ({ name, source, type: c.type || (c.url ? 'http' : 'stdio'), target: c.url || [c.command, ...(c.args || [])].join(' ').slice(0, 160), env: maskEnv(c.env), disabled: !!c.disabled }));
  function listMcp() {
    const out = [];
    const g = rj(path.join(HOME, '.claude.json'), {}); out.push(...mcpOf(g.mcpServers, 'Claude Code (toàn cục)'));
    Object.entries(g.projects || {}).forEach(([p, v]) => out.push(...mcpOf(v && v.mcpServers, 'Dự án ' + path.basename(p))));
    out.push(...mcpOf(rj(path.join(APPSUP, 'claude_desktop_config.json'), {}).mcpServers, 'Claude Desktop'));
    return out;
  }
  function listPlugins() {
    const inst = rj(path.join(CL, 'plugins', 'installed_plugins.json'), {}); const st = rj(path.join(CL, 'settings.json'), {}); const en = st.enabledPlugins || {};
    const arr = Object.entries(inst.plugins || inst || {}).filter(([k]) => k.includes('@') || typeof inst.plugins === 'object').map(([id, v]) => { const x = Array.isArray(v) ? v[0] : v; return { id, version: (x && x.version) || '', scope: (x && x.scope) || 'user', installed: (x && x.installedAt) || '', enabled: en[id] !== false }; });
    return arr;
  }
  const mdTitle = (p) => { try { const t = fs.readFileSync(p, 'utf8'); const m = t.match(/^description:\s*(.+)$/m) || t.match(/^#\s+(.+)$/m); return m ? m[1].trim().slice(0, 140) : ''; } catch { return ''; } };
  function listDocs() {
    const out = []; const add = (cat, p, name) => { try { const st = fs.statSync(p); out.push({ category: cat, name: name || path.basename(p), path: p.replace(HOME, '~'), size: st.size, mtime: st.mtimeMs, desc: mdTitle(p) }); } catch {} };
    add('Hướng dẫn (CLAUDE.md)', path.join(CL, 'CLAUDE.md'), 'CLAUDE.md (toàn cục)');
    const scan = (cat, dir, deep) => { let e; try { e = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } e.forEach((x) => { const p = path.join(dir, x.name); if (x.isFile() && /\.md$/.test(x.name)) add(cat, p); else if (x.isDirectory() && deep) { const s = path.join(p, 'SKILL.md'); if (exists(s)) add(cat, s, x.name + '/SKILL.md'); } }); };
    scan('Agent', path.join(CL, 'agents')); scan('Lệnh (commands)', path.join(CL, 'commands')); scan('Skill', path.join(CL, 'skills'), true);
    const wf = (() => { try { return fs.readdirSync(FLOWS).filter((f) => f.endsWith('.json')).length; } catch { return 0; } })(); if (wf) out.push({ category: 'Workflow', name: wf + ' workflow đã lưu', path: '(S Hub) ' + FLOWS.replace(HOME, '~'), size: 0, mtime: Date.now(), desc: '' });
    const extra = rj(path.join(DIR, 'docs.json'), []);
    extra.forEach((d) => out.push({ category: d.category || 'Khác', name: d.name, path: d.path, size: 0, mtime: d.added, desc: d.desc || '', custom: true, id: d.id }));
    return out;
  }
  function listProjects() {
    const dirs = projDirs(); const reg = rj(path.join(DIR, 'projects.json'), []); const g = rj(path.join(HOME, '.claude.json'), {});
    const items = dirs.map((d) => { let sessions = 0, bytes = 0, last = 0; try { fs.readdirSync(d).forEach((f) => { if (!f.endsWith('.jsonl')) return; const st = fs.statSync(path.join(d, f)); sessions++; bytes += st.size; last = Math.max(last, st.mtimeMs); }); } catch {} const raw = path.basename(d); return { key: raw, name: raw.replace(/^-/, '/').replace(/-/g, '/'), sessions, bytes, last, source: 'Claude Code' }; });
    Object.keys(g.projects || {}).forEach((p) => { const k = p.replace(/[\/._]/g, '-'); if (!items.some((i) => i.key === k)) items.push({ key: k, name: p, sessions: 0, bytes: 0, last: 0, source: 'Claude Code' }); });
    reg.forEach((r) => items.push({ key: r.id, name: r.name, sessions: 0, bytes: 0, last: r.added, source: r.source || 'Thủ công', note: r.note, url: r.url, custom: true }));
    return items.sort((a, b) => b.last - a.last);
  }

  // ---------- workflow ----------
  const fp = (id) => path.join(FLOWS, id + '.json');
  const normFlow = (f, id) => {
    if (!f || !Array.isArray(f.nodes) || !f.nodes.length || f.nodes.length > 60) bad('Flow không hợp lệ: cần mảng nodes (1–60 node)');
    const types = ['trigger', 'claude', 'agent', 'tool', 'code', 'condition', 'human', 'output'];
    const nodes = f.nodes.map((n) => { if (!n || !/^[\w-]{1,40}$/.test(String(n.id)) || !types.includes(n.type)) bad('Node không hợp lệ: ' + JSON.stringify(n && n.id)); const cfg = {}; Object.entries(n.cfg || {}).forEach(([k, v]) => { if (/^\w{1,30}$/.test(k)) cfg[k] = String(v).slice(0, 8000); }); return { id: String(n.id), type: n.type, name: String(n.name || n.type).slice(0, 80), x: Number(n.x) || 0, y: Number(n.y) || 0, cfg }; });
    const ids = new Set(nodes.map((n) => n.id));
    const edges = (f.edges || []).filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({ from: e.from, to: e.to, port: e.port || 'out' }));
    return { id, name: String(f.name || 'Flow').slice(0, 80), category: String(f.category || 'Chung').slice(0, 30), summary: String(f.summary || '').slice(0, 300), nodes, edges, updated: Date.now() };
  };
  const listFlows = () => { try { return fs.readdirSync(FLOWS).filter((f) => f.endsWith('.json')).map((f) => { const x = rj(path.join(FLOWS, f), null); return x && { id: x.id, name: x.name, category: x.category, summary: x.summary, nodes: x.nodes.length, edges: x.edges.length, updated: x.updated, types: x.nodes.reduce((a, n) => ((a[n.type] = (a[n.type] || 0) + 1), a), {}) }; }).filter(Boolean).sort((a, b) => b.updated - a.updated); } catch { return []; } };
  function topo(f) { const indeg = {}; f.nodes.forEach((n) => (indeg[n.id] = 0)); f.edges.forEach((e) => indeg[e.to]++); const q = f.nodes.filter((n) => !indeg[n.id]).map((n) => n.id), out = []; while (q.length) { const i = q.shift(); out.push(i); f.edges.filter((e) => e.from === i).forEach((e) => { if (--indeg[e.to] === 0) q.push(e.to); }); } return out.length === f.nodes.length ? out : null; }
  function toMarkdown(f) {
    const order = topo(f) || f.nodes.map((n) => n.id); const L = ['# ' + f.name, '', f.summary || '', ''];
    order.forEach((id, i) => { const n = f.nodes.find((x) => x.id === id); L.push(`## ${i + 1}. ${n.name} (${n.type})`); Object.entries(n.cfg).forEach(([k, v]) => v && L.push(v.includes('\n') ? `- ${k}:\n\`\`\`\n${v}\n\`\`\`` : `- ${k}: ${v}`)); const o = f.edges.filter((e) => e.from === id).map((e) => ((f.nodes.find((x) => x.id === e.to) || {}).name || '?') + (e.port !== 'out' ? ` [${e.port}]` : '')); L.push('- nối tới: ' + (o.length ? o.join('; ') : '(kết thúc)'), ''); });
    return L.join('\n');
  }
  const CLAUDE_BIN = () => process.env.SHUB_CLAUDE_BIN || 'claude';
  function askClaude(prompt, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      let out = '', err = ''; const p = spawn(CLAUDE_BIN(), ['-p', prompt], { stdio: ['ignore', 'pipe', 'pipe'] });
      const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('Claude quá thời gian chờ')); }, timeoutMs);
      p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
      p.on('error', () => { clearTimeout(t); reject(new Error('Không chạy được lệnh "claude". Cài Claude Code và đăng nhập trước.')); });
      p.on('close', (c) => { clearTimeout(t); c === 0 ? resolve(out.trim()) : reject(new Error((err || 'claude lỗi ' + c).slice(0, 300))); });
    });
  }
  const interp = (s, ctx, input) => String(s || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, k) => (k === 'input' ? input : ctx[k] !== undefined ? ctx[k] : ''));
  async function runFlow(f, startText) {
    const order = topo(f); if (!order) bad('Flow có vòng lặp, chưa chạy được'); const outs = {}, ctx = {}, logs = []; const active = new Set([order[0]]);
    f.nodes.filter((n) => n.type === 'trigger').forEach((n) => active.add(n.id));
    for (const id of order) {
      const n = f.nodes.find((x) => x.id === id); const inEdges = f.edges.filter((e) => e.to === id);
      if (n.type !== 'trigger') { const live = inEdges.filter((e) => outs[e.from] && outs[e.from].ports.includes(e.port)); if (!live.length) { logs.push({ id, name: n.name, status: 'skipped' }); continue; } outs[id] = { text: '', ports: [] }; var input = live.map((e) => outs[e.from].text).join('\n\n'); } else var input = '';
      const c = n.cfg; let text = '', ports = ['out'], t0 = Date.now();
      try {
        if (n.type === 'trigger') text = startText || c.text || '';
        else if (n.type === 'claude') text = await askClaude((c.system ? interp(c.system, ctx, input) + '\n\n' : '') + interp(c.prompt || '{{input}}', ctx, input) + (/\{\{\s*input\s*\}\}/.test(c.prompt || '{{input}}') ? '' : '\n\n' + input));
        else if (n.type === 'agent') text = await askClaude(`Bạn là agent: ${interp(c.role || 'trợ lý', ctx, input)}.\nLàm lần lượt các bước, chỉ trả kết quả cuối:\n${interp(c.procedure, ctx, input)}\n\nDữ liệu đầu vào:\n${input}`);
        else if (n.type === 'tool') text = c.mock ? interp(c.mock, ctx, input) : `[Công cụ ${c.name || '?'} chưa nối thật] ${input.slice(0, 200)}`;
        else if (n.type === 'code') { text = input; ports = ['out']; logs.push({ id, name: n.name, status: 'note', out: 'Node mã JS không chạy trên máy chủ (an toàn); chuyển dữ liệu qua nguyên trạng.' }); }
        else if (n.type === 'condition') { text = input; const a = await askClaude(`Trả lời đúng một từ YES hoặc NO.\nCâu hỏi: ${interp(c.question, ctx, input)}\n\nNội dung:\n${input}`, 60000); ports = [/yes/i.test(a.slice(0, 20)) ? 'true' : 'false']; }
        else if (n.type === 'human') { text = input; ports = ['ok']; logs.push({ id, name: n.name, status: 'note', out: 'Người duyệt: tự động duyệt khi chạy từ S Hub (chưa có bước chờ người).' }); }
        else if (n.type === 'output') { text = input; ports = []; }
        outs[id] = { text, ports }; ctx[n.name] = text; logs.push({ id, name: n.name, status: 'done', ms: Date.now() - t0, out: text.slice(0, 4000) });
      } catch (e) { logs.push({ id, name: n.name, status: 'error', out: String(e.message) }); return { ok: false, logs }; }
    }
    return { ok: true, logs };
  }

  // ---------- HTTP ----------
  return async function handle(req, res, u) {
    if (!u.pathname.startsWith('/api/cl/')) return false;
    try {
      const route = u.pathname.slice(8); const q = u.searchParams;
      if (route === 'overview') {
        const sc = cacheScan(); const prj = listProjects(); const arts = rj(path.join(DIR, 'artifacts.json'), []);
        return json(res, 200, { ok: true, found: { claudeDir: exists(CL), desktop: exists(APPSUP) }, flows: listFlows().length, plugins: listPlugins().length, mcp: listMcp().length, docs: listDocs().length, artifacts: arts.length, projects: prj.length, cacheBytes: sc.reduce((a, b) => a + b.bytes, 0), cache: sc, claudeBytes: measure(CL, 0).bytes, sessionBytes: prj.reduce((a, b) => a + b.bytes, 0) }), true;
      }
      if (route === 'cache') { const over = {}; TARGETS.forEach((t) => { if (q.has('d_' + t.id)) over[t.id] = Number(q.get('d_' + t.id)); }); return json(res, 200, { ok: true, items: cacheScan(over) }), true; }
      if (route === 'plugins') return json(res, 200, { ok: true, items: listPlugins() }), true;
      if (route === 'mcp') return json(res, 200, { ok: true, items: listMcp() }), true;
      if (route === 'docs') return json(res, 200, { ok: true, items: listDocs() }), true;
      if (route === 'projects') return json(res, 200, { ok: true, items: listProjects() }), true;
      if (route === 'artifacts') return json(res, 200, { ok: true, items: rj(path.join(DIR, 'artifacts.json'), []) }), true;
      if (route === 'flows') return json(res, 200, { ok: true, items: listFlows() }), true;
      if (route === 'flow') { const id = q.get('id'); if (!ID.test(id || '') || !exists(fp(id))) bad('Không thấy workflow', 404); const f = rj(fp(id), null); return json(res, 200, { ok: true, flow: f, markdown: q.get('md') === '1' ? toMarkdown(f) : undefined }), true; }
      const b = req.method === 'POST' ? await body(req) : {};
      if (route === 'cache/clean') {
        const ids = Array.isArray(b.ids) ? b.ids.filter((x) => TARGETS.some((t) => t.id === x)) : []; if (!ids.length) bad('Chưa chọn mục nào');
        if (ids.includes('sessions') && b.confirm !== 'XOA') bad('Xóa transcript phiên cần gõ XOA để xác nhận');
        return json(res, 200, { ok: true, results: cacheClean(ids, b.days || {}) }), true;
      }
      if (route === 'flow/save') {
        let id = b.id && ID.test(b.id) ? b.id : slug(b.flow && b.flow.name || 'flow'); if (!b.id) { let n = id, i = 2; while (exists(fp(n))) n = id + '-' + i++; id = n; }
        const f = normFlow(b.flow, id); wj(fp(id), f); return json(res, 200, { ok: true, id, flow: f }), true;
      }
      if (route === 'flow/delete') { if (!ID.test(b.id || '') || !exists(fp(b.id))) bad('Không thấy workflow', 404); if (b.confirm !== b.id) bad('Gõ đúng mã workflow để xác nhận xóa'); fs.unlinkSync(fp(b.id)); return json(res, 200, { ok: true }), true; }
      if (route === 'flow/run') { if (!ID.test(b.id || '') || !exists(fp(b.id))) bad('Không thấy workflow', 404); const r = await runFlow(rj(fp(b.id), null), String(b.input || '').slice(0, 20000)); return json(res, 200, r), true; }
      if (route === 'flow/suggest') {
        const req0 = String(b.request || '').trim().slice(0, 1500); if (req0.length < 5) bad('Hãy mô tả yêu cầu (ít nhất vài từ)');
        const prompt = `Bạn thiết kế workflow agent. Với yêu cầu dưới đây, trả về DUY NHẤT một JSON (không giải thích, không markdown) dạng:
{"name":"...","summary":"...","nodes":[{"id":"n1","type":"trigger|claude|agent|tool|code|condition|human|output","name":"...","cfg":{}}],"edges":[{"from":"n1","to":"n2","port":"out"}]}
Quy tắc: 4-9 node, bắt đầu bằng 1 node trigger (cfg.text là dữ liệu mẫu), kết thúc bằng node output. cfg theo loại: claude{system,prompt}, agent{role,procedure,tools}, tool{name,desc,mock}, condition{question}, human{message}. Trong prompt dùng {{input}} cho dữ liệu từ node trước. port: "out" thường; condition dùng "true"/"false"; human dùng "ok"/"no". id chỉ gồm chữ thường, số, gạch ngang. Viết tiếng Việt.
Yêu cầu: ${req0}`;
        const out = await askClaude(prompt, 150000); const i = out.indexOf('{'), j = out.lastIndexOf('}'); if (i < 0 || j <= i) bad('Claude không trả về JSON hợp lệ, thử mô tả rõ hơn');
        let raw; try { raw = JSON.parse(out.slice(i, j + 1)); } catch { bad('Không đọc được JSON từ Claude, thử lại'); }
        const f = normFlow(raw, 'tmp'); return json(res, 200, { ok: true, flow: f }), true;
      }
      const simple = (file, build) => { const list = rj(path.join(DIR, file), []); return list; };
      if (route === 'artifact/save' || route === 'project/save' || route === 'doc/save') {
        const file = route.startsWith('artifact') ? 'artifacts.json' : route.startsWith('project') ? 'projects.json' : 'docs.json'; const list = simple(file);
        const name = String(b.name || '').trim().slice(0, 100); if (!name) bad('Thiếu tên');
        const url = String(b.url || '').trim(); if (url && !/^https:\/\/[^\s]{3,300}$/.test(url)) bad('Liên kết phải bắt đầu bằng https://');
        const item = { id: b.id && ID.test(b.id) ? b.id : 'i' + Date.now().toString(36), name, url, path: String(b.path || '').slice(0, 300), category: String(b.category || 'Chung').slice(0, 30), note: String(b.note || '').slice(0, 300), desc: String(b.note || '').slice(0, 300), tags: String(b.tags || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 8), added: Date.now() };
        const i = list.findIndex((x) => x.id === item.id); if (i >= 0) { item.added = list[i].added; list[i] = item; } else list.unshift(item); wj(path.join(DIR, file), list); return json(res, 200, { ok: true, item }), true;
      }
      if (route === 'artifact/delete' || route === 'project/delete' || route === 'doc/delete') {
        const file = route.startsWith('artifact') ? 'artifacts.json' : route.startsWith('project') ? 'projects.json' : 'docs.json'; wj(path.join(DIR, file), simple(file).filter((x) => x.id !== b.id)); return json(res, 200, { ok: true }), true;
      }
      return json(res, 404, { error: 'not found' }), true;
    } catch (e) { json(res, e.status || 500, { ok: false, error: String(e.message || e) }); return true; }
  };
};
