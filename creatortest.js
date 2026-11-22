// Test S Creator: Claude giả, ffmpeg thật, Socin giả.
const { spawn } = require('child_process'); const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'shubc-')); const WS = path.join(T, 'ws');
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL', m)); if (c) console.log('ok  ', m); };
const got = [];
const fake = http.createServer((q, r) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => { const j = (c, o) => { r.writeHead(c, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(o)); };
  if (q.headers.authorization !== 'Bearer tok_1234567890abcdef') return j(401, { error: 'unauthorized' });
  if (q.url === '/api/integration/creator/accounts') return j(200, { accounts: [{ id: 'acc1', platform: 'tiktok', display_name: 'alter.sam96' }] });
  if (q.url === '/api/integration/creator/posts') { got.push(JSON.parse(b)); return j(201, { id: 'p-' + got.length }); } j(404, {}); }); });
const mp3 = path.join(T, 'tone.mp3'); require('child_process').execSync(`ffmpeg -y -f lavfi -i sine=frequency=440:duration=1 -q:a 6 "${mp3}" 2>/dev/null`); const citHits = [];
const cit = http.createServer((q, r) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => {
  if (q.url === '/health') { r.writeHead(200, { 'Content-Type': 'application/json' }); return r.end('{"status":"ok","engine":"fake"}'); }
  if (q.url === '/voices') { r.writeHead(200, { 'Content-Type': 'application/json' }); return r.end('[{"id":"thuy-dung","gender":"female","region":"South","isCloned":false}]'); }
  if (q.url === '/api/tts/generate') { citHits.push(JSON.parse(b)); r.writeHead(200, { 'Content-Type': 'audio/mpeg' }); return r.end(fs.readFileSync(mp3)); } r.writeHead(404); r.end(); }); });
const get = (p, port) => new Promise((res) => http.get({ host: '127.0.0.1', port, path: p }, (r) => { let d = ''; r.on('data', (x) => (d += x)); r.on('end', () => res({ s: r.statusCode, t: d, n: Number(r.headers['content-length'] || d.length) })); }));
const post = (p, o, port) => new Promise((res) => { const rq = http.request({ host: '127.0.0.1', port, path: p, method: 'POST' }, (r) => { let d = ''; r.on('data', (x) => (d += x)); r.on('end', () => res({ s: r.statusCode, j: JSON.parse(d || '{}') })); }); rq.end(JSON.stringify(o)); });
cit.listen(0); fake.listen(0, async () => {
  const bin = path.join(T, 'fakeclaude');
  fs.writeFileSync(bin, `#!/bin/bash
if echo "$2" | grep -q "6 ý tưởng"; then echo '[{"title":"Mẹo 1","hook":"Bạn có biết?","angle":"vốn","format":"video"},{"title":"Mẹo 2","hook":"h","angle":"a","format":"video"}]';
elif echo "$2" | grep -q "biên kịch"; then echo 'Đây: {"title":"5 mẹo vốn","hook":"Dừng lại!","scenes":[{"seconds":2,"narration":"Xin chào các bạn","text":"Mẹo quản lý vốn","visual":"v","imagePrompt":"cartoon"},{"seconds":2,"narration":"Mẹo số một","text":"Luôn đặt dừng lỗ","visual":"v","imagePrompt":"cartoon"}],"captions":{"tiktok":{"title":"5 mẹo","text":"Nội dung","hashtags":["vốn","forex"]},"threads":{"title":"t","text":"x","hashtags":[]}}}';
else echo ok; fi\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(T, 'c.json'), JSON.stringify({ port: 4793, workspace: WS }));
  const srv = spawn('node', ['server.js'], { cwd: __dirname, env: { ...process.env, SHUB_CONFIG: path.join(T, 'c.json'), SHUB_CLAUDE_BIN: bin, SHUB_NO_TIMER: '1' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 900)); const P = 4793;
  try {
    ok((await post('/api/cr/project/save', { name: 'x', concept: 'a' }, P)).s === 400, 'concept quá ngắn bị chặn');
    ok((await post('/api/cr/project/save', { name: 'x', concept: 'abc def', channels: [{ platform: 'bogus' }] }, P)).s === 400, 'kênh lạ bị chặn');
    const pr = await post('/api/cr/project/save', { name: 'Mẹo vốn', concept: 'Chuỗi video mẹo quản lý vốn', channels: [{ platform: 'tiktok', accountId: 'acc1', accountName: 'alter.sam96', adapter: 'socin' }, { platform: 'threads', adapter: 'export' }] }, P); ok(pr.j.ok && pr.j.project.id === 'meo-von', 'tạo dự án');
    const id = 'meo-von';
    const ide = await post('/api/cr/ai/ideas', { id }, P); ok(ide.j.project.ideas.length === 2 && ide.j.project.step === 'ideas', 'Claude đề xuất ý tưởng');
    ok((await post('/api/cr/ai/script', { id, idea: 9 }, P)).s === 400, 'chọn ý tưởng không có bị chặn');
    const sc = await post('/api/cr/ai/script', { id, idea: 0 }, P); ok(sc.j.project.script.scenes.length === 2 && sc.j.project.script.captions.tiktok.hashtags[0] === '#vốn', 'kịch bản + caption + hashtag');
    ok((await post('/api/cr/video/render', { id }, P)).s === 400, 'dựng video khi thiếu ảnh bị chặn');
    let r; for (const n of [1, 2]) r = await post('/api/cr/image/generate', { id, scene: n, source: 'card' }, P); ok(r.j.ok && Object.keys(r.j.project.images).length === 2, 'tạo thẻ ảnh cho 2 cảnh (Playwright)');
    ok((await get(`/cr/file/${id}/scene-1.png`, P)).s === 200 && (await get(`/cr/file/${id}/..%2Fx`, P)).s === 404, 'xem ảnh; chặn path traversal');
    ok((await post('/api/cr/image/upload', { id, scene: 1, dataUrl: 'data:text/html;base64,AAAA' }, P)).s === 400, 'upload chỉ nhận PNG/JPEG');
    ok((await post('/api/cr/video/render', { id, voice: false, captions: true }, P)).j.ok, 'bắt đầu dựng video');
    let v; for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 1000)); v = JSON.parse((await get('/api/cr/project?id=' + id, P)).t).project; if (v.video.status !== 'rendering') break; }
    ok(v.video.status === 'done' && v.video.bytes > 5000, 'video dựng xong: ' + JSON.stringify(v.video).slice(0, 120));
    const pf = JSON.parse(require('child_process').execSync(`ffprobe -v error -show_entries stream=width,height,codec_name -of json "${WS}/downloads/creator/${id}/video.mp4"`)).streams; ok(pf.some((s) => s.codec_name === 'h264' && s.width === 1080 && s.height === 1920), 'video 1080x1920 h264');
    ok(fs.existsSync(`${WS}/downloads/creator/${id}/video.srt`), 'có phụ đề .srt');
    const fl = JSON.parse((await get('/api/files?category=creator', P)).t); ok(fl.total >= 1, 'file video hiện trong Kho file (danh mục creator)');
    // giọng CIT
    const cp = cit.address().port;
    ok((await post('/api/cr/settings/save', { citUrl: 'http://evil.example.com' }, P)).s === 400, 'chặn địa chỉ CIT không phải localhost');
    await post('/api/cr/settings/save', { engine: 'cit', citUrl: 'http://127.0.0.1:' + cp, citVoice: 'Hải Đăng' }, P);
    const vl2 = (await get('/api/cr/voice/list', P)); const vj = JSON.parse(vl2.t); ok(vj.health.ok && vj.voices[0].id === 'thuy-dung', 'liệt kê giọng CIT');
    const vt = await post('/api/cr/voice/test', { text: 'thử' }, P); ok(vt.j.ok && vt.j.audio.startsWith('data:audio/mpeg;base64,') && citHits.length === 1 && citHits[0].voice_id === 'Hải Đăng', 'nghe thử giọng CIT');
    await post('/api/cr/video/render', { id, voice: true, captions: false }, P);
    for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 1000)); v = JSON.parse((await get('/api/cr/project?id=' + id, P)).t).project; if (v.video.status !== 'rendering') break; }
    ok(v.video.status === 'done' && v.video.voiceEngine === 'CIT' && citHits.length >= 3, 'dựng video dùng giọng CIT: ' + JSON.stringify(v.video).slice(0, 100));
    cit.close(); await post('/api/cr/video/render', { id, voice: true, captions: false }, P);
    for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 1000)); v = JSON.parse((await get('/api/cr/project?id=' + id, P)).t).project; if (v.video.status !== 'rendering') break; }
    ok(v.video.status === 'done' && v.video.voiceEngine !== 'CIT', 'CIT tắt thì video vẫn dựng được (dự phòng): ' + v.video.voiceEngine);
    // cài đặt + Socin
    ok((await post('/api/cr/settings/save', { socinBaseUrl: 'http://evil.example.com', socinToken: 'tok_1234567890abcdef' }, P)).j.ok, 'lưu cài đặt Socin');
    ok(!JSON.stringify(JSON.parse((await get('/api/cr/settings', P)).t)).includes('tok_1234'), 'token không bị trả về client');
    ok((await get('/api/cr/socin/accounts', P)).s === 400, 'chặn địa chỉ Socin http không phải localhost');
    await post('/api/cr/settings/save', { socinBaseUrl: 'http://127.0.0.1:' + fake.address().port }, P);
    ok(JSON.parse((await get('/api/cr/socin/accounts', P)).t).accounts[0].id === 'acc1', 'lấy tài khoản Socin bằng Bearer token');
    const pl = await post('/api/cr/schedule/plan', { id, startDate: new Date(Date.now() + 864e5).toISOString().slice(0, 10), hours: [19], gapMinutes: 10 }, P); ok(pl.j.project.schedule.length === 2, 'lên lịch 2 kênh');
    const items = pl.j.project.schedule; const t0 = new Date(items[0].runAt), t1 = new Date(items[1].runAt); ok(t1 - t0 === 10 * 60000, 'giãn cách 10 phút giữa kênh');
    const s1 = await post('/api/cr/schedule/send', { id, item: items[0].id }, P); ok(s1.j.ok && got.length === 1 && got[0].platform === 'tiktok' && got[0].account_id === 'acc1' && got[0].video_size > 5000, 'gửi sang Socin kèm metadata video');
    ok((await post('/api/cr/schedule/send', { id, item: items[0].id }, P)).s === 400, 'không gửi lặp mục đã gửi');
    const s2 = await post('/api/cr/schedule/send', { id, item: items[1].id }, P); ok(s2.j.ok && fs.existsSync(s2.j.project.schedule[1].result.exported + '/noi-dung.txt'), 'kênh "xuất gói" copy nội dung + video');
    const st = JSON.parse((await get('/api/cr/stats', P)).t); ok(st.videos === 1 && st.byStatus.sent === 2, 'thống kê');
    ok((await post('/api/cr/project/delete', { id, confirm: 'sai' }, P)).s === 400, 'xóa dự án cần gõ tên');
    ok((await get('/creator.html', P)).s === 200, 'trang creator.html');
  } catch (e) { fail++; console.log('LỖI', e); }
  srv.kill(); fake.close(); console.log(`\n${pass} đạt, ${fail} lỗi`); process.exit(fail ? 1 : 0);
});
