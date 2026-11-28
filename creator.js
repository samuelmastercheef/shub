// S Creator: tạo content, hình ảnh, video từ concept theo từng bước và đăng theo lịch qua hạ tầng Socin.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

module.exports = function init({ WS, json, body }) {
  const DIR = path.join(WS, 'creator'); const PROJ = path.join(DIR, 'projects'); const OUT = path.join(WS, 'downloads', 'creator');
  [PROJ, OUT].forEach((d) => fs.mkdirSync(d, { recursive: true }));
  const SETF = path.join(DIR, 'settings.json');
  const ID = /^[a-z0-9-]{1,48}$/; const PLATFORMS = ['tiktok', 'threads', 'facebook', 'zalo', 'youtube'];
  const bad = (m, s = 400) => { const e = new Error(m); e.status = s; throw e; };
  const rj = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
  const wj = (p, o, mode) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p + '.tmp', JSON.stringify(o, null, 2), mode ? { mode } : undefined); fs.renameSync(p + '.tmp', p); };
  // Tên miền cũ của Socin → app.socin.org (cùng máy chủ, khoá giữ nguyên)
  { const s = rj(SETF, null); if (s && s.socin && /^https?:\/\/social\.sprime\.net\/?$/i.test(s.socin.baseUrl || '')) { s.socin.baseUrl = 'https://app.socin.org'; try { wj(SETF, s, 0o600); } catch {} } }
  const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'du-an';
  const pf = (id) => path.join(PROJ, id + '.json'); const outDir = (id) => path.join(OUT, id);
  const load = (id) => { if (!ID.test(id || '') || !fs.existsSync(pf(id))) bad('Không thấy dự án', 404); return rj(pf(id), null); };
  const save = (p) => { p.updated = Date.now(); wj(pf(p.id), p); return p; };
  const has = (bin) => spawnSync('which', [bin]).status === 0;

  // ---- cài đặt (token Socin lưu mode 600, không bao giờ trả về client) ----
  const getSet = () => { const o = { imageApi: '', voice: 'Linh', imageSteps: 6, imageCfg: 2, imageStyle: 'hand-drawn cartoon illustration, flat 2D, simple shapes, clean lines, vertical composition', engine: 'cit', citUrl: 'http://127.0.0.1:8001', citVoice: '', imageSource: '', videoEngine: 'ffmpeg', gemini: { key: '', imageModel: 'gemini-2.5-flash-image', videoModel: 'gemini-omni-1.1-flash' }, socin: { baseUrl: '', token: '' }, ...rj(SETF, {}) }; o.gemini = { key: '', imageModel: 'gemini-2.5-flash-image', videoModel: 'gemini-omni-1.1-flash', ...(o.gemini || {}) }; return o; };
  const pubSet = () => { const s = getSet(); return { imageApi: s.imageApi, imageSteps: s.imageSteps, imageCfg: s.imageCfg, imageStyle: s.imageStyle, voice: s.voice, engine: s.engine, citUrl: s.citUrl, citVoice: s.citVoice, imageSource: s.imageSource || (s.imageApi ? 'api' : 'card'), videoEngine: s.videoEngine, gemini: { hasKey: !!s.gemini.key, imageModel: s.gemini.imageModel, videoModel: s.gemini.videoModel }, socin: { baseUrl: s.socin.baseUrl, hasToken: !!s.socin.token }, tools: { claude: has(CLAUDE()), ffmpeg: has('ffmpeg'), say: has('say'), playwright: (() => { try { require.resolve('playwright'); return true; } catch { return false; } })() } }; };

  // ---- Claude ----
  const CLAUDE = () => process.env.SHUB_CLAUDE_BIN || 'claude';
  const ask = (prompt, ms = 180000) => new Promise((resolve, reject) => {
    let o = '', e = ''; const p = spawn(CLAUDE(), ['-p', prompt], { stdio: ['ignore', 'pipe', 'pipe'] });
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('Claude quá thời gian chờ')); }, ms);
    p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (e += d));
    p.on('error', () => { clearTimeout(t); reject(new Error('Không chạy được lệnh "claude". Cài Claude Code và đăng nhập trước.')); });
    p.on('close', (c) => { clearTimeout(t); c === 0 ? resolve(o.trim()) : reject(new Error((e || 'claude lỗi ' + c).slice(0, 300))); });
  });
  const parseJson = (t) => { const a = Math.min(...['{', '['].map((c) => { const i = t.indexOf(c); return i < 0 ? 1e9 : i; })); const b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']')); if (a >= b) bad('Claude không trả về JSON hợp lệ, thử lại'); try { return JSON.parse(t.slice(a, b + 1)); } catch { bad('Không đọc được JSON từ Claude, thử lại'); } };
  const ctxOf = (p) => `Dự án: ${p.name}\nConcept: ${p.concept}\nĐối tượng: ${p.audience || 'chung'}\nGiọng điệu: ${p.tone || 'gần gũi, dễ hiểu'}\nKênh: ${p.channels.map((c) => c.platform).join(', ') || 'tiktok'}`;

  // ---- ảnh ----
  const projSeed = (p) => { if (!p.seed) { p.seed = 1 + Math.floor(Math.random() * 2147483000); save(p); } return p.seed; };
  async function imgApi(set, prompt, w, h, seed) {
    const url = set.imageApi.replace(/\/$/, '') + '/sdapi/v1/txt2img', neg = 'text, letters, watermark, logo, blurry, low quality, deformed', pr = (set.imageStyle ? set.imageStyle + ', ' : '') + prompt;
    // Draw Things / A1111 khác nhau về tham số: thử đầy đủ → bỏ tham số lạ → tối giản; 422 = server từ chối tham số
    const tries = [{ prompt: pr, negative_prompt: neg, width: w, height: h, steps: set.imageSteps, cfg_scale: set.imageCfg, guidance_scale: set.imageCfg, seed },
      { prompt: pr, negative_prompt: neg, width: w, height: h, steps: set.imageSteps, guidance_scale: set.imageCfg, seed },
      { prompt: pr, width: w, height: h, steps: set.imageSteps, seed }];
    let last = '';
    for (const body of tries) {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(300000) }).catch(() => bad('Không kết nối được server ảnh (Draw Things đã mở và bật API Server chưa?)'));
      if (r.status === 422 || r.status === 400) { last = `HTTP ${r.status}: ` + (await r.text().catch(() => '')).slice(0, 300); continue; }
      if (!r.ok) bad('Server ảnh lỗi HTTP ' + r.status);
      const j = await r.json().catch(() => null); if (!j || !j.images || !j.images[0]) bad('Server ảnh không trả ảnh'); return Buffer.from(String(j.images[0]).replace(/^data:image\/\w+;base64,/, ''), 'base64');
    }
    bad('Server ảnh từ chối yêu cầu (' + last + '). Thử giảm số bước hoặc kiểm tra model trong Draw Things.');
  }
  // ---- Gemini (ảnh + video) và Claude (vẽ SVG) ----
  const GB = () => (process.env.SHUB_GEMINI_BASE || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
  const gErr = async (r, what) => { let m = ''; try { const j = await r.json(); m = (j.error && j.error.message) || ''; } catch {} if (r.status === 401 || r.status === 403) bad('Gemini từ chối khóa API (sai khóa hoặc chưa bật quyền cho model này)'); if (r.status === 429) bad('Gemini giới hạn lượt dùng (gói miễn phí hay bị 429), thử lại sau hoặc dùng nguồn khác'); if (r.status === 400 && /safety|block|policy|prohibit/i.test(m)) bad('Gemini chặn mô tả cảnh này (bộ lọc an toàn): ' + m.slice(0, 160)); bad(`${what} lỗi HTTP ${r.status}${m ? ': ' + m.slice(0, 200) : ''}`); };
  async function geminiImage(set, prompt, p, n) {
    if (!set.gemini.key) bad('Chưa nhập khóa Gemini (tab Kết nối → Kết nối AI)');
    const parts = [], ref = n > 1 && p.images['1'] ? path.join(outDir(p.id), p.images['1']) : null;
    if (ref && fs.existsSync(ref)) { const buf = fs.readFileSync(ref); parts.push({ inlineData: { mimeType: buf[0] === 0x89 ? 'image/png' : 'image/jpeg', data: buf.toString('base64') } }); parts.push({ text: 'Keep exactly the same main character, face, clothing and art style as in the reference image. Draw this new scene: ' + prompt + '. Vertical 9:16 composition. No text, no letters, no watermark.' }); }
    else parts.push({ text: prompt + '. Vertical 9:16 composition. No text, no letters, no watermark.' });
    const r = await fetch(`${GB()}/v1beta/models/${set.gemini.imageModel}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': set.gemini.key, 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16' } } }), signal: AbortSignal.timeout(180000) }).catch(() => bad('Không kết nối được Gemini (kiểm tra mạng)'));
    if (!r.ok) await gErr(r, 'Gemini tạo ảnh');
    const j = await r.json().catch(() => null); const pp = (((j || {}).candidates || [])[0] || {}).content; const items = (pp && pp.parts) || [];
    const img = items.map((x) => x.inlineData || x.inline_data).find((x) => x && x.data);
    if (!img) bad('Gemini không trả ảnh' + (items.find((x) => x.text) ? ': ' + String(items.find((x) => x.text).text).slice(0, 160) : ' (có thể bị bộ lọc an toàn chặn)'));
    return Buffer.from(img.data, 'base64');
  }
  async function claudeSvgPng(p, sc, out) {
    let pw; try { pw = require('playwright'); } catch { bad('Cần Playwright để dựng ảnh SVG: cd ~/shub && npm i playwright && npx playwright install chromium'); }
    const txt = await ask(`Bạn là họa sĩ vector. Vẽ MỘT ảnh minh họa phẳng (flat vector) dạng SVG, viewBox="0 0 1080 1920", có nền kín (không trong suốt), nhân vật và bối cảnh rõ ràng, màu tươi, hình khối lớn, đơn giản. KHÔNG có chữ/văn bản, không <script>, không ảnh ngoài, không font. Nhân vật (giữ nhất quán): ${p.script.character || 'một nhân vật đơn giản'}. Phong cách: ${p.script.style || 'flat 2D cartoon'}. Cảnh: ${sc.imagePrompt || sc.visual || sc.narration}. Trả về DUY NHẤT thẻ <svg ...>...</svg>.`, 240000);
    const m = /<svg[\s\S]*<\/svg>/i.exec(txt); if (!m) bad('Claude không trả SVG hợp lệ, thử lại');
    const svg = m[0]; if (/<script|<foreignObject|\son\w+\s*=|javascript:|<iframe|<image|<use[^>]+href\s*=\s*["'](?!#)|href\s*=\s*["']https?:/i.test(svg)) bad('SVG có thành phần không an toàn, thử lại');
    const br = await pw.chromium.launch(); try { const cx = await br.newContext({ javaScriptEnabled: false, viewport: { width: 1080, height: 1920 } }); const pg = await cx.newPage(); await pg.setContent(`<body style="margin:0;width:1080px;height:1920px;overflow:hidden"><div style="width:1080px;height:1920px">${svg.replace(/<svg/i, '<svg width="1080" height="1920" preserveAspectRatio="xMidYMid slice"')}</div></body>`); await pg.screenshot({ path: out }); } finally { await br.close(); }
  }
  const srcOf = (set) => set.imageSource || (set.imageApi ? 'api' : 'card');
  async function genImage(p, n, source) {
    const sc = p.script.scenes[n - 1], dir = outDir(p.id); fs.mkdirSync(dir, { recursive: true }); const file = `scene-${n}.png`, set = getSet(), out = path.join(dir, file);
    const prompt = [p.script.character, p.script.style, sc.imagePrompt || sc.visual].filter(Boolean).join(', ');
    if (source === 'api') { if (!set.imageApi) bad('Chưa cấu hình server ảnh (vd: Draw Things / Stable Diffusion WebUI)'); fs.writeFileSync(out, await imgApi(set, prompt, 576, 1024, projSeed(p))); }
    else if (source === 'gemini') fs.writeFileSync(out, await geminiImage(set, prompt, p, n));
    else if (source === 'claude') await claudeSvgPng(p, sc, out);
    else await cardPng(iconOf(sc), n, p.script.scenes.length, out);
    p.images[String(n)] = file; p.step = 'images'; save(p);
  }
  // clip video từ Gemini (text-to-video), dùng thay ảnh động của ffmpeg
  async function geminiClip(set, prompt, out, signal) {
    const key = set.gemini.key, h = { 'x-goog-api-key': key, 'content-type': 'application/json' };
    const r = await fetch(`${GB()}/v1beta/interactions`, { method: 'POST', headers: h, body: JSON.stringify({ model: set.gemini.videoModel, input: prompt, response_format: { type: 'video', aspect_ratio: '9:16', resolution: '720p', delivery: 'uri' } }), signal: AbortSignal.any([signal, AbortSignal.timeout(15 * 60000)]) }).catch((e) => { if (signal.aborted) throw e; throw new Error('Không kết nối được Gemini'); });
    if (!r.ok) await gErr(r, 'Gemini tạo video');
    const j = await r.json().catch(() => ({})); const item = (j.steps || []).filter((x) => x.type === 'model_output').flatMap((x) => x.content || []).find((c) => c.type === 'video');
    if (!item) throw new Error('Gemini không trả video (có thể bị bộ lọc an toàn chặn)');
    if (item.data) { fs.writeFileSync(out, Buffer.from(item.data, 'base64')); return; }
    if (!item.uri) throw new Error('Gemini không trả đường dẫn video');
    const uri = String(item.uri), meta = uri.replace(/:download.*$/, '');
    for (let i = 0; i < 120; i++) { const m = await fetch(meta, { headers: h, signal }).then((x) => x.json()).catch(() => ({})); if (m.state === 'FAILED') throw new Error('Gemini báo tạo video thất bại'); if (!m.state || m.state === 'ACTIVE') break; await new Promise((rs) => setTimeout(rs, 5000)); }
    const d = await fetch(uri, { headers: { 'x-goog-api-key': key }, signal }); if (!d.ok) throw new Error('Tải video từ Gemini lỗi HTTP ' + d.status); fs.writeFileSync(out, Buffer.from(await d.arrayBuffer()));
  }
  const iconOf = (sc) => { const m = /\p{Extended_Pictographic}(\uFE0F|\u200D\p{Extended_Pictographic})*/u.exec((sc.icon || '') + (sc.text || '') + (sc.narration || '')); return m ? m[0] : '✨'; };
  async function cardPng(icon, idx, total, file) {
    let pw; try { pw = require('playwright'); } catch { bad('Cần Playwright để vẽ thẻ ảnh: chạy "npm i playwright && npx playwright install chromium" trong ~/shub, hoặc cấu hình server ảnh.'); }
    const PAL = [['#06111C', '#0B7F8F', '#FFB020'], ['#1B0B2E', '#6D28D9', '#FDE047'], ['#0B1F14', '#15803D', '#FDBA74'], ['#2A0F12', '#BE123C', '#FDE68A'], ['#0A1A33', '#2563EB', '#5EEAD4'], ['#1F1408', '#C2410C', '#FEF3C7']];
    const [c1, c2, ac] = PAL[(idx - 1) % PAL.length], lay = (idx - 1) % 3;
    const iconY = lay === 1 ? '34%' : lay === 2 ? '58%' : '46%', ringX = lay === 1 ? '28%' : lay === 2 ? '72%' : '50%';
    const html = `<body style="margin:0;width:1080px;height:1920px;overflow:hidden;position:relative;background:linear-gradient(${150 + lay * 25}deg,${c1},${c2});font-family:'Be Vietnam Pro',-apple-system,Helvetica,Arial,sans-serif;color:#fff">
<div style="position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.10) 3px,transparent 3px);background-size:54px 54px"></div>
<div style="position:absolute;width:980px;height:980px;border-radius:50%;left:${ringX};top:${iconY};transform:translate(-50%,-50%);background:radial-gradient(circle,${ac}55,transparent 68%)"></div>
<div style="position:absolute;width:640px;height:640px;border-radius:50%;left:${ringX};top:${iconY};transform:translate(-50%,-50%);background:rgba(255,255,255,.10);border:6px solid ${ac}88;box-shadow:0 0 120px ${ac}66"></div>
<div style="position:absolute;width:820px;height:820px;border-radius:50%;left:${ringX};top:${iconY};transform:translate(-50%,-50%);border:3px dashed rgba(255,255,255,.25)"></div>
<div style="position:absolute;left:${ringX};top:${iconY};transform:translate(-50%,-50%);font-size:380px;line-height:1;filter:drop-shadow(0 24px 40px rgba(0,0,0,.35))">${icon}</div>
<div style="position:absolute;right:-30px;${lay === 1 ? 'bottom:120px' : 'top:210px'};font-size:420px;font-weight:900;color:rgba(255,255,255,.07);line-height:1">${String(idx).padStart(2, '0')}</div>
<div style="position:absolute;width:260px;height:260px;border-radius:50%;background:${ac}33;left:${lay === 2 ? '-70px' : '860px'};top:${lay === 0 ? '1380px' : '160px'}"></div>
<div style="position:absolute;top:90px;left:110px;display:flex;gap:14px;align-items:center"><div style="width:58px;height:58px;border-radius:50%;background:${ac}"></div><b style="font-size:40px;letter-spacing:.04em">SOCIN</b></div>
<div style="position:absolute;bottom:100px;left:110px;font-size:34px;color:${ac};font-weight:700">${idx}/${total}</div></body>`;
    const br = await pw.chromium.launch(); try { const pg = await br.newPage({ viewport: { width: 1080, height: 1920 } }); await pg.setContent(html); await pg.waitForTimeout(300); await pg.screenshot({ path: file }); } finally { await br.close(); }
  }

  // ---- video ----
  const FONT = () => ['/System/Library/Fonts/Supplemental/Arial Unicode.ttf', '/Library/Fonts/Arial Unicode.ttf', '/System/Library/Fonts/Helvetica.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].find((f) => fs.existsSync(f));
  const runBase = (cmd, args, ms = 600000, ctx) => new Promise((resolve, reject) => { let e = ''; const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] }); if (ctx) ctx.children.add(p); const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(cmd + ' quá thời gian')); }, ms); p.stderr.on('data', (d) => (e = (e + d).slice(-1500))); p.on('error', () => { clearTimeout(t); reject(new Error('Không chạy được ' + cmd + (cmd === 'ffmpeg' ? ' (cài: brew install ffmpeg)' : ''))); }); p.on('close', (c) => { clearTimeout(t); if (ctx) { ctx.children.delete(p); if (ctx.cancelled) return reject(Object.assign(new Error('Đã dừng'), { cancelled: true })); } c === 0 ? resolve() : reject(new Error(cmd + ' lỗi: ' + e.slice(-400))); }); });
  const run = (cmd, args, ms) => runBase(cmd, args, ms);
  const jobCtx = new Map();
  const dur = (f) => { const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }); return parseFloat(r.stdout) || 0; };
  const wrap = (t, n = 26) => { const w = String(t).split(/\s+/), L = []; let c = ''; w.forEach((x) => { if ((c + ' ' + x).trim().length > n) { L.push(c); c = x; } else c = (c + ' ' + x).trim(); }); if (c) L.push(c); return L.join('\n'); };
  const srtT = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${x.toFixed(3).replace('.', ',').padStart(6, '0')}`; };
  // ---- giọng đọc CIT Voice Studio (chạy cục bộ, mặc định 127.0.0.1:8001) ----
  const citH = () => ({ 'content-type': 'application/json', ...(process.env.CIT_VOICE_API_KEY ? { 'x-api-key': process.env.CIT_VOICE_API_KEY } : {}) });
  const citBase = () => getSet().citUrl.replace(/\/$/, '');
  async function citHealth() { try { const r = await fetch(citBase() + '/health', { headers: citH(), signal: AbortSignal.timeout(4000) }); const j = await r.json().catch(() => ({})); return r.ok && j.status === 'ok' ? { ok: true, engine: j.engine || null } : { ok: false, error: j.message || 'HTTP ' + r.status }; } catch { return { ok: false, error: 'Không kết nối được CIT Voice Studio tại ' + citBase() + ' (mở ứng dụng và đợi tải xong)' }; } }
  async function citVoices() { const r = await fetch(citBase() + '/voices', { headers: citH(), signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error('Không lấy được danh sách giọng CIT'); return (await r.json()).map((v) => ({ id: v.id, gender: v.gender || null, region: v.region || null, description: v.description || '', cloned: !!v.isCloned })); }
  async function citSpeak(text, voiceId, out, speed = 1.0) {
    const r = await fetch(citBase() + '/api/tts/generate', { method: 'POST', headers: citH(), body: JSON.stringify({ text, speed, format: 'mp3', ...(voiceId ? { voice_id: voiceId } : {}) }), signal: AbortSignal.timeout(300000) });
    if (!r.ok) throw new Error('CIT Voice Studio lỗi HTTP ' + r.status);
    if (!(r.headers.get('content-type') || '').startsWith('audio/')) throw new Error('CIT Voice Studio không trả về âm thanh');
    fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  }
  const jobs = new Set();
  const hasDrawtext = () => { if (process.env.SHUB_NO_DRAWTEXT) return false; const r = spawnSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' }); return /\bdrawtext\b/.test(r.stdout || ''); };
  const hasPlaywright = () => { try { require.resolve('playwright'); return true; } catch { return false; } };
  // ffmpeg của Homebrew thường thiếu bộ lọc drawtext → vẽ chữ thành PNG trong suốt bằng Playwright rồi ghép đè lên
  async function captionPng(o, file) {
    const pw = require('playwright'); const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const hook = o.hook ? `<div style="position:absolute;left:0;right:0;top:0;padding:230px 70px 130px;background:linear-gradient(180deg,rgba(0,0,0,.72),rgba(0,0,0,0));display:flex;justify-content:center"><div style="color:#FFD34D;font-size:78px;line-height:1.18;font-weight:900;text-align:center;text-shadow:0 6px 24px rgba(0,0,0,.6);max-width:940px">${esc(o.hook).replace(/\n/g, '<br>')}</div></div>` : '';
    const cap = o.cap ? `<div style="position:absolute;left:0;right:0;top:72%;display:flex;justify-content:center"><div style="max-width:880px;background:rgba(0,0,0,.55);color:#fff;font-size:54px;line-height:1.3;font-weight:700;text-align:center;padding:22px 30px;border-radius:14px">${esc(o.cap).replace(/\n/g, '<br>')}</div></div>` : '';
    const html = `<body style="margin:0;width:1080px;height:1920px;background:transparent;position:relative;font-family:'Be Vietnam Pro',-apple-system,Helvetica,Arial,sans-serif">${hook}${cap}</body>`;
    const br = await pw.chromium.launch(); try { const pg = await br.newPage({ viewport: { width: 1080, height: 1920 } }); await pg.setContent(html); await pg.waitForTimeout(200); await pg.screenshot({ path: file, omitBackground: true }); } finally { await br.close(); }
  }
  async function render(id, opt) {
    const ctx = { cancelled: false, children: new Set(), ac: new AbortController() }; jobCtx.set(id, ctx); const run = (c, a, ms) => runBase(c, a, ms, ctx); const chk = () => { if (ctx.cancelled) throw Object.assign(new Error('Đã dừng'), { cancelled: true }); };
    try { return await renderInner(id, opt, run, chk, ctx); } finally { jobCtx.delete(id); try { fs.rmSync(path.join(outDir(id), '.tmp'), { recursive: true, force: true }); } catch {} }
  }
  async function renderInner(id, opt, run, chk, ctx) {
    const p = load(id), set = getSet(), dir = outDir(id), tmp = path.join(dir, '.tmp'); fs.mkdirSync(tmp, { recursive: true });
    const scenes = (p.script && p.script.scenes) || []; if (!scenes.length) throw new Error('Chưa có kịch bản');
    const citOk = opt.voice && set.engine === 'cit' && (await citHealth()).ok; let usedVoice = ''; const segs = []; let t = 0; const srt = []; const wantCap = opt.captions !== false; const overlay = wantCap && hasPlaywright(); const dt = wantCap && !overlay && hasDrawtext(); const font = dt ? FONT() : null; let warn = ''; if (wantCap && !dt && !overlay) warn = 'ffmpeg thiếu bộ lọc drawtext và chưa có Playwright nên video không có chữ (vẫn có file .srt). Cài: cd ~/shub && npm i playwright && npx playwright install chromium';
    const hookTxt0 = (k) => k === 0 && p.script && p.script.hook; const eng = opt.engine === 'gemini' && set.gemini.key ? 'gemini' : 'ffmpeg'; let gOk = 0, gFail = 0, gMsg = '';
    for (let i = 0; i < scenes.length; i++) {
      chk(); if (process.env.SHUB_NO_TIMER && opt.delay) await new Promise((r) => setTimeout(r, Math.min(5000, opt.delay)));
      const img = p.images[String(i + 1)]; if (!img) throw new Error(`Cảnh ${i + 1} chưa có ảnh`);
      let sec = Math.min(30, Math.max(2, Number(scenes[i].seconds) || 4)), audio = null;
      if (opt.voice && citOk && scenes[i].narration) { const a = path.join(tmp, `a${i}.mp3`); try { await citSpeak(scenes[i].narration, set.citVoice, a); audio = a; sec = Math.max(sec, dur(a) + 0.5); usedVoice = 'CIT'; } catch { audio = null; } }
      if (!audio && opt.voice && has('say') && scenes[i].narration) { const a = path.join(tmp, `a${i}.aiff`); try { await run('say', ['-v', set.voice, '-o', a, scenes[i].narration], 120000); audio = a; usedVoice = usedVoice || 'macOS'; sec = Math.max(sec, dur(a) + 0.5); } catch { audio = null; } }
      const seg = path.join(tmp, `s${i}.mp4`), frames = Math.round(sec * 30); let clip = null;
      if (eng === 'gemini') { clip = path.join(tmp, `g${i}.mp4`); try { await geminiClip(set, [p.script.character, p.script.style, scenes[i].imagePrompt || scenes[i].visual || scenes[i].narration, 'Vertical 9:16, cinematic, natural camera motion. No speech, no subtitles, no text, no logo.'].filter(Boolean).join('. '), clip, ctx.ac.signal); gOk++; } catch (e) { chk(); clip = null; gFail++; gMsg = String(e.message).slice(0, 160); } }
      let vf = clip ? `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,tpad=stop_mode=clone:stop_duration=${sec},format=yuv420p` : `scale=1296:2304:force_original_aspect_ratio=increase,crop=1296:2304,zoompan=z='min(zoom+0.0006,1.12)':d=${frames}:s=1080x1920:fps=30,format=yuv420p`;
      const cap = scenes[i].text || scenes[i].narration;
      if (font && hookTxt0(i) ) { const hf = path.join(tmp, `h${i}.txt`); fs.writeFileSync(hf, wrap(p.script.hook, 20)); vf += `,drawtext=fontfile='${font.replace(/'/g, '')}':textfile='${hf}':fontsize=72:fontcolor=0xFFD34D:box=1:boxcolor=black@0.55:boxborderw=20:line_spacing=10:x=(w-text_w)/2:y=h*0.10`; }
      if (font && cap) { const tf = path.join(tmp, `t${i}.txt`); fs.writeFileSync(tf, wrap(cap)); vf += `,drawtext=fontfile='${font.replace(/'/g, '')}':textfile='${tf}':fontsize=54:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=22:line_spacing=10:x=(w-text_w)/2:y=h*0.72`; }
      const args = clip ? ['-y', '-i', clip] : ['-y', '-loop', '1', '-t', String(sec), '-i', path.join(dir, img)];
      if (audio) args.push('-i', audio); else args.push('-f', 'lavfi', '-t', String(sec), '-i', 'anullsrc=r=44100:cl=mono');
      const hookTxt = i === 0 && opt.captions !== false ? ((p.script && p.script.hook) || '') : '';
      if (overlay && (cap || hookTxt)) { const cp = path.join(tmp, `c${i}.png`); await captionPng({ hook: hookTxt ? wrap(hookTxt, 20) : '', cap: cap ? wrap(cap) : '' }, cp); args.push('-loop', '1', '-t', String(sec), '-i', cp, '-filter_complex', `[0:v]${vf}[v];[2:v]format=rgba[c];[v][c]overlay=0:0,format=yuv420p[o]`, '-map', '[o]', '-map', '1:a'); }
      else { args.push('-vf', vf); if (clip) args.push('-map', '0:v', '-map', '1:a'); }
      if (clip) args.push('-t', String(sec));
      args.push('-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '1', '-shortest', seg);
      await run('ffmpeg', args); segs.push(seg);
      srt.push(`${i + 1}\n${srtT(t)} --> ${srtT(t + sec)}\n${scenes[i].narration || cap || ''}\n`); t += sec;
    }
    fs.writeFileSync(path.join(tmp, 'list.txt'), segs.map((s) => `file '${s}'`).join('\n'));
    const out = path.join(dir, 'video.mp4'); await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'), '-c', 'copy', '-movflags', '+faststart', out]);
    try { const cv = (p.script && p.script.hook) ? p.script.hook : ''; if (overlay && cv) { const cp = path.join(tmp, 'cover-ov.png'); await captionPng({ hook: wrap(cv, 20), cap: '' }, cp); await run('ffmpeg', ['-y', '-i', path.join(dir, p.images['1']), '-i', cp, '-filter_complex', '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[b];[b][1:v]overlay=0:0', '-frames:v', '1', path.join(dir, 'cover.png')]); } } catch {}
    fs.writeFileSync(path.join(dir, 'video.srt'), srt.join('\n')); fs.rmSync(tmp, { recursive: true, force: true });
    return { file: 'video.mp4', seconds: Math.round(t), bytes: fs.statSync(out).size, captions: !!font || overlay, warn: [warn, gFail ? `Gemini lỗi ở ${gFail} cảnh (đã dùng ảnh động thay thế): ${gMsg}` : ''].filter(Boolean).join(' · ') || undefined, videoSource: eng === 'gemini' ? `Gemini ${gOk}/${scenes.length} cảnh` : 'ảnh động ffmpeg', voice: !!opt.voice && !!usedVoice, voiceEngine: usedVoice || null };
  }

  // ---- đăng: adapter ----
  const sizeMeta = (p) => { const f = path.join(outDir(p.id), 'video.mp4'); try { return { video_name: p.name.slice(0, 80) + '.mp4', video_mime: 'video/mp4', video_size: fs.statSync(f).size }; } catch { return {}; } };
  async function socin(path_, method, data) {
    const s = getSet().socin; if (!s.baseUrl || !s.token) bad('Chưa cấu hình kết nối Socin (địa chỉ và token)');
    if (!/^https:\/\/[\w.-]+(:\d+)?$/.test(s.baseUrl) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(s.baseUrl)) bad('Địa chỉ Socin phải là https://… (hoặc http://localhost khi thử)');
    const r = await fetch(s.baseUrl + path_, { method, headers: { Authorization: 'Bearer ' + s.token, 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(30000) });
    let j = null; try { j = await r.json(); } catch {} if (!r.ok) bad(`Socin: ${(j && (j.message || j.error)) || 'HTTP ' + r.status}`, 502); return j;
  }
  async function publish(p, it) {
    if (it.adapter === 'export') {
      const d = path.join(outDir(p.id), 'goi-dang', `${it.platform}-${it.id}`); fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'noi-dung.txt'), `${it.title}\n\n${it.caption}\n`); const v = path.join(outDir(p.id), 'video.mp4'); if (fs.existsSync(v)) fs.copyFileSync(v, path.join(d, 'video.mp4'));
      return { exported: d };
    }
    const r = await socin('/api/integration/creator/posts', 'POST', { platform: it.platform, account_id: it.accountId, title: it.title, caption: it.caption, run_at: it.runAt, external_ref: p.id + ':' + it.id, ...sizeMeta(p) });
    return { remoteId: r && r.id, note: r && r.note };
  }
  let ticking = false;
  async function tick() {
    if (ticking) return; ticking = true;
    try { for (const f of fs.readdirSync(PROJ).filter((x) => x.endsWith('.json'))) { const p = rj(path.join(PROJ, f), null); if (!p || !p.schedule) continue; let ch = false;
      for (const it of p.schedule) { if (it.status !== 'queued' || !it.auto || new Date(it.runAt).getTime() > Date.now() + 5 * 60000) continue; // đẩy lên Socin trước 5 phút; Socin tự đăng đúng giờ
        it.status = 'sending'; ch = true; wj(pf(p.id), p);
        try { it.result = await publish(p, it); it.status = 'sent'; it.error = ''; it.sentAt = Date.now(); } catch (e) { it.status = 'failed'; it.error = String(e.message).slice(0, 300); } }
      if (ch) save(p); } } catch {} ticking = false;
  }
  if (!process.env.SHUB_NO_TIMER) setInterval(tick, 60000).unref();

  const view = (p) => ({ ...p, video: p.video && p.video.status === 'rendering' && !jobs.has(p.id) ? { status: 'error', error: 'Lần dựng trước bị gián đoạn (server khởi động lại). Bấm dựng lại.' } : p.video, images: p.images || {}, hasVideo: fs.existsSync(path.join(outDir(p.id), 'video.mp4')) });
  const clean = (s, n) => String(s ?? '').trim().slice(0, n);
  const chans = (a) => (Array.isArray(a) ? a : []).slice(0, 8).map((c) => { if (!PLATFORMS.includes(c.platform)) bad('Kênh không hỗ trợ: ' + c.platform); return { platform: c.platform, accountId: clean(c.accountId, 64), accountName: clean(c.accountName, 80), adapter: c.adapter === 'export' ? 'export' : 'socin' }; });

  return async function handle(req, res, u) {
    if (u.pathname.startsWith('/cr/file/')) { const m = u.pathname.slice(9).split('/'); if (m.length !== 2 || !ID.test(m[0]) || !/^[\w.-]{1,60}$/.test(m[1]) || m[1].startsWith('.')) return json(res, 404, {}), true; const f = path.join(outDir(m[0]), m[1]); if (!fs.existsSync(f)) return json(res, 404, {}), true; const ext = path.extname(f); res.writeHead(200, { 'Content-Type': { '.png': 'image/png', '.mp4': 'video/mp4', '.srt': 'text/plain; charset=utf-8' }[ext] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); return true; }
    if (!u.pathname.startsWith('/api/cr/')) return false;
    try {
      const route = u.pathname.slice(8), q = u.searchParams;
      if (route === 'settings') return json(res, 200, { ok: true, settings: pubSet() }), true;
      if (route === 'projects') { const all = fs.readdirSync(PROJ).filter((f) => f.endsWith('.json')).map((f) => rj(path.join(PROJ, f), null)).filter(Boolean).sort((a, b) => b.updated - a.updated); const k = (q.get('q') || '').toLowerCase(); const l = all.filter((p) => !k || (p.name + p.concept).toLowerCase().includes(k)); const size = 8, page = Math.max(1, Number(q.get('page') || 1));
        return json(res, 200, { ok: true, total: l.length, page, size, items: l.slice((page - 1) * size, page * size).map((p) => ({ id: p.id, name: p.name, concept: p.concept.slice(0, 120), step: p.step, channels: p.channels.map((c) => c.platform), scenes: ((p.script || {}).scenes || []).length, images: Object.keys(p.images || {}).length, video: (p.video || {}).status || '', queued: (p.schedule || []).filter((x) => x.status === 'queued').length, sent: (p.schedule || []).filter((x) => x.status === 'sent').length, updated: p.updated })) }), true; }
      if (route === 'project') return json(res, 200, { ok: true, project: view(load(q.get('id'))) }), true;
      if (route === 'stats') { const all = fs.readdirSync(PROJ).filter((f) => f.endsWith('.json')).map((f) => rj(path.join(PROJ, f), null)).filter(Boolean); const sc = all.flatMap((p) => p.schedule || []); const by = (k) => sc.reduce((a, x) => ((a[x[k]] = (a[x[k]] || 0) + 1), a), {});
        return json(res, 200, { ok: true, projects: all.length, steps: all.reduce((a, p) => ((a[p.step] = (a[p.step] || 0) + 1), a), {}), items: sc.length, byStatus: by('status'), byPlatform: by('platform'), videos: all.filter((p) => (p.video || {}).status === 'done').length }), true; }
      let b = req.method === 'POST' ? await body(req) : {};
      if (route === 'settings/save') {
        const s = getSet(); if (b.imageApi !== undefined) { const v = clean(b.imageApi, 200); if (v && !/^https?:\/\/[\w.-]+(:\d+)?(\/[\w./-]*)?$/.test(v)) bad('Địa chỉ server ảnh không hợp lệ'); s.imageApi = v; }
        if (b.imageSteps !== undefined) { const n = Number(b.imageSteps); if (!Number.isInteger(n) || n < 1 || n > 60) bad('Số bước phải từ 1 đến 60'); s.imageSteps = n; }
        if (b.imageCfg !== undefined) { const n = Number(b.imageCfg); if (!(n >= 0 && n <= 20)) bad('CFG phải từ 0 đến 20'); s.imageCfg = n; }
        if (b.imageStyle !== undefined) s.imageStyle = clean(b.imageStyle, 200);
        if (b.imageSource !== undefined) { if (!['api', 'gemini', 'claude', 'card'].includes(b.imageSource)) bad('Nguồn ảnh không hợp lệ'); s.imageSource = b.imageSource; }
        if (b.videoEngine !== undefined) { if (!['ffmpeg', 'gemini'].includes(b.videoEngine)) bad('Engine video không hợp lệ'); s.videoEngine = b.videoEngine; }
        if (b.geminiKey) { if (!/^[\w-]{20,100}$/.test(b.geminiKey)) bad('Khóa Gemini không hợp lệ'); s.gemini = { ...s.gemini, key: b.geminiKey }; } if (b.clearGeminiKey) s.gemini = { ...s.gemini, key: '' };
        if (b.geminiImageModel !== undefined) { const v = clean(b.geminiImageModel, 60); if (!/^[\w.-]{1,60}$/.test(v)) bad('Tên model ảnh không hợp lệ'); s.gemini = { ...s.gemini, imageModel: v }; }
        if (b.geminiVideoModel !== undefined) { const v = clean(b.geminiVideoModel, 60); if (!/^[\w.-]{1,60}$/.test(v)) bad('Tên model video không hợp lệ'); s.gemini = { ...s.gemini, videoModel: v }; }
        if (b.engine !== undefined) { if (!['cit', 'say'].includes(b.engine)) bad('Nguồn giọng không hợp lệ'); s.engine = b.engine; }
        if (b.citUrl !== undefined) { const v = clean(b.citUrl, 100).replace(/\/$/, ''); if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d{2,5})?$/.test(v)) bad('Địa chỉ CIT phải là http://127.0.0.1:<cổng> hoặc http://localhost:<cổng>'); s.citUrl = v; }
        if (b.citVoice !== undefined) { const v = clean(b.citVoice, 80); if (v && !/^[\p{L}\p{N} .()_-]{1,80}$/u.test(v)) bad('Mã giọng không hợp lệ'); s.citVoice = v; }
        if (b.voice !== undefined) { const v = clean(b.voice, 40); if (!/^[\w ().-]{1,40}$/.test(v)) bad('Tên giọng không hợp lệ'); s.voice = v; }
        if (b.socinBaseUrl !== undefined) s.socin.baseUrl = clean(b.socinBaseUrl, 200).replace(/\/$/, ''); if (b.socinToken) { if (!/^[\w.~+-]{16,200}$/.test(b.socinToken)) bad('Token không hợp lệ'); s.socin.token = b.socinToken; } if (b.clearToken) s.socin.token = '';
        wj(SETF, s, 0o600); return json(res, 200, { ok: true, settings: pubSet() }), true; }
      if (route === 'ai/style') { const p = load(b.id); if (!p.script) bad('Chưa có kịch bản'); const sc = p.script.scenes.map((x, i) => `${i + 1}. ${x.narration} | ${x.visual || ''}`).join('\n');
        const out = await ask(`Bạn là art director. ${ctxOf(p)}\nCác cảnh:\n${sc}\nTạo thiết kế NHẤT QUÁN để vẽ mọi cảnh. Trả về DUY NHẤT JSON: {"character":"English, ONE detailed sentence: the same main character in every scene (age, gender, face, hair, skin tone, exact clothing and colours)","style":"English, 1 sentence: shared art style, colour palette, lighting","scenes":[{"imagePrompt":"English: ONLY action, setting, mood, camera of that scene, do NOT describe the character, no text"}]} với đúng ${p.script.scenes.length} phần tử scenes, theo thứ tự.`);
        const r = parseJson(out); p.script.character = clean(r.character, 400); p.script.style = clean(r.style, 300); if (Array.isArray(r.scenes)) r.scenes.slice(0, p.script.scenes.length).forEach((x, i) => { if (x && x.imagePrompt) p.script.scenes[i].imagePrompt = clean(x.imagePrompt, 500); }); p.seed = 0; save(p); return json(res, 200, { ok: true, project: view(p) }), true; }
      if (route === 'image/reseed') { const p = load(b.id); p.seed = 0; save(p); return json(res, 200, { ok: true, project: view(p) }), true; }
      if (route === 'gemini/test') { const k = getSet().gemini.key; if (!k) bad('Chưa nhập khóa Gemini'); const r = await fetch(`${GB()}/v1beta/models?pageSize=1`, { headers: { 'x-goog-api-key': k }, signal: AbortSignal.timeout(15000) }).catch(() => bad('Không kết nối được Gemini')); if (!r.ok) await gErr(r, 'Gemini'); return json(res, 200, { ok: true }), true; }
      if (route === 'image/detect') { const bases = ['http://127.0.0.1:7860', 'http://127.0.0.1:7861']; for (const base of bases) { try { const r = await fetch(base + '/sdapi/v1/options', { signal: AbortSignal.timeout(2500) }); if (r.status < 500) return json(res, 200, { ok: true, found: true, url: base }), true; } catch {} } return json(res, 200, { ok: true, found: false }), true; }
      if (route === 'image/enable') { const url = clean(b.url, 100); if (!/^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(url)) bad('Địa chỉ không hợp lệ'); const st = getSet(); st.imageApi = url; if (b.turbo) { st.imageSteps = 6; st.imageCfg = 2; } wj(SETF, st, 0o600); return json(res, 200, { ok: true, settings: pubSet() }), true; }
      if (route === 'voice/list') { const h = await citHealth(); let voices = []; if (h.ok) { try { voices = await citVoices(); } catch (e) { h.ok = false; h.error = e.message; } } return json(res, 200, { ok: true, health: h, voices }), true; }
      if (route === 'voice/test') { const t = clean(b.text, 200) || 'Xin chào, đây là giọng đọc thử của S Creator.'; const f = path.join(WS, 'creator', '.voice-test.mp3'); await citSpeak(t, clean(b.voice, 80) || getSet().citVoice, f); const buf = fs.readFileSync(f); fs.unlinkSync(f); return json(res, 200, { ok: true, audio: 'data:audio/mpeg;base64,' + buf.toString('base64') }), true; }
      if (route === 'socin/accounts') { const r = await socin('/api/integration/creator/accounts', 'GET'); return json(res, 200, { ok: true, accounts: (r && r.accounts) || [] }), true; }
      if (route === 'project/save') {
        const name = clean(b.name, 80), concept = clean(b.concept, 2000); if (!name) bad('Thiếu tên dự án'); if (concept.length < 5) bad('Hãy mô tả concept (ít nhất vài từ)');
        let p; if (b.id) { p = load(b.id); } else { let id = slug(name), n = id, i = 2; while (fs.existsSync(pf(n))) n = id + '-' + i++; p = { id: n, step: 'concept', ideas: [], idea: null, script: null, images: {}, video: null, schedule: [], created: Date.now() }; }
        Object.assign(p, { name, concept, audience: clean(b.audience, 200), tone: clean(b.tone, 100), channels: chans(b.channels) }); save(p); return json(res, 200, { ok: true, project: view(p) }), true; }
      if (route === 'project/delete') { const p = load(b.id); if (b.confirm !== p.name) bad('Gõ đúng tên dự án để xác nhận xóa'); fs.unlinkSync(pf(p.id)); fs.rmSync(outDir(p.id), { recursive: true, force: true }); return json(res, 200, { ok: true }), true; }
      if (route === 'ai/ideas') {
        const p = load(b.id); const out = await ask(`Bạn là chuyên gia content social. ${ctxOf(p)}\nĐề xuất 6 ý tưởng nội dung ngắn khác nhau. Trả về DUY NHẤT JSON mảng: [{"title":"","hook":"câu mở đầu thu hút","angle":"góc tiếp cận","format":"video dọc 30-45s | carousel | bài chữ"}]. Tiếng Việt.`);
        const arr = parseJson(out); if (!Array.isArray(arr) || !arr.length) bad('Claude không đề xuất được ý tưởng'); p.ideas = arr.slice(0, 8).map((x) => ({ title: clean(x.title, 120), hook: clean(x.hook, 300), angle: clean(x.angle, 300), format: clean(x.format, 60) })); p.step = 'ideas'; save(p); return json(res, 200, { ok: true, project: view(p) }), true; }
      if (route === 'ai/script') {
        const p = load(b.id); const i = Number(b.idea); if (!Number.isInteger(i) || !p.ideas[i]) bad('Chọn một ý tưởng'); p.idea = i; const idea = p.ideas[i]; const pl = p.channels.map((c) => c.platform); const plats = pl.length ? pl : ['tiktok'];
        const out = await ask(`Bạn là biên kịch video ngắn. ${ctxOf(p)}\nÝ tưởng đã chọn: ${idea.title} — ${idea.hook} (${idea.angle})\nViết kịch bản 5-7 cảnh, tổng 30-45 giây, dọc 9:16. Trả về DUY NHẤT JSON: {"title":"","hook":"","scenes":[{"seconds":5,"narration":"lời đọc","text":"chữ ngắn trên màn hình (≤ 60 ký tự)","visual":"mô tả hình","icon":"1 emoji minh hoạ chính của cảnh","imagePrompt":"English: ONLY the action, setting, mood and camera of this scene (do NOT describe the main character; it is prepended automatically), no text, no letters"}],"character":"English, ONE detailed sentence describing the SAME main character in every scene: age, gender, face, hair, skin tone, exact clothing and colours","style":"English, 1 sentence: the shared art style, colour palette and lighting used in EVERY scene","captions":{${plats.map((x) => `"${x}":{"title":"","text":"","hashtags":["",""]}`).join(',')}}}. Tiếng Việt cho lời đọc/caption.`);
        const s = parseJson(out); if (!s || !Array.isArray(s.scenes) || !s.scenes.length) bad('Kịch bản không hợp lệ, thử lại');
        p.script = { title: clean(s.title, 120), hook: clean(s.hook, 300), scenes: s.scenes.slice(0, 12).map((x) => ({ seconds: Math.min(30, Math.max(2, Number(x.seconds) || 4)), narration: clean(x.narration, 500), text: clean(x.text, 80), visual: clean(x.visual, 300), icon: clean(x.icon, 8), imagePrompt: clean(x.imagePrompt, 500) })), style: clean(s.style, 300), character: clean(s.character, 400), captions: {} };
        plats.forEach((x) => { const c = (s.captions || {})[x] || {}; p.script.captions[x] = { title: clean(c.title || s.title, 120), text: clean(c.text, 2200), hashtags: (Array.isArray(c.hashtags) ? c.hashtags : []).map((h) => clean(h, 40).replace(/^#?/, '#')).slice(0, 10) }; });
        p.images = {}; p.video = null; p.step = 'script'; save(p); return json(res, 200, { ok: true, project: view(p) }), true; }
      if (route === 'script/save') { const p = load(b.id); if (!b.script || !Array.isArray(b.script.scenes)) bad('Kịch bản không hợp lệ'); const sc = p.script || { captions: {} };
        sc.title = clean(b.script.title, 120); sc.hook = clean(b.script.hook, 300); sc.scenes = b.script.scenes.slice(0, 12).map((x) => ({ seconds: Math.min(30, Math.max(2, Number(x.seconds) || 4)), narration: clean(x.narration, 500), text: clean(x.text, 80), visual: clean(x.visual, 300), icon: clean(x.icon, 8), imagePrompt: clean(x.imagePrompt, 500) })); if (b.script.style !== undefined) sc.style = clean(b.script.style, 300); if (b.script.character !== undefined) sc.character = clean(b.script.character, 400);
        Object.entries(b.script.captions || {}).forEach(([k, c]) => { if (PLATFORMS.includes(k)) sc.captions[k] = { title: clean(c.title, 120), text: clean(c.text, 2200), hashtags: (c.hashtags || []).map((h) => clean(h, 40)).slice(0, 10) }; }); p.script = sc; save(p); return json(res, 200, { ok: true, project: view(p) }), true; }
      if (route === 'image/generate') { const p = load(b.id), n = Number(b.scene); if (!p.script || !p.script.scenes[n - 1]) bad('Không có cảnh này'); const src = ['api', 'gemini', 'claude', 'card'].includes(b.source) ? b.source : 'card'; await genImage(p, n, src); return json(res, 200, { ok: true, project: view(p) }), true; }
      if (route === 'image/upload') { const p = load(b.id), n = Number(b.scene); if (!p.script || !p.script.scenes[n - 1]) bad('Không có cảnh này'); const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.dataUrl || '')); if (!m) bad('Chỉ nhận ảnh PNG/JPEG'); const buf = Buffer.from(m[2], 'base64'); if (buf.length > 8e6) bad('Ảnh tối đa 8 MB'); const dir = outDir(p.id); fs.mkdirSync(dir, { recursive: true }); const file = `scene-${n}.png`; fs.writeFileSync(path.join(dir, file), buf); p.images[String(n)] = file; p.step = 'images'; save(p); return json(res, 200, { ok: true, project: view(p) }), true; }
      if (route === 'video/cancel') { const c = jobCtx.get(clean(b.id, 80)); if (!c) bad('Không có video đang dựng'); c.cancelled = true; try { c.ac.abort(); } catch {} c.children.forEach((x) => { try { x.kill('SIGKILL'); } catch {} }); return json(res, 200, { ok: true }), true; }
      if (route === 'video/render') {
        const p = load(b.id); if (jobs.has(p.id)) bad('Video đang được dựng'); if (!has('ffmpeg')) bad('Chưa có ffmpeg. Cài bằng: brew install ffmpeg'); if (!p.script) bad('Chưa có kịch bản');
        if (b.engine === 'drawthings') { if (!getSet().imageApi) bad('Chưa cấu hình Draw Things / server ảnh (tab Kết nối)'); b = { ...b, autoImages: true, imageSource: 'api' }; if (b.redraw) p.images = {}; }
        let miss = p.script.scenes.map((_, i) => i + 1).filter((i) => !p.images[String(i)]); if (miss.length && b.autoImages) { const src = ['api', 'gemini', 'claude', 'card'].includes(b.imageSource) ? b.imageSource : srcOf(getSet()); for (const n of miss) await genImage(p, n, src); miss = []; } if (miss.length) bad('Còn thiếu ảnh cho cảnh: ' + miss.join(', '));
        p.video = { status: 'rendering', started: Date.now() }; p.step = 'video'; save(p); jobs.add(p.id);
        render(p.id, { voice: b.voice !== false, captions: b.captions !== false, engine: b.engine === 'gemini' ? 'gemini' : 'ffmpeg', delay: Number(b.testDelay) || 0 }).then((r) => { const q2 = load(p.id); q2.video = { status: 'done', ...r, at: Date.now() }; save(q2); }).catch((e) => { const q2 = load(p.id); q2.video = e.cancelled ? { status: 'cancelled', at: Date.now() } : { status: 'error', error: String(e.message).slice(0, 500) }; save(q2); }).finally(() => jobs.delete(p.id));
        return json(res, 200, { ok: true, project: view(load(p.id)) }), true; }
      if (route === 'schedule/plan') {
        const p = load(b.id); if (!p.script) bad('Chưa có nội dung'); if (!p.channels.length) bad('Chưa chọn kênh đăng');
        const start = new Date(String(b.startDate || '')); if (Number.isNaN(start.getTime())) bad('Ngày bắt đầu không hợp lệ'); const hours = (Array.isArray(b.hours) ? b.hours : []).map(Number).filter((h) => h >= 0 && h <= 23); if (!hours.length) bad('Chọn ít nhất một khung giờ');
        const gap = Math.min(30, Math.max(0, Number(b.gapMinutes) || 0)); const auto = b.auto !== false;
        p.schedule = (p.schedule || []).filter((x) => x.status !== 'queued'); const base = new Date(start); base.setHours(0, 0, 0, 0);
        p.channels.forEach((c, ci) => { const cap = p.script.captions[c.platform] || { title: p.script.title, text: '', hashtags: [] }; const at = new Date(base); at.setHours(hours[0], ci * gap, 0, 0); if (at < new Date()) at.setDate(at.getDate() + 1);
          p.schedule.push({ id: 'i' + Date.now().toString(36) + ci, platform: c.platform, accountId: c.accountId, accountName: c.accountName, adapter: c.adapter, runAt: at.toISOString(), status: 'queued', auto, title: cap.title, caption: (cap.text + '\n\n' + (cap.hashtags || []).join(' ')).trim(), result: null, error: '' }); });
        p.step = 'schedule'; save(p); return json(res, 200, { ok: true, project: view(p) }), true; }
      if (route === 'schedule/item') { const p = load(b.id); const it = (p.schedule || []).find((x) => x.id === b.item); if (!it) bad('Không thấy mục lịch', 404); if (b.delete) { p.schedule = p.schedule.filter((x) => x !== it); save(p); return json(res, 200, { ok: true, project: view(p) }), true; }
        if (it.status === 'sent' || it.status === 'sending') bad('Mục này đã gửi, không sửa được');
        if (b.runAt !== undefined) { const d = new Date(b.runAt); if (Number.isNaN(d.getTime())) bad('Giờ không hợp lệ'); it.runAt = d.toISOString(); } if (b.title !== undefined) it.title = clean(b.title, 120); if (b.caption !== undefined) it.caption = clean(b.caption, 2200); if (b.auto !== undefined) it.auto = !!b.auto; if (it.status === 'failed') it.status = 'queued'; save(p); return json(res, 200, { ok: true, project: view(p) }), true; }
      if (route === 'schedule/send') { const p = load(b.id); const it = (p.schedule || []).find((x) => x.id === b.item); if (!it) bad('Không thấy mục lịch', 404); if (it.status === 'sent') bad('Đã gửi rồi'); try { it.result = await publish(p, it); it.status = 'sent'; it.error = ''; it.sentAt = Date.now(); } catch (e) { it.status = 'failed'; it.error = String(e.message).slice(0, 300); } save(p); return json(res, 200, { ok: it.status === 'sent', error: it.error || undefined, project: view(p) }), true; }
      return json(res, 404, { error: 'not found' }), true;
    } catch (e) { json(res, e.status || 500, { ok: false, error: String(e.message || e) }); return true; }
  };
};
