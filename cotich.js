// Đất cổ tích (trong S Game): kho tài nguyên chung của dự án game cổ tích, đọc thẳng từ thư mục dự án trên máy (mặc định ~/Downloads/ClaudeCode).
// Không chép, không sửa file: chỉ quét và hiển thị. Đổi thư mục bằng "sgame": { "cotichDir": "..." } trong config.json.
// Gom: tiến độ (ma trận từng tướng + file tiến độ), nhân vật, game và giao diện app game, kênh YouTube và lịch đăng, tập phim, video.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HEROES = [
  ['giong', 'Thánh Gióng'], ['son-tinh', 'Sơn Tinh'], ['an-duong-vuong', 'An Dương Vương'], ['thach-sanh', 'Thạch Sanh'],
  ['au-co', 'Âu Cơ'], ['coc', 'Cóc'], ['tam', 'Tấm'], ['chu-cuoi', 'Chú Cuội'], ['mai-an-tiem', 'Mai An Tiêm'],
  ['lang-lieu', 'Lang Liêu'], ['anh-khoai', 'Anh Khoai'], ['chu-dong-tu', 'Chử Đồng Tử'],
];
// Các bước làm một tướng, mỗi bước có file chứng minh đã xong (hàm nhận slug, trả các đường dẫn tương đối thử lần lượt)
const STEPS = [
  { id: 'anh2d', name: 'Ảnh 2D', files: (s) => [`co-tich-assets/nhan-vat/${s}.png`] },
  { id: 'the', name: 'Bộ thẻ', dir: (s) => `co-tich-assets/the-hoan-chinh/${s}` },
  { id: 'mohinh', name: 'Mô hình 3D', files: (s) => [`thu-3d/game-ready/${s}-sach.glb`, `thu-3d/game-ready/${s}.glb`] },
  { id: 'xuong', name: 'Gắn xương', files: (s) => [`thu-3d/rig/${s}-sach-rig.glb`, `thu-3d/rig/${s}-rig.glb`] },
  { id: 'godot', name: 'Vào game Godot', files: (s) => [`tram-trung-godot/assets/heroes/${s}-rig.glb`] },
  { id: 'video', name: 'Video giới thiệu', dir: (s) => `video-gioi-thieu-12-tuong/render3d/${s}` },
];
const GAMES = [
  { dir: 'tram-trung-godot', name: 'Trăm Trứng Phiêu Lưu', engine: 'Godot 4', kind: 'Survivor roguelike dọc, Android/iOS', play: 'Choi thu.command', edit: 'Mo trong Godot.command', ui: ['assets/ui', 'assets/heroes/chan-dung'], cover: ['../tram-trung-game/bang-xem-tram-trung.png'] },
  { dir: 'giong-game', name: 'Gióng: Giữ Làng', engine: 'HTML5', kind: 'Thẻ bài phòng thủ, chơi trên trình duyệt', play: 'Choi game.command', ui: ['assets', '../giong-assets/ui'], cover: ['anh-chup-man-7.jpg', '../giong-assets/bang-tong-hop.png'] },
  { dir: 'tram-trung-game', name: 'Trăm Trứng: bộ hình', engine: 'Tài nguyên', kind: 'Tướng, tranh thẻ, quái cho Trăm Trứng', ui: ['assets/h', 'assets/c', 'assets/e'], cover: ['bang-xem-tram-trung.png'] },
];
const MEDIA = /\.(png|jpe?g|webp|gif|svg)$/i, VIDEO = /\.(mp4|mov|webm|m4v)$/i;
const SERVE = /\.(png|jpe?g|webp|gif|svg|mp4|mov|webm|m4v|md|txt|json|csv|glb|wav|mp3)$/i;
const PRUNE = new Set(['.venv', 'venv', 'node_modules', '.git', '.godot', 'hunyuan', 'triposr', 'python', 'hf-cache', 'uv-cache', 'Godot.app', 'site-packages', '_xoa', '__pycache__']);
const CT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8', '.csv': 'text/plain; charset=utf-8', '.glb': 'model/gltf-binary', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };

// CSV có ô nhiều dòng trong ngoặc kép
function parseCsv(txt) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"' && txt[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [h, ...rest] = rows; return h ? rest.filter((r) => r.some((x) => x.trim())).map((r) => Object.fromEntries(h.map((k, i) => [k.trim(), r[i] ?? '']))) : [];
}

module.exports = function init({ cfg = {}, json }) {
  const H = process.env.SHUB_HOME || os.homedir();
  const DIR = path.resolve(((cfg.sgame || {}).cotichDir || path.join(H, 'Downloads', 'ClaudeCode')).replace(/^~(?=$|[\/\\])/, H));
  const OPEN = process.env.SHUB_OPEN_BIN || (process.platform === 'win32' ? 'explorer' : 'open');
  const abs = (rel) => path.join(DIR, rel);
  const exists = (rel) => fs.existsSync(abs(rel));
  const isDir = (rel) => { try { return fs.statSync(abs(rel)).isDirectory(); } catch { return false; } };
  const ls = (rel, re) => { try { return fs.readdirSync(abs(rel)).filter((n) => !n.startsWith('.') && (!re || re.test(n))).sort(); } catch { return []; } };
  const read = (rel, max = 200000) => { try { return fs.readFileSync(abs(rel), 'utf8').slice(0, max); } catch { return ''; } };
  const first = (list) => list.find(exists) || '';
  const norm = (p) => p.split(path.sep).join('/');
  const join = (a, b) => norm(path.normalize(path.join(a, b)));
  const isDraft = (rel) => /(^|\/)(_nhap|_test|_truoc|_tho|_khung|tham-khao)(\/|$)|\.v\d+\.|(^|\/)_/.test(rel);

  // Quét toàn bộ thư mục một lần (bỏ môi trường Python, model AI, cache)
  function walk() {
    const files = [];
    const go = (rel, depth) => {
      let ents; try { ents = fs.readdirSync(abs(rel), { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (e.name.startsWith('.') || PRUNE.has(e.name)) continue;
        const r = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) { if (depth < 7) go(r, depth + 1); continue; }
        if (!e.isFile() || /\.import$/.test(e.name)) continue;
        let st; try { st = fs.statSync(abs(r)); } catch { continue; }
        files.push({ p: r, size: st.size, mtime: st.mtimeMs });
        if (files.length > 40000) return;
      }
    };
    go('', 0); return files;
  }

  // Thông tin tướng trong game (hệ, vai, nội tại, 3 chiêu) đọc từ hero_data.gd
  function heroData() {
    const src = read('tram-trung-godot/scripts/hero_data.gd'); const out = {};
    const parts = src.split(/^\t"([a-z_-]+)": \{/m);
    for (let i = 1; i < parts.length; i += 2) {
      const b = parts[i + 1]; const g = (re) => (b.match(re) || [])[1] || '';
      const passive = b.match(/"passive": \{[^}]*"ten": "([^"]+)"[^}]*"mo_ta": "([^"]+)"/);
      const skills = [...(b.split('"passive"')[1] || '').matchAll(/\{"ten": "([^"]+)", "cd": ([\d.]+)/g)].slice(0, 3).map((m) => ({ ten: m[1], cd: Number(m[2]) }));
      out[parts[i].replace(/_/g, '-')] = { ten: g(/"ten": "([^"]+)"/), he: g(/"he": "([^"]+)"/), vai: g(/"vai": "([^"]+)"/), passive: passive ? { ten: passive[1], mo_ta: passive[2] } : null, skills };
    }
    return out;
  }
  // Ghi chú từng tướng trong bảng tiến độ (cột cuối)
  function progressNotes() {
    const out = {};
    for (const f of ls('thu-3d', /^tien-do.*\.md$/)) for (const ln of read('thu-3d/' + f).split('\n')) {
      const m = ln.match(/^\|\s*([a-z-]+)\s*\|(.*)\|\s*$/); if (!m || !HEROES.some((h) => h[0] === m[1])) continue;
      const cells = m[2].split('|').map((x) => x.trim()); out[m[1]] = { note: cells[cells.length - 1], file: 'thu-3d/' + f };
    }
    return out;
  }

  function heroes(files) {
    const hd = heroData(), notes = progressNotes();
    return HEROES.map(([slug, name]) => {
      const steps = STEPS.map((s) => {
        if (s.dir) { const d = s.dir(slug), n = ls(d).length; return { id: s.id, name: s.name, ok: n > 0, count: n, path: n ? d : '' }; }
        const f = first(s.files(slug)); return { id: s.id, name: s.name, ok: !!f, path: f };
      });
      const clips = files.filter((f) => /^thu-3d\/rig\/xem\/[^/]+$/.test(f.p) && new RegExp(`/${slug}(-sach|-kn)?-(idle|walk|run|attack|xoay-360)\\.mp4$`).test(f.p)).map((f) => ({ p: f.p, act: f.p.match(/-(idle|walk|run|attack|xoay-360)\.mp4$/)[1] }));
      const cards = ls(`co-tich-assets/the-hoan-chinh/${slug}`, MEDIA).map((n) => `co-tich-assets/the-hoan-chinh/${slug}/${n}`);
      const d = hd[slug] || {};
      return {
        slug, name: d.ten || name, he: d.he || '', vai: d.vai || '', passive: d.passive || null, skills: d.skills || [],
        img: first([`co-tich-assets/nhan-vat/${slug}.png`, `tram-trung-game/assets/h/${slug}.webp`]),
        portrait: first([`tram-trung-godot/assets/heroes/chan-dung/${slug}.webp`]),
        sheet: first([`co-tich-assets/bang-xem/${slug}.png`]),
        model: first([`thu-3d/rig/${slug}-sach-rig.glb`, `thu-3d/rig/${slug}-rig.glb`, `thu-3d/game-ready/${slug}.glb`]),
        views: [first([`thu-3d/rig/xem/${slug}-sach-4goc.png`, `thu-3d/rig/xem/${slug}-4goc.png`]), first([`thu-3d/rig/xem/${slug}-sach-hoat-hinh.png`, `thu-3d/rig/xem/${slug}-hoat-hinh.png`]), first([`thu-3d/game-ready/${slug}-xem.png`])].filter(Boolean),
        clips, cards: cards.slice(0, 12), cardCount: cards.length, steps, done: steps.filter((s) => s.ok).length, note: (notes[slug] || {}).note || '', noteFile: (notes[slug] || {}).file || '',
      };
    });
  }

  function games() {
    return GAMES.filter((g) => isDir(g.dir)).map((g) => {
      const rd = read(g.dir + '/README.md', 20000);
      const intro = (rd.split('\n').find((l) => l.trim() && !/^#|^\||^-|^`/.test(l)) || '').trim();
      const ui = []; for (const d of g.ui) { const rel = join(g.dir, d); for (const n of ls(rel, MEDIA).slice(0, 24)) ui.push(rel + '/' + n); }
      const cover = first(g.cover.map((c) => join(g.dir, c)));
      const chapters = [...rd.matchAll(/^\| \*?\*?([^|*]+)\*?\*? \| (.+) \|$/gm)].filter((m) => !/^-+$|^Phần$/.test(m[1].trim())).slice(0, 16).map((m) => ({ k: m[1].trim(), v: m[2].trim().slice(0, 300) }));
      return { dir: g.dir, name: g.name, engine: g.engine, kind: g.kind, intro, readme: exists(g.dir + '/README.md') ? g.dir + '/README.md' : '', cover, ui, features: chapters, play: g.play && exists(g.dir + '/' + g.play) ? g.dir + '/' + g.play : '', edit: g.edit && exists(g.dir + '/' + g.edit) ? g.dir + '/' + g.edit : '' };
    });
  }

  function channel() {
    if (!isDir('kenh-youtube')) return null;
    let k = {}; try { k = JSON.parse(read('kenh-youtube/tu-dong/kenh.json')); } catch {}
    const rows = parseCsv(read('kenh-youtube/tu-dong/lich-dang.csv'));
    const now = Date.now();
    const sched = rows.map((r) => {
      const at = Date.parse(`${r.ngay}T${(r.gio_vn || '19:30').padStart(5, '0')}:00+07:00`);
      const f = (r.file_tren_mac || '').replace(/^~/, H);
      return { so: r.so, ngay: r.ngay, gio: r.gio_vn, list: r.danh_sach_phat, title: r.tieu_de, videoId: r.video_id || '', file: path.basename(r.file_tren_mac || ''), hasFile: !!f && fs.existsSync(f), state: r.video_id ? (at <= now ? 'da-dang' : 'da-hen') : 'chua-tai' };
    });
    const by = (st) => sched.filter((x) => x.state === st).length;
    return {
      handle: '@datcotich', desc: k.mo_ta_kenh || '', keywords: Array.isArray(k.tu_khoa) ? k.tu_khoa : String(k.tu_khoa || '').split(',').map((x) => x.trim()).filter(Boolean),
      playlists: Array.isArray(k.danh_sach_phat) ? k.danh_sach_phat.map((p) => (typeof p === 'string' ? p : p.ten || p.title || p.name || '')).filter(Boolean) : [...new Set(sched.map((s) => s.list).filter(Boolean))],
      brand: ls('kenh-youtube/brand', MEDIA).filter((n) => !n.startsWith('_')).map((n) => 'kenh-youtube/brand/' + n),
      guide: exists('kenh-youtube/HUONG-DAN.md') ? 'kenh-youtube/HUONG-DAN.md' : '',
      schedule: sched, stats: { total: sched.length, posted: by('da-dang'), scheduled: by('da-hen'), pending: by('chua-tai'), withFile: sched.filter((s) => s.hasFile).length },
    };
  }

  // Tập phim (lang-co-tich/tap-*) và video giới thiệu
  function content(files) {
    const eps = ls('lang-co-tich', /^tap-\d+$/).map((t) => {
      const rel = 'lang-co-tich/' + t; const vids = ls(rel, VIDEO).filter((n) => !/\.v\d+\./.test(n));
      const main = vids.filter((n) => !/^doc-|540p/.test(n)).sort((a, b) => b.length - a.length)[0] || '';
      return { id: t, name: 'Tập ' + Number(t.slice(4)) + (main ? ': ' + main.replace(/^tap-\d+-|\.[^.]+$/g, '').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()) : ''), video: main ? rel + '/' + main : '', preview: vids.find((n) => /540p/.test(n)) ? rel + '/' + vids.find((n) => /540p/.test(n)) : '', parts: vids.filter((n) => /^doc-/.test(n)).map((n) => rel + '/' + n), stills: ls(rel + '/anh', MEDIA).slice(0, 8).map((n) => rel + '/anh/' + n) };
    });
    const sets = ls('lang-co-tich/nen-chung', MEDIA).map((n) => 'lang-co-tich/nen-chung/' + n);
    const intro = isDir('video-gioi-thieu-12-tuong') ? { name: 'Video giới thiệu 12 anh hùng', readme: 'video-gioi-thieu-12-tuong/README.md', caption: exists('video-gioi-thieu-12-tuong/tieu-de-caption-hashtag.md') ? 'video-gioi-thieu-12-tuong/tieu-de-caption-hashtag.md' : '', video: first(['video-gioi-thieu-12-tuong/video/12-anh-hung-dat-co-tich.mp4']), stills: ls('video-gioi-thieu-12-tuong', /\.jpg$/).map((n) => 'video-gioi-thieu-12-tuong/' + n) } : null;
    const captions = files.filter((f) => /caption|hashtag/i.test(f.p) && /\.md$/.test(f.p) && !isDraft(f.p)).map((f) => f.p);
    return { episodes: eps, sets, intro, captions };
  }

  function videos(files) {
    const cat = (p) => p.startsWith('lang-co-tich/') ? 'Tập phim' : p.startsWith('video-gioi-thieu') ? 'Giới thiệu' : p.startsWith('thu-3d/rig/xem/') ? 'Hoạt cảnh nhân vật' : p.startsWith('kenh-youtube') ? 'Kênh' : 'Khác';
    return files.filter((f) => VIDEO.test(f.p) && !isDraft(f.p)).map((f) => ({ p: f.p, name: path.basename(f.p).replace(/\.[^.]+$/, '').replace(/-/g, ' '), cat: cat(f.p), size: f.size, mtime: f.mtime })).sort((a, b) => b.mtime - a.mtime);
  }

  let cache = null;
  function overview(fresh) {
    if (!fresh && cache && Date.now() - cache.at < 30000) return cache.data;
    if (!fs.existsSync(DIR)) return { ok: false, dir: DIR.replace(H, '~'), error: 'Không thấy thư mục dự án. Đặt "sgame": { "cotichDir": "<thư mục>" } trong config.json.' };
    const files = walk();
    const hs = heroes(files);
    const docs = files.filter((f) => /\.md$/.test(f.p) && !isDraft(f.p)).sort((a, b) => b.mtime - a.mtime).map((f) => ({ p: f.p, mtime: f.mtime, progress: /tien-do|tiến-độ/i.test(f.p) }));
    const recent = files.filter((f) => !isDraft(f.p) && (MEDIA.test(f.p) || VIDEO.test(f.p) || /\.(md|glb|blend|gd|py|html)$/.test(f.p))).sort((a, b) => b.mtime - a.mtime).slice(0, 20).map((f) => ({ p: f.p, mtime: f.mtime }));
    const total = hs.length * STEPS.length, done = hs.reduce((a, h) => a + h.done, 0);
    const vids = videos(files); const ch = channel();
    const data = {
      ok: true, dir: DIR.replace(H, '~'), scannedAt: Date.now(), steps: STEPS.map((s) => ({ id: s.id, name: s.name })), heroes: hs, games: games(), channel: ch, content: content(files), videos: vids, docs, recent,
      stats: { heroes: hs.length, pct: total ? Math.round((done / total) * 100) : 0, cards: hs.reduce((a, h) => a + h.cardCount, 0), games: GAMES.filter((g) => isDir(g.dir)).length, videos: vids.length, files: files.length, episodes: ls('lang-co-tich', /^tap-\d+$/).length, scheduled: ch ? ch.stats.total : 0 },
    };
    cache = { at: Date.now(), data };
    return data;
  }

  // Trả file trong thư mục dự án (chỉ loại an toàn, có Range cho video)
  function sendFile(req, res, rel) {
    const p = path.resolve(DIR, rel || '');
    if (!rel || !p.startsWith(DIR + path.sep) || rel.split(/[\/\\]/).some((s) => s.startsWith('.')) || !SERVE.test(p)) return json(res, 400, { error: 'Không cho mở file này' });
    let st; try { st = fs.statSync(p); } catch { return json(res, 404, { error: 'Không thấy file' }); }
    if (!st.isFile()) return json(res, 404, { error: 'Không thấy file' });
    const type = CT[path.extname(p).toLowerCase()] || 'application/octet-stream';
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2])); let end = m[1] && m[2] ? Number(m[2]) : st.size - 1;
      end = Math.min(end, st.size - 1); if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'max-age=60' });
      return fs.createReadStream(p, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'max-age=60' });
    fs.createReadStream(p).pipe(res);
  }

  return async function handle(req, res, u) {
    if (!u.pathname.startsWith('/api/cotich/')) return false;
    const r = u.pathname.slice(12);
    try {
      if (r === 'overview') return json(res, 200, overview(u.searchParams.get('fresh') === '1')), true;
      if (r === 'file') return sendFile(req, res, u.searchParams.get('p')), true;
      if (r === 'open' && req.method === 'POST') {
        // Mở trong Finder, hoặc chạy file .command có sẵn của dự án (Chơi thử, Mở trong Godot) trên Mac
        let b = ''; for await (const d of req) b += d; let j = {}; try { j = JSON.parse(b || '{}'); } catch {}
        const rel = String(j.p || ''); const p = path.resolve(DIR, rel);
        if (!rel || !p.startsWith(DIR + path.sep) || !fs.existsSync(p)) return json(res, 400, { error: 'Không thấy file' }), true;
        const run = j.run && /\.command$/.test(p) && process.platform !== 'win32';
        const args = run ? [p] : process.platform === 'win32' ? ['/select,', p] : ['-R', p];
        const c = spawn(OPEN, args, { stdio: 'ignore', detached: true }); c.on('error', () => {}); c.unref();
        return json(res, 200, { ok: true }), true;
      }
      return json(res, 404, { error: 'not found' }), true;
    } catch (e) { return json(res, 500, { ok: false, error: e.message || String(e) }), true; }
  };
};
