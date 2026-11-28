// Socin Studio: trợ lý Socin AI của S Hub.
// - Sổ lệnh chung (S Hub + Socin + máy chủ MCP khác) cho khung chat và cho cổng MCP của S Hub (/mcp).
// - Model: AI Socin (khoá AI quản lý trong admin Socin, gọi qua khoá S Creator), model trên máy (Ollama, mặc định Qwen3.5 4B).
// - Lưu cuộc trò chuyện, dự án (hướng dẫn + tài liệu làm ngữ cảnh) ở <workspace>/socin-studio/.
// Không dùng .env: khoá Socin dùng chung với S Creator (settings.json mode 600), mã khoá MCP sinh ngẫu nhiên lưu mode 600.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const AI = require('./public/aicore.js');
const mcpClients = require('./mcpclient.js');

const PLUGINS_OFFLINE = [
  { id: 'socin', name: 'Socin', icon: '🌐', category: 'socin', kind: 'builtin', needsSocin: true, offline: false, description: 'Tài khoản mạng xã hội, bài nháp TikTok/Threads, máy điều khiển từ xa và AI của doanh nghiệp trên app.socin.org.', homepage: 'https://app.socin.org' },
  { id: 'shub', name: 'S Hub', icon: '🧭', category: 'socin', kind: 'builtin', needsSocin: false, offline: true, description: 'Mở và vận hành các ứng dụng Socin trên máy: S Build Hub, S Test Hub, S VPS, Zoom worker, S Remote, S Game, Kho file, S GitHub.' },
  { id: 'sdraw', name: 'S Draw', icon: '📐', category: 'design', kind: 'mcp-http', url: 'auto', needsSocin: false, offline: true, description: 'Thiết kế nội thất và dựng 3D qua cổng MCP của S Draw (bật "Cho AI kết nối" trong S Draw).' },
  { id: 'blender', name: 'Blender', icon: '🧊', category: 'design', kind: 'mcp-stdio', command: 'uvx', args: ['blender-mcp'], requires: ['uvx'], needsSocin: false, offline: true, description: 'Điều khiển Blender (cần cài addon Blender MCP và bật trong Blender).', homepage: 'https://github.com/ahujasid/blender-mcp' },
  { id: 'figma', name: 'Figma (máy)', icon: '🎨', category: 'design', kind: 'mcp-http', url: 'http://127.0.0.1:3845/mcp', needsSocin: false, offline: false, description: 'Đọc thiết kế từ ứng dụng Figma trên máy (bật Dev Mode MCP server trong Figma).' },
  { id: 'github', name: 'GitHub', icon: '🐙', category: 'dev', kind: 'mcp-http', url: 'https://api.githubcopilot.com/mcp/', tokenLabel: 'GitHub token (ghp_… hoặc github_pat_…)', needsSocin: false, offline: false, description: 'Repo, issue, pull request trên GitHub.' },
  { id: 'playwright', name: 'Trình duyệt (Playwright)', icon: '🧪', category: 'dev', kind: 'mcp-stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'], requires: ['npx'], needsSocin: false, offline: true, description: 'Mở trang web, bấm, điền form, chụp màn hình.' },
  { id: 'context7', name: 'Context7', icon: '📚', category: 'dev', kind: 'mcp-stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'], requires: ['npx'], needsSocin: false, offline: false, description: 'Tra tài liệu thư viện lập trình mới nhất.' },
  { id: 'filesystem', name: 'Thư mục Tài liệu', icon: '🗂', category: 'data', kind: 'mcp-stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '~/Documents'], requires: ['npx'], needsSocin: false, offline: true, description: 'Đọc và ghi file trong ~/Documents (sửa thư mục khi cài).' },
  { id: 'memory', name: 'Bộ nhớ', icon: '🧠', category: 'data', kind: 'mcp-stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], requires: ['npx'], needsSocin: false, offline: true, description: 'Ghi nhớ thông tin lâu dài trên máy dưới dạng đồ thị.' },
  { id: 'fetch', name: 'Đọc trang web', icon: '🔗', category: 'content', kind: 'mcp-stdio', command: 'uvx', args: ['mcp-server-fetch'], requires: ['uvx'], needsSocin: false, offline: false, description: 'Tải nội dung trang web thành chữ để AI đọc.' },
];

const obj = (props = {}, required = []) => ({ type: 'object', properties: props, ...(required.length ? { required } : {}) });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });

module.exports = function socinAi({ WS, cfg, json, body, ROOT, fetchImpl }) {
  const DIR = path.join(WS, 'socin-studio');
  fs.mkdirSync(DIR, { recursive: true });
  const F = { chats: path.join(DIR, 'chats.json'), projects: path.join(DIR, 'projects.json'), llm: path.join(DIR, 'llm.json'), mcp: path.join(DIR, 'mcp.json'), run: path.join(DIR, 'run.json'), creator: path.join(WS, 'creator', 'settings.json') };
  const rj = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const wj = (f, v, mode) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v), mode ? { mode } : undefined); if (mode) try { fs.chmodSync(f, mode); } catch {} };
  const doFetch = fetchImpl || fetch;
  const mcp = mcpClients({ dir: DIR, fetchImpl });
  const bad = (m, code = 400) => { const e = new Error(m); e.code = code; throw e; };

  // ---------- gọi chính S Hub và Socin ----------
  async function hub(method, p, data) {
    const r = await doFetch(`http://127.0.0.1:${cfg.port}${p}`, { method, headers: { 'content-type': 'application/json' }, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(120000) });
    let j = null; try { j = await r.json(); } catch {}
    if (!r.ok || (j && j.error && !j.ok)) throw new Error((j && (j.error || j.message)) || `S Hub trả lỗi ${r.status}`);
    return j;
  }
  const socinLink = () => { const s = (rj(F.creator, {}).socin) || {}; return s.baseUrl && s.token ? { baseUrl: s.baseUrl, token: s.token } : null; };
  async function socin(method, p, data, timeout = 30000) {
    const l = socinLink(); if (!l) bad('Chưa đăng nhập Socin. Bấm "Đăng nhập Socin" ở góc trái dưới.', 409);
    if (!/^https:\/\/[\w.-]+(:\d+)?$/.test(l.baseUrl) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(l.baseUrl)) bad('Địa chỉ Socin phải là https://…');
    let r;
    try { r = await doFetch(l.baseUrl + p, { method, headers: { authorization: 'Bearer ' + l.token, 'content-type': 'application/json' }, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(timeout) }); }
    catch { const e = new Error('Không kết nối được Socin (mất mạng?)'); e.offline = true; throw e; }
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, data: j };
  }
  const socinOk = async (method, p, data) => { const r = await socin(method, p, data); if (r.status >= 300) throw new Error('Socin: ' + ((r.data && (r.data.message || r.data.error)) || 'HTTP ' + r.status)); return r.data; };

  // ---------- sổ lệnh ----------
  const short = (v) => JSON.stringify(v, null, 1).slice(0, 12000);
  const appsBrief = async () => ((await hub('GET', '/api/apps')).apps || []).map((a) => ({ id: a.id, name: a.name, type: a.type, online: a.online, desc: a.desc }));
  const TOOLS = [
    { name: 'hub_status', title: 'Trạng thái S Hub', access: 'read', plugin: 'shub', description: 'Tổng quan máy: ứng dụng nào đang chạy, Zoom worker, số server VPS, kiểm thử gần đây, kết nối Socin, máy chủ MCP.', inputSchema: obj(),
      async run() {
        const [apps, zoom, vps, rep] = await Promise.all([appsBrief(), hub('GET', '/api/zoom/status').catch(() => null), hub('GET', '/api/vps/servers').catch(() => null), hub('GET', '/api/reports?size=5').catch(() => null)]);
        return short({ apps: apps.map((a) => `${a.name}${a.online === true ? ' (đang chạy)' : a.online === false ? ' (tắt)' : ''}`), zoomWorker: zoom && { running: zoom.running, health: zoom.health }, vpsServers: vps ? (vps.servers || []).map((s) => ({ id: s.id, name: s.name, host: s.host, projects: (s.projects || []).length })) : [], recentTests: rep ? (rep.reports || []).map((r) => ({ repo: r.repo, at: r.at, failed: r.failed })) : [], socin: socinLink() ? socinLink().baseUrl : 'chưa đăng nhập', mcpServers: mcp.list().filter((s) => s.enabled).map((s) => s.name) });
      } },
    { name: 'list_apps', title: 'Danh sách ứng dụng', access: 'read', plugin: 'shub', description: 'Liệt kê các ứng dụng trong S Hub (id, tên, loại, đang chạy hay không).', inputSchema: obj(), async run() { return short(await appsBrief()); } },
    { name: 'open_app', title: 'Mở ứng dụng', access: 'edit', plugin: 'shub', description: 'Mở một ứng dụng Socin theo id (xem list_apps): công cụ trong S Hub mở ở khung bên cạnh chat, app trên Mac thì mở cửa sổ riêng, S Build Hub tự khởi động nếu chưa chạy.', inputSchema: obj({ id: str('id ứng dụng, ví dụ vps, test, build, zoom, remote, creator, sgame, files, github, claude, chat, clean') }, ['id']),
      async run({ id }) {
        const a = (await appsBrief()).find((x) => x.id === id); if (!a) return { text: `Không có ứng dụng "${id}". Dùng list_apps để xem id.`, isError: true };
        if (a.id === 'xpub') return { text: 'S Xpub (ví) chỉ mở bằng tay ở trang Ứng dụng, trợ lý không mở hộ.', isError: true };
        if (a.type === 'launch' || (a.type === 'web' && !a.online)) { await hub('POST', '/api/launch', { id }); }
        return { text: `${a.type === 'launch' ? 'Đã mở' : 'Mở'} ${a.name}.`, open: { id: a.id, name: a.name, type: a.type } };
      } },
    { name: 'list_repos', title: 'Repo GitHub', access: 'read', plugin: 'shub', description: 'Danh sách repo GitHub của tài khoản (tên, private, lần đẩy gần nhất).', inputSchema: obj({ q: str('lọc theo tên') }),
      async run({ q }) { const r = await hub('GET', '/api/repos'); const k = String(q || '').toLowerCase(); return short({ error: r.error || undefined, repos: (r.repos || []).filter((x) => !k || x.name.toLowerCase().includes(k)).slice(0, 60) }); } },
    { name: 'run_tests', title: 'Kiểm thử repo', access: 'edit', plugin: 'shub', description: 'Chạy S Test Hub (lint, build, test, bảo mật, giao diện) cho một repo GitHub. Trả id lượt chạy; xem kết quả bằng test_reports.', inputSchema: obj({ repo: str('tên repo dạng owner/name'), branch: str('nhánh, bỏ trống = mặc định') }, ['repo']),
      async run({ repo, branch }) { const r = (await hub('GET', '/api/repos')).repos || []; const f = r.find((x) => x.name.toLowerCase() === String(repo).toLowerCase()) || r.find((x) => x.name.toLowerCase().endsWith('/' + String(repo).toLowerCase())); if (!f) return { text: `Không thấy repo "${repo}" (xem list_repos)`, isError: true }; const x = await hub('POST', '/api/run', { name: f.name, url: f.url, branch }); return { text: `Đã bắt đầu kiểm thử ${f.name} (id ${x.id}). Xem tiến độ ở S Test Hub hoặc gọi test_reports sau vài phút.`, open: { id: 'test', name: 'S Test Hub', type: 'internal' } }; } },
    { name: 'test_reports', title: 'Kết quả kiểm thử', access: 'read', plugin: 'shub', description: 'Các lần kiểm thử gần đây và kết quả từng bước.', inputSchema: obj({ repo: str('lọc theo repo'), limit: { type: 'number', description: 'số lượng, mặc định 5' } }),
      async run({ repo, limit }) { const r = await hub('GET', `/api/reports?size=${Math.min(20, Math.max(5, Number(limit) || 5))}&repo=${encodeURIComponent(repo || '')}`); return short((r.reports || []).slice(0, Number(limit) || 5).map((x) => ({ id: x.id, repo: x.repo, at: x.at, seconds: x.seconds, passed: x.passed, failed: x.failed, steps: (x.results || []).map((s) => `${s.name}: ${s.status}${s.summary ? ' ' + s.summary : ''}`) }))); } },
    { name: 'vps_servers', title: 'Server VPS', access: 'read', plugin: 'shub', description: 'Danh sách server VPS và dự án đã cấu hình trong S VPS.', inputSchema: obj(),
      async run() { const r = await hub('GET', '/api/vps/servers'); return short((r.servers || []).map((s) => ({ id: s.id, name: s.name, host: s.host, user: s.user, projects: (s.projects || []).map((p) => ({ id: p.id, name: p.name, repo: p.repo, branch: p.branch, pm: p.pm, auto: p.auto })) }))); } },
    { name: 'vps_status', title: 'Tình trạng VPS', access: 'read', plugin: 'shub', description: 'SSH vào server xem CPU, RAM, ổ đĩa, dự án đang chạy.', inputSchema: obj({ server: str('id server (vps_servers)') }, ['server']), async run({ server }) { return short(await hub('POST', '/api/vps/status', { server })); } },
    { name: 'vps_logs', title: 'Nhật ký VPS', access: 'read', plugin: 'shub', description: 'Nhật ký triển khai của một dự án (hoặc nhật ký dọn rác nếu bỏ trống dự án).', inputSchema: obj({ server: str('id server'), project: str('id dự án') }, ['server']), async run({ server, project }) { return String((await hub('POST', '/api/vps/logs', { server, project })).out || '').slice(-8000); } },
    { name: 'vps_deploy', title: 'Triển khai lên VPS', access: 'files', plugin: 'shub', description: 'Cập nhật dự án trên VPS từ GitHub (pull, cài, build, khởi động lại; lỗi thì tự về bản cũ).', inputSchema: obj({ server: str('id server'), project: str('id dự án') }, ['server', 'project']),
      async run({ server, project }) { const r = await hub('POST', '/api/vps/deploy', { server, project }); return { text: `Đã bắt đầu triển khai (job ${r.id}). Theo dõi ở S VPS.`, open: { id: 'vps', name: 'S VPS', type: 'internal' } }; } },
    { name: 'vps_backup', title: 'Sao lưu VPS', access: 'files', plugin: 'shub', description: 'Chạy sao lưu ngay trên server.', inputSchema: obj({ server: str('id server') }, ['server']), async run({ server }) { const r = await hub('POST', '/api/vps/backup/run', { server }); return `Đã bắt đầu sao lưu (job ${r.id}).`; } },
    { name: 'zoom_status', title: 'Zoom worker', access: 'read', plugin: 'shub', description: 'Trạng thái Zoom worker trên máy này.', inputSchema: obj(), async run() { const z = await hub('GET', '/api/zoom/status'); return short({ running: z.running, pid: z.pid, startedAt: z.startedAt, health: z.health, link: z.link, lastExit: z.lastExit }); } },
    { name: 'zoom_start', title: 'Bật Zoom worker', access: 'edit', plugin: 'shub', description: 'Bật Zoom worker.', inputSchema: obj(), async run() { const z = await hub('POST', '/api/zoom/start', {}); return `Zoom worker ${z.running ? 'đang chạy' : 'chưa chạy'}.`; } },
    { name: 'zoom_stop', title: 'Tắt Zoom worker', access: 'edit', plugin: 'shub', description: 'Tắt Zoom worker.', inputSchema: obj(), async run() { await hub('POST', '/api/zoom/stop', {}); return 'Đã tắt Zoom worker.'; } },
    { name: 'zoom_restart', title: 'Khởi động lại Zoom worker', access: 'edit', plugin: 'shub', description: 'Khởi động lại Zoom worker.', inputSchema: obj(), async run() { const z = await hub('POST', '/api/zoom/restart', {}); return `Zoom worker ${z.running ? 'đang chạy' : 'chưa chạy'}.`; } },
    { name: 'remote_devices', title: 'Máy điều khiển từ xa', access: 'read', plugin: 'shub', description: 'Danh sách máy Windows điều khiển từ xa (S Remote, theo tài khoản Socin).', inputSchema: obj(), async run() { return short(await hub('GET', '/api/remote/devices')); } },
    { name: 'remote_connect', title: 'Điều khiển máy Windows', access: 'edit', plugin: 'shub', description: 'Mở RustDesk kết nối tới máy (target lấy từ remote_devices).', inputSchema: obj({ target: str('địa chỉ kết nối của máy') }, ['target']), async run({ target }) { await hub('POST', '/api/remote/connect', { target }); return 'Đã mở RustDesk kết nối tới máy.'; } },
    { name: 'sgame_status', title: 'Công cụ làm game', access: 'read', plugin: 'shub', description: 'S Game: máy đã đủ công cụ làm game, dựng 3D chưa.', inputSchema: obj(), async run() { const s = await hub('GET', '/api/sgame/status'); return short({ tools: (s.tools || []).map((t) => `${t.name}: ${t.ok ? 'có' : 'thiếu'}`), job: s.job }); } },
    { name: 'files_list', title: 'Kho file', access: 'read', plugin: 'shub', description: 'File tải về trong Kho file (backup VPS, báo cáo, build...).', inputSchema: obj({ category: str('danh mục'), q: str('tìm theo tên') }),
      async run({ category, q }) { const r = await hub('GET', `/api/files/list?size=30&category=${encodeURIComponent(category || '')}&q=${encodeURIComponent(q || '')}`); return short({ categories: r.categories, total: r.total, items: (r.items || []).map((i) => ({ name: i.name, category: i.category, size: i.size, mtime: i.mtime })) }); } },
    { name: 'creator_projects', title: 'Dự án S Creator', access: 'read', plugin: 'shub', description: 'Dự án content trong S Creator và lịch đăng.', inputSchema: obj({ q: str('tìm') }), async run({ q }) { const r = await hub('GET', `/api/cr/projects?q=${encodeURIComponent(q || '')}`); return short((r.projects || r.items || []).slice(0, 30).map((p) => ({ id: p.id, name: p.name, step: p.step, updated: p.updated, schedule: (p.schedule || []).length }))); } },
    { name: 'list_plugins', title: 'Plugin và kết nối', access: 'read', plugin: 'shub', description: 'Plugin trong kho Socin, máy chủ MCP đã kết nối và trạng thái.', inputSchema: obj(), async run() { return short({ installed: mcp.list(), catalog: (await catalog()).plugins.map((p) => ({ id: p.id, name: p.name, kind: p.kind, needsSocin: p.needsSocin })) }); } },
    // ---- Socin (cần đăng nhập) ----
    { name: 'socin_me', title: 'Tài khoản Socin', access: 'read', plugin: 'socin', description: 'Tài khoản Socin đang đăng nhập (tên, doanh nghiệp) và AI của doanh nghiệp.', inputSchema: obj(), async run() { const [me, ai] = await Promise.all([socinOk('GET', '/api/integration/creator/me'), socinOk('GET', '/api/integration/creator/ai/info').catch(() => null)]); return short({ ...me, ai }); } },
    { name: 'socin_accounts', title: 'Tài khoản MXH trên Socin', access: 'read', plugin: 'socin', description: 'Tài khoản TikTok, Threads của bạn trên Socin (để tạo bài nháp).', inputSchema: obj(), async run() { return short((await socinOk('GET', '/api/integration/creator/accounts')).accounts); } },
    { name: 'socin_create_draft', title: 'Tạo bài nháp trên Socin', access: 'files', plugin: 'socin', description: 'Tạo bài NHÁP TikTok hoặc Threads trên Socin (vẫn phải duyệt trong Socin trước khi đăng).', inputSchema: obj({ platform: str('tiktok hoặc threads', { enum: ['tiktok', 'threads'] }), account_id: str('id tài khoản (socin_accounts)'), title: str('tiêu đề'), caption: str('nội dung'), run_at: str('giờ đăng ISO 8601, tuỳ chọn') }, ['platform', 'account_id', 'title']),
      async run(a) { const r = await socinOk('POST', '/api/integration/creator/posts', { platform: a.platform, account_id: a.account_id, title: a.title, caption: a.caption, run_at: a.run_at, external_ref: 'chat:' + Date.now().toString(36) }); return `Đã tạo bài nháp (id ${r.id}, trạng thái ${r.status}). Vào Socin để gửi duyệt.`; } },
    { name: 'socin_remote_devices', title: 'Máy từ xa trên Socin', access: 'read', plugin: 'socin', description: 'Danh sách máy điều khiển từ xa đăng ký trên Socin (admin/chủ doanh nghiệp).', inputSchema: obj(), async run() { return short((await socinOk('GET', '/api/integration/creator/remote-devices')).devices); } },
  ];
  const BY = new Map(TOOLS.map((t) => [t.name, t]));
  /** Lệnh hiện cho model/MCP. withMcp: thêm lệnh của máy chủ MCP khác (chỉ dùng trong chat, không mở lại qua cổng MCP của S Hub). */
  async function allTools(withMcp) {
    const own = TOOLS.filter((t) => t.plugin !== 'socin' || socinLink()).map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, access: t.access, plugin: t.plugin }));
    return withMcp ? [...own, ...(await mcp.allTools()).map((t) => ({ ...t, plugin: 'mcp:' + t.server }))] : own;
  }
  async function callTool(name, args, { confirmed, mode = 'edit', via = 'chat' } = {}) {
    const t = BY.get(name);
    if (!t && /^mcp_/.test(name) && via === 'chat') {
      const def = (await mcp.allTools()).find((x) => x.name === name);
      if (!def) return { text: `Không có lệnh "${name}"`, isError: true };
      if (!AI.allowedBy(mode, def.access)) return { text: `Quyền hiện tại chưa cho phép lệnh ${name}.`, isError: true };
      if (AI.needsAsk(def.access) && !confirmed) return { text: 'Lệnh này cần người dùng đồng ý trước.', isError: true };
      try { return await mcp.call(name, args); } catch (e) { return { text: e.message, isError: true }; }
    }
    if (!t || (t.plugin === 'socin' && !socinLink())) return { text: `Không có lệnh "${name}"${t ? ' (cần đăng nhập Socin)' : ''}`, isError: true };
    if (!AI.allowedBy(mode, t.access)) return { text: `Quyền hiện tại chưa cho phép lệnh ${name}.`, isError: true };
    if (AI.needsAsk(t.access) && !confirmed) return { text: 'Lệnh này cần người dùng đồng ý trước.', isError: true };
    try {
      const r = await t.run(args && typeof args === 'object' ? args : {});
      return typeof r === 'string' ? { text: r } : r;
    } catch (e) { return { text: String(e.message || e), isError: true }; }
  }

  // ---------- kho plugin ----------
  let catCache = null;
  async function catalog() {
    if (socinLink()) {
      if (catCache && Date.now() - catCache.at < 300000) return catCache.data;
      try { const r = await socin('GET', '/api/integration/creator/plugins', null, 10000); if (r.status === 200 && r.data && Array.isArray(r.data.plugins)) { catCache = { at: Date.now(), data: { source: 'socin', plugins: r.data.plugins, store: r.data.store || [], storeUrl: r.data.store_url || '' } }; return catCache.data; } } catch {}
    }
    return { source: 'offline', plugins: PLUGINS_OFFLINE, store: [], storeUrl: '' };
  }
  async function account() {
    const l = socinLink(); if (!l) return { linked: false };
    try {
      const [me, ai] = await Promise.all([socin('GET', '/api/integration/creator/me', null, 8000), socin('GET', '/api/integration/creator/ai/info', null, 8000)]);
      return { linked: true, baseUrl: l.baseUrl, online: true, me: me.status === 200 ? me.data : null, ai: ai.status === 200 ? ai.data : null, error: me.status === 200 ? '' : me.status === 401 ? 'Khoá Socin không đúng hoặc đã thu hồi' : `Socin trả ${me.status}` };
    } catch (e) { return { linked: true, baseUrl: l.baseUrl, online: false, error: e.message }; }
  }

  // ---------- model trên máy (Ollama) ----------
  const llmCfg = () => AI.cleanLlmConfig(rj(F.llm, {}));
  let pulling = null; let ollamaProc = null; let installJob = null;
  const hasBin = (b) => spawnSync('sh', ['-c', `command -v ${b}`], { encoding: 'utf8', env: { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin` } }).status === 0;
  const appPath = () => ['/Applications/Ollama.app', path.join(os.homedir(), 'Applications', 'Ollama.app')].find((p) => fs.existsSync(p)) || '';
  const ollamaBin = () => { for (const p of ['/opt/homebrew/bin/ollama', '/usr/local/bin/ollama']) if (fs.existsSync(p)) return p; if (hasBin('ollama')) return 'ollama'; const a = appPath(); return a ? path.join(a, 'Contents', 'Resources', 'ollama') : ''; };
  async function listModels() {
    try { const r = await doFetch(`${AI.OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) }); if (!r.ok) return null; const d = await r.json(); return (d.models || []).map((m) => String(m.name || '')).filter(Boolean); } catch { return null; }
  }
  async function llmStatus() {
    const config = llmCfg(); const models = await listModels();
    const has = (models || []).some((m) => m === config.model || m === config.model + ':latest');
    return { config, installed: models !== null || !!ollamaBin(), running: models !== null, models: models || [], ready: models !== null && has, pulling, installing: installJob, brew: hasBin('brew'), choices: AI.LOCAL_MODELS };
  }
  async function startOllama() {
    if (await listModels()) return;
    const a = appPath();
    if (a && process.platform === 'darwin') spawn('open', ['-ga', a], { stdio: 'ignore', detached: true }).unref();
    else { const b = ollamaBin(); if (!b) bad('Chưa cài Ollama. Bấm "Cài Ollama" trước.'); if (!ollamaProc || ollamaProc.exitCode !== null) { ollamaProc = spawn(b, ['serve'], { stdio: 'ignore', detached: true, env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434' } }); ollamaProc.unref(); } }
    for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 500)); if (await listModels()) return; }
  }
  function installOllama() {
    if (installJob && installJob.running) return installJob;
    if (!hasBin('brew')) { spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', ['https://ollama.com/download'], { stdio: 'ignore', detached: true }).unref(); installJob = { running: false, ok: false, manual: true, text: 'Đã mở trang tải Ollama. Cài xong quay lại bấm "Kiểm tra lại".' }; return installJob; }
    installJob = { running: true, text: 'Đang cài Ollama bằng Homebrew…' };
    const p = spawn('sh', ['-c', 'brew install ollama'], { env: { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin`, HOMEBREW_NO_AUTO_UPDATE: '1' } });
    let out = ''; p.stdout.on('data', (d) => { out = (out + d).slice(-600); installJob.text = out.trim().split('\n').pop(); }); p.stderr.on('data', (d) => { out = (out + d).slice(-600); });
    p.on('close', (c) => { installJob = { running: false, ok: c === 0, text: c === 0 ? 'Đã cài Ollama.' : 'Cài lỗi: ' + out.trim().split('\n').slice(-2).join(' ') }; });
    return installJob;
  }
  async function pull(model) {
    if (pulling) bad('Đang tải một model, chờ xong.');
    await startOllama();
    pulling = { model, percent: 0, text: 'Bắt đầu tải' };
    (async () => {
      try {
        const r = await doFetch(`${AI.OLLAMA_URL}/api/pull`, { method: 'POST', body: JSON.stringify({ model, stream: true }) });
        if (!r.ok || !r.body) throw new Error('Ollama trả về ' + r.status);
        const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true }); let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
            const ev = JSON.parse(line); if (ev.error) throw new Error(ev.error);
            pulling = { model, percent: ev.total ? Math.round(((ev.completed || 0) / ev.total) * 100) : pulling.percent, text: ev.status || '' };
          }
        }
        pulling = null;
      } catch (e) { pulling = null; installJob = { running: false, ok: false, text: 'Tải model lỗi: ' + e.message }; }
    })();
  }
  async function llmChat(messages, tools, context) {
    const c = llmCfg();
    try {
      await startOllama();
      const r = await doFetch(`${AI.OLLAMA_URL}/api/chat`, { method: 'POST', body: JSON.stringify(AI.ollamaBody(c.model, messages, tools, context)), signal: AbortSignal.timeout(180000) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, error: d.error || 'Ollama trả về ' + r.status };
      return { ok: true, content: AI.fromOllama(d.message, new Set(AI.localTools(tools).map((t) => t.name))) };
    } catch (e) { return { ok: false, error: `Model trên máy chưa chạy được (${e.message}). Mở nút Model để cài Ollama và tải model.` }; }
  }

  // ---------- cổng MCP của S Hub (cho Claude, ChatGPT, Cursor...) ----------
  const mcpCfg = () => { const c = rj(F.mcp, {}); return { enabled: c.enabled === true, token: typeof c.token === 'string' && c.token.length >= 24 ? c.token : '', mode: ['read', 'edit', 'full'].includes(c.mode) ? c.mode : 'edit' }; };
  const saveMcp = (c) => wj(F.mcp, c, 0o600);
  const ensureToken = () => { const c = mcpCfg(); if (!c.token) { c.token = crypto.randomBytes(24).toString('base64url'); saveMcp(c); } return c; };
  const mcpLog = [];
  const INSTRUCTIONS = 'S Hub (Socin) trên máy người dùng: mở và vận hành các ứng dụng Socin (S Build Hub, S Test Hub, S VPS, Zoom worker, S Remote, S Creator...) và Socin app.socin.org. Gọi hub_status trước để biết máy đang có gì. Trả lời người dùng bằng tiếng Việt.';
  const mcpVisible = (defs, mode) => defs.filter((d) => (mode === 'full' ? true : mode === 'edit' ? d.access === 'read' || d.access === 'edit' : d.access === 'read'));
  async function rpc(msg) {
    const reply = (result) => ({ jsonrpc: '2.0', id: msg.id ?? null, result });
    const fail = (code, message) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
    if (!msg || typeof msg !== 'object' || typeof msg.method !== 'string') return fail(-32600, 'Yêu cầu không hợp lệ');
    if (msg.id === undefined) return undefined;
    const c = mcpCfg();
    switch (msg.method) {
      case 'initialize': return reply({ protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'socin-hub', title: 'Socin (S Hub)', version: '1.0.0' }, instructions: INSTRUCTIONS });
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: mcpVisible(await allTools(false), c.mode).map((d) => ({ name: d.name, title: d.title, description: d.description, inputSchema: d.inputSchema, annotations: { readOnlyHint: d.access === 'read', destructiveHint: d.access === 'files' } })) });
      case 'tools/call': {
        const name = String(msg.params?.name || ''); const def = (await allTools(false)).find((d) => d.name === name);
        if (!def || !mcpVisible([def], c.mode).length) return reply({ content: [{ type: 'text', text: `Không có lệnh "${name}" hoặc cổng MCP đang để quyền thấp hơn (đổi ở S Hub → Plugin → Cổng MCP).` }], isError: true });
        const r = await callTool(name, msg.params?.arguments || {}, { confirmed: true, mode: 'full', via: 'mcp' });
        mcpLog.unshift({ at: Date.now(), tool: name, ok: !r.isError }); mcpLog.length = Math.min(mcpLog.length, 20);
        return reply({ content: [{ type: 'text', text: r.text }, ...(r.image ? [{ type: 'image', mimeType: r.image.split(';')[0].slice(5), data: r.image.split(',')[1] }] : [])], isError: !!r.isError });
      }
      case 'resources/list': return reply({ resources: [] });
      case 'prompts/list': return reply({ prompts: [] });
      default: return fail(-32601, `Không hỗ trợ ${msg.method}`);
    }
  }
  const claudeDesktopPath = () => process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json') : process.platform === 'win32' ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json') : path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
  const stdioEntry = () => ({ command: process.execPath, args: [path.join(ROOT, 'mcp-stdio.js')], env: { SHUB_WORKSPACE: WS } });
  const mcpPub = () => { const c = mcpCfg(); return { enabled: c.enabled, mode: c.mode, url: `http://127.0.0.1:${cfg.port}/mcp`, token: c.token, log: mcpLog.slice(0, 10), stdio: stdioEntry(), claudeDesktop: claudeDesktopPath(), cursor: { mcpServers: { socin: { url: `http://127.0.0.1:${cfg.port}/mcp`, headers: { Authorization: `Bearer ${c.token}` } } } } }; };
  function addToClaudeDesktop() {
    const f = claudeDesktopPath(); let j = {};
    if (fs.existsSync(f)) { try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { bad('File cấu hình Claude Desktop đang lỗi JSON, sửa tay trước: ' + f); } fs.copyFileSync(f, f + '.bak-shub'); }
    j.mcpServers = { ...(j.mcpServers || {}), socin: stdioEntry() };
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(j, null, 2));
    return f;
  }

  // ---------- lưu trữ ----------
  const chats = () => AI.cleanChats(rj(F.chats, []));
  const projects = () => AI.cleanProjects(rj(F.projects, []));

  // ---------- HTTP ----------
  const MAXB = 12 * 1024 * 1024;
  const bigBody = (req) => new Promise((resolve, reject) => { let n = 0; const parts = []; req.on('data', (d) => { n += d.length; if (n > MAXB) { reject(Object.assign(new Error('Gói gửi quá lớn'), { code: 413 })); req.destroy(); } else parts.push(d); }); req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch { resolve({}); } }); });

  async function handleMcp(req, res) {
    const c = mcpCfg();
    if (!c.enabled || !c.token) return json(res, 503, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Cổng MCP của S Hub đang tắt. Bật ở S Hub → Plugin → Cổng MCP.' } });
    const h = String(req.headers.authorization || ''); const got = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : ''); const want = Buffer.from(c.token);
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return json(res, 401, { error: 'unauthorized' });
    if (req.method === 'GET' || req.method === 'DELETE') { res.writeHead(405, { Allow: 'POST' }); return res.end(); }
    if (req.method !== 'POST') return json(res, 405, {});
    let msg; try { msg = await bigBody(req); } catch { return json(res, 413, {}); }
    const batch = Array.isArray(msg) ? msg.slice(0, 50) : [msg];
    const out = (await Promise.all(batch.map(rpc))).filter(Boolean);
    if (!out.length) { res.writeHead(202); return res.end(); }
    return json(res, 200, Array.isArray(msg) ? out : out[0]);
  }

  const handler = async (req, res, u) => {
    if (u.pathname === '/mcp') { await handleMcp(req, res); return true; }
    if (!u.pathname.startsWith('/api/ai/')) return false;
    const r = u.pathname.slice(8); const post = req.method === 'POST';
    try {
      if (r === 'tools') return json(res, 200, { tools: await allTools(true) }), true;
      if (r === 'call' && post) { const b = await bigBody(req); return json(res, 200, await callTool(String(b.name || ''), b.input || {}, { confirmed: !!b.confirmed, mode: ['read', 'edit', 'full'].includes(b.mode) ? b.mode : 'edit' })), true; }
      if (r === 'account') return json(res, 200, await account()), true;
      if (r === 'plugins') return json(res, 200, { ...(await catalog()), servers: mcp.list() }), true;
      if (r === 'socin' && post) {
        const b = await bigBody(req);
        if (!socinLink()) return json(res, 200, { status: 409, error: 'Chưa đăng nhập Socin', fallback: true }), true;
        try {
          const x = await socin('POST', '/api/integration/creator/ai/agent', { messages: AI.trimHistory(b.messages || []), tools: b.tools || [], context: String(b.context || '') }, 150000);
          if (x.status === 200 && x.data && Array.isArray(x.data.content)) return json(res, 200, { ok: true, content: x.data.content, provider: x.data.provider, model: x.data.model }), true;
          return json(res, 200, { ok: false, status: x.status, error: (x.data && (x.data.message || x.data.error)) || 'HTTP ' + x.status, fallback: !!(x.data && x.data.fallback) || x.status === 404 || x.status === 501 }), true;
        } catch (e) { return json(res, 200, { ok: false, error: e.message, fallback: true }), true; }
      }
      // cuộc trò chuyện + dự án
      if (r === 'chats' && !post) return json(res, 200, { chats: chats() }), true;
      if (r === 'chats' && post) { const b = await bigBody(req); wj(F.chats, AI.cleanChats(b.chats)); return json(res, 200, { ok: true }), true; }
      if (r === 'projects' && !post) return json(res, 200, { projects: projects() }), true;
      if (r === 'projects' && post) { const b = await body(req); wj(F.projects, AI.cleanProjects(b.projects)); return json(res, 200, { ok: true, projects: projects() }), true; }
      // model trên máy
      if (r === 'llm') return json(res, 200, await llmStatus()), true;
      if (r === 'llm/config' && post) { const b = await body(req); wj(F.llm, AI.cleanLlmConfig({ ...llmCfg(), ...b })); return json(res, 200, await llmStatus()), true; }
      if (r === 'llm/install' && post) { installOllama(); return json(res, 200, await llmStatus()), true; }
      if (r === 'llm/start' && post) { await startOllama(); return json(res, 200, await llmStatus()), true; }
      if (r === 'llm/pull' && post) { const b = await body(req); await pull(AI.cleanLlmConfig({ model: b.model || llmCfg().model }).model); return json(res, 200, await llmStatus()), true; }
      if (r === 'llm/chat' && post) { const b = await bigBody(req); return json(res, 200, await llmChat(b.messages || [], b.tools || [], String(b.context || ''))), true; }
      // máy chủ MCP khác
      if (r === 'mcp/servers' && !post) return json(res, 200, { servers: mcp.list() }), true;
      if (r === 'mcp/servers' && post) { const b = await body(req); return json(res, 200, { server: mcp.save(b) }), true; }
      if (r === 'mcp/toggle' && post) { const b = await body(req); return json(res, 200, { server: mcp.toggle(b.id, b.enabled) }), true; }
      if (r === 'mcp/remove' && post) { const b = await body(req); mcp.remove(b.id); return json(res, 200, { ok: true }), true; }
      if (r === 'mcp/test' && post) { const b = await body(req); try { return json(res, 200, { ok: true, ...(await mcp.test(b.id)) }), true; } catch (e) { return json(res, 200, { ok: false, error: e.message }), true; } }
      // cổng MCP của S Hub
      if (r === 'gateway' && !post) return json(res, 200, mcpPub()), true;
      if (r === 'gateway' && post) {
        const b = await body(req); const c = ensureToken();
        if (b.enabled !== undefined) c.enabled = !!b.enabled;
        if (['read', 'edit', 'full'].includes(b.mode)) c.mode = b.mode;
        if (b.newToken) c.token = crypto.randomBytes(24).toString('base64url');
        saveMcp(c); return json(res, 200, mcpPub()), true;
      }
      if (r === 'gateway/claude-desktop' && post) { ensureToken(); const f = addToClaudeDesktop(); return json(res, 200, { ok: true, path: f, note: 'Khởi động lại Claude Desktop để thấy Socin.' }), true; }
      return json(res, 404, { error: 'not found' }), true;
    } catch (e) { return json(res, e.code === 413 ? 413 : e.code === 409 ? 409 : 400, { error: String(e.message || e) }), true; }
  };
  handler.onListen = (port) => { try { wj(F.run, { url: `http://127.0.0.1:${port}/mcp`, pid: process.pid }, 0o600); } catch {} };
  handler.callTool = callTool; handler.allTools = allTools; handler.rpc = rpc; handler.mcp = mcp;
  return handler;
};
module.exports.PLUGINS_OFFLINE = PLUGINS_OFFLINE;
