// Lõi trợ lý Socin AI (Socin Chat), dùng chung cho trình duyệt (window.AICore) và server Node (require).
// Cùng thiết kế với Chat thiết kế của S Draw: tin nhắn theo khối như Messages API (text, image, tool_use, tool_result),
// vòng lặp một lượt (hỏi model → chạy lệnh → gửi kết quả → lặp), bộ hiểu lệnh khi không có model,
// và chuyển đổi sang Ollama cho model chạy trên máy (mặc định Qwen3.5 4B).
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.AICore = m;
})(typeof self !== 'undefined' ? self : this, function () {
  const LIMITS = { messages: 60, textChars: 20000, contextChars: 6000, imagesKept: 2, imageB64: 1600000 };

  const SYSTEM = `Bạn là Socin AI, trợ lý vận hành hệ sinh thái Socin ngay trên máy người dùng (S Hub, S Draw, S Build Hub, S Test Hub, S VPS, Zoom worker, S Remote, S Creator, Socin app.socin.org...). Trả lời bằng tiếng Việt, ngắn gọn, rõ ràng.
Quy tắc:
- Dùng lệnh (tools) để xem trạng thái và thao tác các ứng dụng; không bịa kết quả, đường dẫn, tên hay id: lấy từ kết quả lệnh.
- Câu hỏi chỉ cần trả lời thì trả lời, không gọi lệnh thừa. Việc nhiều bước thì làm lần lượt và nói rõ đã làm gì, kết quả ở đâu.
- Lệnh thay đổi lớn hoặc tốn phí sẽ được app hỏi người dùng; nếu bị từ chối thì dừng và hỏi lại người dùng.
- Không bao giờ yêu cầu hay nhắc lại cụm từ khôi phục ví, khoá riêng, mật khẩu.`;

  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

  /** Phần chữ của một tin nhắn (bỏ lệnh và ảnh). */
  function textOf(m) { return (m.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(); }

  /** Tên cuộc trò chuyện tự đặt từ câu đầu của người dùng. */
  function titleFrom(text) {
    const t = String(text || '').replace(/\s+/g, ' ').replace(/^\/\S+\s*/, '').trim();
    if (!t) return 'Cuộc trò chuyện mới';
    return t.length > 48 ? t.slice(0, 47).trimEnd() + '…' : t.charAt(0).toUpperCase() + t.slice(1);
  }

  /** Cắt gọn lịch sử: giữ các tin gần nhất (không cắt giữa cặp tool_use/tool_result), chỉ giữ vài ảnh mới nhất. */
  function trimHistory(messages, maxMessages = LIMITS.messages, imagesKept = LIMITS.imagesKept) {
    let start = Math.max(0, messages.length - maxMessages);
    while (start < messages.length && !(messages[start].role === 'user' && messages[start].content.some((b) => b.type !== 'tool_result'))) start++;
    const out = messages.slice(start);
    let keep = imagesKept;
    const old = { type: 'text', text: '[ảnh cũ đã lược bớt]' };
    for (let i = out.length - 1; i >= 0; i--) {
      out[i] = { ...out[i], content: out[i].content.map((b) => {
        if (b.type === 'image') return keep-- > 0 ? b : old;
        if (b.type === 'tool_result') return { ...b, content: b.content.map((c) => (c.type === 'image' ? (keep-- > 0 ? c : old) : c)) };
        return b;
      }) };
    }
    return out;
  }

  /** Thêm câu của người dùng vào lịch sử (gộp vào lượt người dùng trước nếu lượt đó là kết quả lệnh). */
  function appendUser(history, content) {
    const last = history[history.length - 1];
    if (last && last.role === 'user') return [...history.slice(0, -1), { role: 'user', content: [...last.content, ...content] }];
    return [...history, { role: 'user', content }];
  }

  function imageBlock(dataUrl) {
    const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    return m ? { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } } : null;
  }

  let seq = 0;
  const toolUseId = () => `tu_${Date.now().toString(36)}_${(seq++).toString(36)}`;

  // ---------- Quyền ----------
  /** read: chỉ xem · edit: thao tác thường · files: thay đổi lớn (hỏi trước) · paid: tốn phí (luôn hỏi) */
  const MODES = { read: 'Chỉ xem', edit: 'Xem và thao tác', full: 'Đầy đủ' };
  function allowedBy(mode, access) { return access === 'read' || (access === 'edit' ? mode !== 'read' : mode === 'full' || mode === 'edit'); }
  const needsAsk = (access) => access === 'files' || access === 'paid';

  // ---------- Bộ hiểu lệnh (không có model) ----------
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
  function parseArgs(rest) {
    rest = rest.trim();
    if (!rest) return {};
    if (rest.startsWith('{')) { try { const j = JSON.parse(rest); return isObj(j) ? j : {}; } catch { return {}; } }
    const o = {}; let free = [];
    for (const tok of rest.match(/(?:[^\s"]+|"[^"]*")+/g) || []) {
      const m = /^([a-zA-Z_][\w]*)=(.*)$/.exec(tok);
      if (m) { let v = m[2].replace(/^"|"$/g, ''); o[m[1]] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v; }
      else free.push(tok.replace(/^"|"$/g, ''));
    }
    if (free.length) o._ = free.join(' ');
    return o;
  }
  /** Tìm id ứng dụng theo tên gõ (không dấu, gần đúng). */
  function matchApp(text, apps) {
    const q = norm(text).replace(/^(ung dung|app|cong cu)\s+/, '').trim();
    if (!q) return null;
    let best = null, score = 0;
    for (const a of apps || []) {
      const n = norm(a.name), id = norm(a.id);
      const s = n === q || id === q ? 3 : n.includes(q) || q.includes(n) ? 2 : n.replace(/^s\s+/, '').includes(q) || q.includes(n.replace(/^s\s+/, '')) ? 1 : 0;
      if (s > score) { best = a; score = s; }
    }
    return best;
  }

  /** Câu tiếng Việt hoặc lệnh gạch chéo → kế hoạch gọi lệnh. ctx: { toolNames, apps } */
  function localPlan(text, ctx) {
    const raw = String(text || '').trim();
    const names = new Set(ctx.toolNames || []);
    const has = (n) => names.has(n);
    const help = () => ({ text: `Đang chạy không có model AI, mình hiểu các lệnh sau (gõ "/" để chọn):\n${[...names].slice(0, 40).map((n) => '• /' + n).join('\n')}${names.size > 40 ? `\n… và ${names.size - 40} lệnh khác` : ''}\n\nVí dụ: "trạng thái", "mở S VPS", "bật zoom worker", "danh sách server". Muốn trò chuyện tự do thì bật model ở nút Model dưới khung chat.`, calls: [] });
    if (!raw) return help();
    if (raw.startsWith('/')) {
      const m = /^\/([\w-]+)\s*([\s\S]*)$/.exec(raw);
      if (!m) return help();
      const name = m[1];
      if (name === 'help' || name === 'lenh') return help();
      if (!has(name)) return { text: `Không có lệnh /${name}.`, calls: [] };
      const input = parseArgs(m[2]);
      if (input._ !== undefined) {
        const one = (ctx.firstArg || {})[name];
        if (one) { input[one] = input._; }
        delete input._;
      }
      return { text: '', calls: [{ name, input }] };
    }
    const q = norm(raw);
    const rules = [
      [/^(giup|tro giup|help|lenh|cac lenh|ban lam duoc gi)/, () => help()],
      [/(trang thai|tong quan|dang chay gi|tinh hinh)/, () => has('hub_status') && { text: 'Mình xem trạng thái S Hub.', calls: [{ name: 'hub_status', input: {} }] }],
      [/(bat|chay|khoi dong) .*zoom/, () => has('zoom_start') && { text: 'Bật Zoom worker.', calls: [{ name: 'zoom_start', input: {} }] }],
      [/(tat|dung) .*zoom/, () => has('zoom_stop') && { text: 'Tắt Zoom worker.', calls: [{ name: 'zoom_stop', input: {} }] }],
      [/zoom/, () => has('zoom_status') && { text: '', calls: [{ name: 'zoom_status', input: {} }] }],
      [/(server|may chu|vps)/, () => has('vps_servers') && { text: '', calls: [{ name: 'vps_servers', input: {} }] }],
      [/(bao cao|ket qua) (kiem thu|test)/, () => has('test_reports') && { text: '', calls: [{ name: 'test_reports', input: {} }] }],
      [/(danh sach )?repo/, () => has('list_repos') && { text: '', calls: [{ name: 'list_repos', input: {} }] }],
      [/(plugin|ket noi|mcp)/, () => has('list_plugins') && { text: '', calls: [{ name: 'list_plugins', input: {} }] }],
      [/(may windows|dieu khien tu xa|remote)/, () => has('remote_devices') && { text: '', calls: [{ name: 'remote_devices', input: {} }] }],
      [/(ung dung|app|cong cu)( nao)?$|danh sach (ung dung|app)/, () => has('list_apps') && { text: '', calls: [{ name: 'list_apps', input: {} }] }],
    ];
    for (const [re, fn] of rules.slice(0, 4)) if (re.test(q)) { const r = fn(); if (r) return r; } // bật/tắt zoom trước "mở <app>"
    const open = /^(mo|bat|vao|chay)\s+(.+)$/.exec(q);
    if (open && has('open_app')) {
      const a = matchApp(open[2], ctx.apps);
      if (a) return { text: `Mở ${a.name}.`, calls: [{ name: 'open_app', input: { id: a.id } }] };
    }
    for (const [re, fn] of rules) if (re.test(q)) { const r = fn(); if (r) return r; }
    return help();
  }

  // ---------- Vòng lặp một lượt ----------
  async function runCalls(calls, deps) {
    const out = [];
    for (const c of calls) {
      if (deps.aborted()) { out.push({ type: 'tool_result', tool_use_id: c.id, content: [{ type: 'text', text: 'Người dùng đã dừng trước khi chạy lệnh này.' }], is_error: true }); continue; }
      let r;
      try { r = await deps.runTool(c.name, c.input || {}); } catch (e) { r = { text: String((e && e.message) || e), isError: true }; }
      const img = r.image ? imageBlock(r.image) : null;
      out.push({ type: 'tool_result', tool_use_id: c.id, content: [{ type: 'text', text: String(r.text || '').slice(0, 20000) || '(xong)' }, ...(img ? [img] : [])], ...(r.isError ? { is_error: true } : {}) });
    }
    return out;
  }

  /** deps: { model(messages) → {ok, content}|{ok:false, fallback, error} | null, localCtx, runTool, onUpdate, aborted, maxSteps } */
  async function runTurn(history, deps) {
    let msgs = history;
    const push = (m) => { msgs = [...msgs, m]; deps.onUpdate(msgs); };
    const lastUser = [...history].reverse().find((m) => m.role === 'user');
    const local = async () => {
      const plan = localPlan(lastUser ? textOf(lastUser) : '', deps.localCtx || {});
      const calls = plan.calls.map((c) => ({ type: 'tool_use', id: toolUseId(), name: c.name, input: c.input }));
      push({ role: 'assistant', content: [...(plan.text ? [{ type: 'text', text: plan.text }] : []), ...calls] });
      if (calls.length) {
        const results = await runCalls(calls, deps);
        push({ role: 'user', content: results });
        const bad = results.filter((r) => r.is_error).length;
        push({ role: 'assistant', content: [{ type: 'text', text: bad ? `Có ${bad} lệnh chưa chạy được, xem chi tiết ở trên.` : 'Xong.' }] });
      }
      return { messages: msgs, source: 'local' };
    };
    if (!deps.model) return local();
    const max = deps.maxSteps || 16;
    for (let step = 0; step < max; step++) {
      if (deps.aborted()) return { messages: msgs, source: 'llm' };
      const r = await deps.model(msgs);
      if (!r.ok) {
        if (r.fallback && step === 0) return local();
        push({ role: 'assistant', content: [{ type: 'text', text: `Không hỏi được model: ${r.error}` }] });
        return { messages: msgs, source: 'llm', error: r.error };
      }
      const content = r.content && r.content.length ? r.content : [{ type: 'text', text: '(không có trả lời)' }];
      push({ role: 'assistant', content });
      const calls = content.filter((b) => b.type === 'tool_use');
      if (!calls.length) return { messages: msgs, source: 'llm' };
      push({ role: 'user', content: await runCalls(calls, deps) });
    }
    push({ role: 'assistant', content: [{ type: 'text', text: `Đã làm ${max} bước liên tiếp nên tạm dừng. Gõ "tiếp tục" nếu muốn làm tiếp.` }] });
    return { messages: msgs, source: 'llm' };
  }

  // ---------- Model trên máy (Ollama) ----------
  const LOCAL_MODELS = [
    { id: 'qwen3.5:4b', label: 'Qwen3.5 4B', sizeGb: 3.4, ramGb: 6, recommended: true, note: 'Đề xuất cho máy 16 GB: gọi lệnh tốt, hiểu tiếng Việt khá, đọc được ảnh.' },
    { id: 'qwen3.5:2b', label: 'Qwen3.5 2B', sizeGb: 2.7, ramGb: 4, note: 'Nhẹ hơn, nhanh hơn, cho máy 8 GB; câu dài nhiều bước kém hơn.' },
    { id: 'gemma4:e4b', label: 'Gemma 4 E4B', sizeGb: 6.6, ramGb: 9, note: 'Phương án thay (Apache 2.0), nặng hơn, đọc được ảnh.' },
    { id: 'qwen3.5:9b', label: 'Qwen3.5 9B', sizeGb: 6.6, ramGb: 11, note: 'Mạnh nhất vừa máy 16 GB, nhưng chậm và chiếm nhiều RAM.' },
  ];
  const DEFAULT_LOCAL_MODEL = 'qwen3.5:4b';
  const OLLAMA_URL = 'http://127.0.0.1:11434';
  const LOCAL_NUM_CTX = 16384;
  /** Tự động: có mạng và đã đăng nhập Socin thì dùng AI Socin, không thì model trên máy. */
  function cleanLlmConfig(v) {
    const o = isObj(v) ? v : {};
    const mode = o.mode === 'socin' || o.mode === 'local' ? o.mode : 'auto';
    const model = typeof o.model === 'string' && /^[a-z0-9._:/-]{2,80}$/i.test(o.model) ? o.model : DEFAULT_LOCAL_MODEL;
    return { mode, model };
  }
  /** Model nhỏ: giữ tối đa 40 lệnh (lệnh S Hub trước), mô tả rút ngắn. */
  function localTools(tools, max = 40) {
    const core = tools.filter((t) => !/^mcp_/.test(t.name));
    const rest = tools.filter((t) => /^mcp_/.test(t.name));
    return [...core, ...rest].slice(0, max).map((t) => ({ ...t, description: t.description.length > 300 ? t.description.slice(0, 297) + '…' : t.description }));
  }
  function toOllama(messages, context, maxMessages = 24) {
    const hist = trimHistory(messages, maxMessages, 1);
    const names = new Map();
    const out = [{ role: 'system', content: context ? `${SYSTEM}\n\nNgữ cảnh lúc này:\n${context}` : SYSTEM }];
    for (const m of hist) {
      if (m.role === 'assistant') {
        const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
        const calls = m.content.filter((b) => b.type === 'tool_use');
        calls.forEach((c) => names.set(c.id, c.name));
        out.push({ role: 'assistant', content: text, ...(calls.length ? { tool_calls: calls.map((c) => ({ function: { name: c.name, arguments: c.input } })) } : {}) });
        continue;
      }
      const texts = [], images = [];
      for (const b of m.content) {
        if (b.type === 'text') texts.push(b.text);
        else if (b.type === 'image') images.push(b.source.data);
        else if (b.type === 'tool_result') {
          const t = b.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').slice(0, 6000);
          const imgs = b.content.filter((c) => c.type === 'image').map((c) => c.source.data);
          out.push({ role: 'tool', content: (b.is_error ? 'LỖI: ' : '') + t, tool_name: names.get(b.tool_use_id) || '', ...(imgs.length ? { images: imgs } : {}) });
        }
      }
      if (texts.length || images.length) out.push({ role: 'user', content: texts.join('\n'), ...(images.length ? { images } : {}) });
    }
    return out;
  }
  let n = 0;
  /** Trả lời của Ollama → khối. Model nhỏ đôi khi viết lệnh dạng JSON trong chữ: nhận luôn nếu đúng tên lệnh. */
  function fromOllama(msg, toolNames) {
    const out = [];
    let text = String((msg && msg.content) || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const calls = ((msg && msg.tool_calls) || []).flatMap((c) => {
      const name = (c.function && c.function.name) || '';
      let args = c.function && c.function.arguments;
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
      return toolNames.has(name) ? [{ name, input: isObj(args) ? args : {} }] : [];
    });
    if (!calls.length && text) {
      const m = /^\s*(?:```(?:json)?\s*)?(\{[\s\S]*\})\s*(?:```)?\s*$/.exec(text);
      if (m) {
        try {
          const j = JSON.parse(m[1]);
          if (typeof j.name === 'string' && toolNames.has(j.name)) { const a = j.arguments || j.parameters; calls.push({ name: j.name, input: isObj(a) ? a : {} }); text = ''; }
        } catch { /* chữ thường */ }
      }
    }
    if (text) out.push({ type: 'text', text });
    for (const c of calls) out.push({ type: 'tool_use', id: `lc_${Date.now().toString(36)}_${(n++).toString(36)}`, name: c.name, input: c.input });
    return out;
  }
  function ollamaBody(model, messages, tools, context) {
    return {
      model, stream: false, think: false, keep_alive: '10m',
      options: { num_ctx: LOCAL_NUM_CTX, temperature: 0.2 },
      messages: toOllama(messages, context),
      tools: localTools(tools).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
    };
  }

  // ---------- Lưu trữ ----------
  const MAX_CHATS = 200, IMAGES_PER_CHAT = 4;
  function cleanChats(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter((c) => isObj(c) && typeof c.id === 'string' && typeof c.title === 'string' && Array.isArray(c.messages))
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, MAX_CHATS)
      .map((c) => {
        let keep = IMAGES_PER_CHAT;
        const messages = [...c.messages].reverse().map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: (Array.isArray(m.content) ? m.content : []).map((b) => {
          if (b.type === 'image') return keep-- > 0 ? b : { type: 'text', text: '[ảnh]' };
          if (b.type === 'tool_result') return { ...b, content: (b.content || []).map((x) => (x.type === 'image' && keep-- <= 0 ? { type: 'text', text: '[ảnh]' } : x)) };
          return b;
        }) })).reverse();
        return { id: c.id.slice(0, 40), title: c.title.slice(0, 120), updatedAt: Number(c.updatedAt) || 0, ...(c.projectId ? { projectId: String(c.projectId).slice(0, 40) } : {}), ...(c.pinned ? { pinned: true } : {}), messages: messages.slice(-400) };
      });
  }
  function cleanProjects(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter((p) => isObj(p) && typeof p.id === 'string' && typeof p.name === 'string').slice(0, 100).map((p) => ({
      id: p.id.slice(0, 40), name: p.name.slice(0, 80) || 'Dự án', icon: typeof p.icon === 'string' ? p.icon.slice(0, 8) : '📁',
      instructions: typeof p.instructions === 'string' ? p.instructions.slice(0, 4000) : '',
      notes: Array.isArray(p.notes) ? p.notes.filter((x) => isObj(x) && typeof x.text === 'string').slice(0, 30).map((x) => ({ id: String(x.id || '').slice(0, 40) || 'n' + Math.random().toString(36).slice(2, 8), title: String(x.title || '').slice(0, 80), text: x.text.slice(0, 8000) })) : [],
      createdAt: Number(p.createdAt) || Date.now(),
    }));
  }
  /** Ngữ cảnh gửi kèm mỗi lượt: dự án (hướng dẫn + ghi chú), trạng thái máy. Giới hạn độ dài. */
  function contextText(o) {
    const parts = [];
    if (o.now) parts.push(`Thời gian: ${o.now}`);
    if (o.user) parts.push(`Người dùng: ${o.user}`);
    if (o.apps) parts.push(`Ứng dụng trên S Hub: ${o.apps}`);
    if (o.project) {
      parts.push(`Dự án đang mở: ${o.project.name}`);
      if (o.project.instructions) parts.push(`Hướng dẫn của dự án:\n${o.project.instructions}`);
      for (const nt of o.project.notes || []) parts.push(`Tài liệu "${nt.title || 'ghi chú'}":\n${nt.text}`);
    }
    return parts.join('\n').slice(0, LIMITS.contextChars);
  }

  return { LIMITS, SYSTEM, MODES, textOf, titleFrom, trimHistory, appendUser, imageBlock, toolUseId, allowedBy, needsAsk, norm, parseArgs, matchApp, localPlan, runTurn,
    LOCAL_MODELS, DEFAULT_LOCAL_MODEL, OLLAMA_URL, LOCAL_NUM_CTX, cleanLlmConfig, localTools, toOllama, fromOllama, ollamaBody, cleanChats, cleanProjects, contextText };
});
