// Test Đất cổ tích: dựng thư mục dự án giả (tướng, game, kênh, tập phim), kiểm tra tổng hợp và chặn đọc file ngoài thư mục.
const { spawn } = require('child_process'); const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL', m)); if (c) console.log('ok  ', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ctt-')); const D = path.join(T, 'ClaudeCode'); const OPENLOG = path.join(T, 'open.log');
const w = (rel, c = 'x') => { const p = path.join(D, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };
for (const s of ['giong', 'son-tinh', 'au-co']) { w(`co-tich-assets/nhan-vat/${s}.png`); w(`co-tich-assets/the-hoan-chinh/${s}/a.png`); w(`co-tich-assets/the-hoan-chinh/${s}/b.png`); w(`thu-3d/game-ready/${s}.glb`); }
w('thu-3d/rig/giong-sach-rig.glb'); w('tram-trung-godot/assets/heroes/giong-rig.glb'); w('video-gioi-thieu-12-tuong/render3d/giong/info.json', '{}');
w('thu-3d/rig/xem/giong-attack.mp4', '0123456789'); w('thu-3d/rig/xem/giong-xoay-360.mp4'); w('thu-3d/rig/xem/_khung/giong-idle.mp4');
w('thu-3d/tien-do-11-tuong.md', '| Nhân vật | 2D | Ghi chú |\n|---|---|---|\n| son-tinh | ✓ | gáy vẫn hơi trọc |\n');
w('tram-trung-godot/scripts/hero_data.gd', 'const HEROES := {\n\t"giong": {\n\t\t"ten": "Thánh Gióng", "he": "Hỏa", "vai": "Chiến binh tuyến đầu",\n\t\t"passive": {"id": "bat_com", "ten": "Bát Cơm Làng", "mo_ta": "Nhặt thóc to thêm."},\n\t\t"skills": [\n\t\t\t{"ten": "Ánh Mắt", "cd": 12.0, "kind": "x"},\n\t\t\t{"ten": "Vác Tre", "cd": 20.0},\n\t\t\t{"ten": "Phun Lửa", "cd": 40.0}\n\t\t],\n\t},\n}\n');
w('tram-trung-godot/README.md', '# Trăm Trứng\n\nGame survivor roguelike.\n\n| Phần | Nội dung |\n|---|---|\n| Sảnh | Màn chào |\n'); w('tram-trung-godot/Choi thu.command', '#!/bin/bash'); w('tram-trung-godot/assets/ui/sanh.webp');
w('giong-game/README.md', '# Gióng\n\nCách chơi: mở trình duyệt.'); w('giong-game/anh-chup-man-7.jpg');
w('kenh-youtube/tu-dong/kenh.json', JSON.stringify({ mo_ta_kenh: 'Chào mừng bạn đến Đất Cổ Tích!', tu_khoa: 'Đất Cổ Tích, Con Lạc', danh_sach_phat: ['Làm Quen Anh Hùng'] }));
w('kenh-youtube/tu-dong/lich-dang.csv', 'so,ngay,gio_vn,file_tren_mac,danh_sach_phat,tieu_de,mo_ta,the_tag,binh_luan_ghim,video_id\n00,2026-11-01,19:30,~/Movies/a.mp4,Làm Quen Anh Hùng,"Tiêu đề, có phẩy","Mô tả\nnhiều dòng",x,y,abc123\n01,2027-01-01,19:30,~/Movies/b.mp4,Cổ Tích 60 Giây,Tập hai,m,t,b,\n');
w('kenh-youtube/brand/avatar-800.png'); w('kenh-youtube/brand/_xem-avatar-tron.png');
w('lang-co-tich/tap-01/tap-01-ngay-hoi-lang.mp4'); w('lang-co-tich/tap-01/tap-01-ngay-hoi-lang.v1.mp4'); w('lang-co-tich/tap-01/doc-tung.mp4'); w('lang-co-tich/nen-chung/san-dinh.png');
w('thu-3d/hunyuan/.venv/x.mp4'); w('thu-3d/.venv/lib/y.md'); fs.writeFileSync(path.join(T, 'bimat.txt'), 'secret');
fs.writeFileSync(path.join(T, 'open'), `#!/bin/bash\necho "$@" >> ${OPENLOG}\n`, { mode: 0o755 });
const P = 4795;
const req = (p, o, hd = {}) => new Promise((res) => { const rq = http.request({ host: '127.0.0.1', port: P, path: p, method: o ? 'POST' : 'GET', headers: { ...(o ? { Origin: 'http://127.0.0.1:' + P } : {}), ...hd } }, (r) => { let d = ''; r.on('data', (x) => (d += x)); r.on('end', () => res({ s: r.statusCode, h: r.headers, t: d, j: (() => { try { return JSON.parse(d || '{}'); } catch { return {}; } })() })); }); rq.end(o ? JSON.stringify(o) : undefined); });
(async () => {
  fs.writeFileSync(path.join(T, 'c.json'), JSON.stringify({ port: P, workspace: path.join(T, 'ws'), sgame: { cotichDir: D } }));
  const srv = spawn('node', ['server.js'], { cwd: __dirname, env: { ...process.env, SHUB_CONFIG: path.join(T, 'c.json'), SHUB_NO_TIMER: '1', SHUB_NO_SGAME_BOOT: '1', SHUB_OPEN_BIN: path.join(T, 'open'), GITHUB_TOKEN: '' }, stdio: 'ignore' });
  await sleep(1000);
  try {
    ok((await req('/cotich.html')).s === 200, 'trang cotich.html mở được');
    const d = (await req('/api/cotich/overview')).j;
    ok(d.ok && d.heroes.length === 12, 'đủ 12 tướng');
    const g = d.heroes.find((h) => h.slug === 'giong');
    ok(g.name === 'Thánh Gióng' && g.he === 'Hỏa' && g.passive.ten === 'Bát Cơm Làng' && g.skills.map((s) => s.ten).join() === 'Ánh Mắt,Vác Tre,Phun Lửa', 'đọc hệ, nội tại, 3 chiêu từ hero_data.gd');
    ok(g.done === 6 && g.steps.find((s) => s.id === 'the').count === 2 && g.model === 'thu-3d/rig/giong-sach-rig.glb', 'Gióng đủ 6 bước, bộ thẻ 2, dùng bản rig sạch');
    ok(g.clips.length === 2 && !g.clips.some((c) => c.p.includes('_khung')), 'hoạt cảnh Gióng, bỏ bản nháp');
    const st = d.heroes.find((h) => h.slug === 'son-tinh'); ok(st.done === 3 && st.note === 'gáy vẫn hơi trọc', 'Sơn Tinh 3/6 bước, lấy ghi chú từ file tiến độ');
    ok(d.heroes.find((h) => h.slug === 'tam').done === 0, 'tướng chưa làm: 0 bước');
    ok(d.stats.pct === Math.round((6 + 3 + 3) / 72 * 100), 'phần trăm tiến độ tính đúng');
    const tt = d.games.find((x) => x.dir === 'tram-trung-godot'); ok(tt && tt.play === 'tram-trung-godot/Choi thu.command' && tt.features[0].k === 'Sảnh' && tt.ui.length === 1, 'game Trăm Trứng: nút chơi thử, tính năng, giao diện');
    ok(d.games.length === 2, 'chỉ hiện game có thư mục');
    const ch = d.channel; ok(ch.schedule.length === 2 && ch.schedule[0].title === 'Tiêu đề, có phẩy' && ch.schedule[0].state === 'da-dang' && ch.schedule[1].state === 'chua-tai', 'đọc lịch đăng CSV (ô có phẩy, nhiều dòng), trạng thái đăng');
    ok(ch.brand.length === 1 && ch.keywords.length === 2, 'bộ nhận diện kênh bỏ ảnh xem thử, tách từ khoá');
    const ep = d.content.episodes[0]; ok(ep.video === 'lang-co-tich/tap-01/tap-01-ngay-hoi-lang.mp4' && ep.parts.length === 1 && ep.name === 'Tập 1: Ngay hoi lang', 'tập phim: bản hoàn chỉnh + đoạn lẻ, bỏ bản .v1');
    ok(!d.videos.some((v) => /hunyuan|\.venv|\.v1\.|_khung/.test(v.p)) && d.videos.length === 4, 'danh sách video bỏ môi trường AI, bản cũ, bản nháp');
    ok(d.docs.some((x) => x.progress && x.p === 'thu-3d/tien-do-11-tuong.md') && !d.docs.some((x) => x.p.includes('.venv')), 'tài liệu có file tiến độ');
    const f = await req('/api/cotich/file?p=thu-3d/rig/xem/giong-attack.mp4', null, { Range: 'bytes=2-5' });
    ok(f.s === 206 && f.t === '2345' && f.h['content-range'] === 'bytes 2-5/10', 'xem video có Range (tua được)');
    ok((await req('/api/cotich/file?p=../bimat.txt')).s === 400, 'chặn đọc file ngoài thư mục dự án');
    ok((await req('/api/cotich/file?p=' + encodeURIComponent(path.join(T, 'bimat.txt')))).s === 400, 'chặn đường dẫn tuyệt đối');
    ok((await req('/api/cotich/file?p=tram-trung-godot/Choi%20thu.command')).s === 400, 'không trả file lệnh');
    ok((await req('/api/cotich/open', { p: 'tram-trung-godot/Choi thu.command', run: true })).s === 200, 'bấm Chơi thử');
    ok((await req('/api/cotich/open', { p: '../bimat.txt' })).s === 400, 'Mở trong Finder chỉ trong thư mục dự án');
    await sleep(300); const ol = fs.readFileSync(OPENLOG, 'utf8');
    ok(process.platform === 'win32' || ol.includes(path.join(D, 'tram-trung-godot', 'Choi thu.command')), 'chạy file Chơi thử của dự án');
    fs.writeFileSync(path.join(T, 'c.json'), '{}');
  } catch (e) { fail++; console.log('FAIL', e); }
  srv.kill(); fs.rmSync(T, { recursive: true, force: true });
  console.log(`\n${pass} đạt, ${fail} lỗi`); process.exit(fail ? 1 : 0);
})();
