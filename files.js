// Kho file: quản lý mọi file tải về theo danh mục (backup, báo cáo, mã nguồn, app đã build, ...).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

module.exports = function init({ WS, cfg, json, body }) {
  const ROOT = path.join(WS, 'downloads');
  fs.mkdirSync(ROOT, { recursive: true });
  const META = path.join(ROOT, '.meta.json');
  const expand = (p) => String(p).replace(/^~(?=$|\/)/, os.homedir());
  const DEFAULT_LABELS = { backup: 'Backup VPS', 'bao-cao': 'Báo cáo kiểm thử', 'ma-nguon': 'Mã nguồn (repo)', build: 'App đã build', 'nhat-ky': 'Nhật ký', khac: 'Khác' };
  const readMeta = () => { try { return JSON.parse(fs.readFileSync(META, 'utf8')); } catch { return { labels: {}, notes: {} }; } };
  const writeMeta = (m) => fs.writeFileSync(META, JSON.stringify(m, null, 2));
  Object.keys(DEFAULT_LABELS).forEach((k) => fs.mkdirSync(path.join(ROOT, k), { recursive: true }));
  // Nguồn ngoài (chỉ đọc): mặc định thư mục build của Build Hub nếu có
  const externals = () => {
    const list = Array.isArray(cfg.fileSources) ? cfg.fileSources : [{ category: 'build', label: 'App đã build', path: '~/SPrimeBuilds/_out' }];
    return list.map((s) => ({ category: String(s.category || 'build').replace(/[^\w-]/g, ''), label: s.label, dir: path.resolve(expand(s.path)) })).filter((s) => { try { return fs.statSync(s.dir).isDirectory(); } catch { return false; } });
  };
  const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const HIDDEN = /\.(sha256|meta|pin|part)$|^\./;
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const dec = (id) => { try { return JSON.parse(Buffer.from(id, 'base64url').toString()); } catch { return null; } };
  function walk(dir, depth, base, out, cat, ext) {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (HIDDEN.test(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 4) walk(p, depth + 1, base, out, cat, ext);
      else if (e.isFile()) { let st; try { st = fs.statSync(p); } catch { continue; } out.push({ cat, rel: path.relative(base, p), abs: p, size: st.size, mtime: st.mtimeMs, ext }); }
    }
  }
  function all() {
    const m = readMeta(); const out = [];
    for (const c of fs.readdirSync(ROOT, { withFileTypes: true })) if (c.isDirectory() && !c.name.startsWith('.')) walk(path.join(ROOT, c.name), 0, path.join(ROOT, c.name), out, c.name, false);
    externals().forEach((s) => walk(s.dir, 0, s.dir, out, s.category, true));
    return { m, items: out.map((f) => ({ id: enc({ c: f.cat, r: f.rel, x: f.ext }), name: path.basename(f.rel), dir: path.dirname(f.rel) === '.' ? '' : path.dirname(f.rel), category: f.cat, size: f.size, mtime: f.mtime, external: f.ext, note: (m.notes || {})[`${f.cat}/${f.rel}`] || '' })) };
  }
  function resolveId(id) {
    const o = dec(id); if (!o || typeof o.c !== 'string' || typeof o.r !== 'string') return null;
    const base = o.x ? (externals().find((s) => s.category === o.c) || {}).dir : path.join(ROOT, o.c);
    if (!base) return null;
    const abs = path.resolve(base, o.r);
    if (abs !== base && !abs.startsWith(base + path.sep)) return null;
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    return { abs, cat: o.c, rel: o.r, ext: !!o.x, base };
  }
  function categories() {
    const m = readMeta(); const { items } = all(); const map = {};
    const names = new Set([...Object.keys(DEFAULT_LABELS), ...fs.readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name), ...externals().map((s) => s.category)]);
    names.forEach((k) => (map[k] = { key: k, label: (m.labels || {})[k] || DEFAULT_LABELS[k] || (externals().find((s) => s.category === k) || {}).label || k, count: 0, bytes: 0, builtin: !!DEFAULT_LABELS[k] }));
    items.forEach((i) => { if (map[i.category]) { map[i.category].count++; map[i.category].bytes += i.size; } });
    return { cats: Object.values(map), items };
  }
  const bad = (m, s = 400) => { const e = new Error(m); e.status = s; throw e; };

  const h = async function handle(req, res, u) {
    try {
      if (u.pathname.startsWith('/files/dl/')) {
        const f = resolveId(decodeURIComponent(u.pathname.slice(10))); if (!f) return json(res, 404, { error: 'not found' }), true;
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': fs.statSync(f.abs).size, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(f.abs))}` });
        fs.createReadStream(f.abs).pipe(res); return true;
      }
      if (!u.pathname.startsWith('/api/files')) return false;
      const route = u.pathname.slice(11);
      if (route === '' || route === 'list') {
        const { cats, items } = categories();
        const cat = u.searchParams.get('category') || ''; const q = (u.searchParams.get('q') || '').toLowerCase();
        const sort = u.searchParams.get('sort') || 'new'; const page = Math.max(1, Number(u.searchParams.get('page') || 1)); const size = Math.min(100, Math.max(5, Number(u.searchParams.get('size') || 10)));
        let list = items.filter((i) => (!cat || i.category === cat) && (!q || (i.name + ' ' + i.note + ' ' + i.dir).toLowerCase().includes(q)));
        list.sort((a, b) => (sort === 'size' ? b.size - a.size : sort === 'name' ? a.name.localeCompare(b.name) : b.mtime - a.mtime));
        return json(res, 200, { ok: true, categories: cats, total: list.length, page, size, items: list.slice((page - 1) * size, page * size) }), true;
      }
      if (route === 'summary') {
        const { cats, items } = categories(); const byMonth = {};
        items.forEach((i) => { const d = new Date(i.mtime); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; byMonth[k] = (byMonth[k] || 0) + i.size; });
        return json(res, 200, { ok: true, categories: cats, files: items.length, bytes: items.reduce((a, b) => a + b.size, 0), byMonth, largest: items.slice().sort((a, b) => b.size - a.size).slice(0, 8) }), true;
      }
      const b = req.method === 'POST' ? await body(req) : {};
      if (route === 'category') {
        const label = String(b.label || '').trim().slice(0, 40); const key = slug(label);
        if (!key) bad('Tên danh mục không hợp lệ'); const m = readMeta(); m.labels = m.labels || {}; m.labels[key] = label;
        fs.mkdirSync(path.join(ROOT, key), { recursive: true }); writeMeta(m); return json(res, 200, { ok: true, key }), true;
      }
      if (route === 'category/delete') {
        const key = String(b.key || ''); if (DEFAULT_LABELS[key] || !/^[a-z0-9-]{1,40}$/.test(key)) bad('Không xóa được danh mục này');
        const dir = path.join(ROOT, key); if (fs.existsSync(dir) && fs.readdirSync(dir).length) bad('Danh mục còn file, hãy chuyển hoặc xóa file trước');
        try { fs.rmdirSync(dir); } catch {} const m = readMeta(); delete (m.labels || {})[key]; writeMeta(m); return json(res, 200, { ok: true }), true;
      }
      if (route === 'move') {
        const f = resolveId(b.id); if (!f || f.ext) bad('Không chuyển được file này (nguồn ngoài chỉ đọc)');
        const to = String(b.category || ''); if (!/^[a-z0-9-]{1,40}$/.test(to) || !fs.existsSync(path.join(ROOT, to))) bad('Danh mục không tồn tại');
        const dest = path.join(ROOT, to, path.basename(f.abs)); if (fs.existsSync(dest)) bad('Đã có file trùng tên trong danh mục đích');
        fs.renameSync(f.abs, dest);
        for (const sfx of ['.sha256', '.meta', '.pin']) if (fs.existsSync(f.abs + sfx)) fs.renameSync(f.abs + sfx, dest + sfx);
        return json(res, 200, { ok: true }), true;
      }
      if (route === 'delete') {
        const f = resolveId(b.id); if (!f) bad('Không thấy file', 404); if (f.ext) bad('Nguồn ngoài chỉ đọc, không xóa tại đây');
        fs.unlinkSync(f.abs); for (const sfx of ['.sha256', '.meta', '.pin']) { try { fs.unlinkSync(f.abs + sfx); } catch {} }
        return json(res, 200, { ok: true }), true;
      }
      if (route === 'note') {
        const f = resolveId(b.id); if (!f) bad('Không thấy file', 404);
        const m = readMeta(); m.notes = m.notes || {}; const k = `${f.cat}/${f.rel}`; const n = String(b.note || '').slice(0, 300); if (n) m.notes[k] = n; else delete m.notes[k]; writeMeta(m);
        return json(res, 200, { ok: true }), true;
      }
      if (route === 'reveal') {
        const f = resolveId(b.id); if (!f) bad('Không thấy file', 404);
        if (process.platform !== 'darwin') return json(res, 200, { ok: false, path: f.abs, error: 'Chỉ mở Finder được trên macOS' }), true;
        spawn('open', ['-R', f.abs], { detached: true, stdio: 'ignore' }).unref(); return json(res, 200, { ok: true, path: f.abs }), true;
      }
      return json(res, 404, { error: 'not found' }), true;
    } catch (e) { json(res, e.status || 500, { ok: false, error: String(e.message || e) }); return true; }
  };
  h.ROOT = ROOT;
  h.saveText = (cat, name, text) => { const d = path.join(ROOT, cat); fs.mkdirSync(d, { recursive: true }); const p = path.join(d, name); fs.writeFileSync(p, text); return { id: enc({ c: cat, r: name, x: false }), path: p }; };
  return h;
};
