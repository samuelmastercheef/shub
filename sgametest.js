// Test S Game: giả lập Mac (brew) và Windows (winget) bằng lệnh giả, thư mục Applications giả. Không cần mạng, không cài thật.
const { spawn } = require('child_process'); const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL', m)); if (c) console.log('ok  ', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (p, body) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, '#!/bin/bash\n' + body + '\n', { mode: 0o755 }); };
const req = (P, p, o) => new Promise((res) => { const rq = http.request({ host: '127.0.0.1', port: P, path: p, method: o ? 'POST' : 'GET', headers: o ? { Origin: 'http://127.0.0.1:' + P } : {} }, (r) => { let d = ''; r.on('data', (x) => (d += x)); r.on('end', () => res({ s: r.statusCode, t: d, j: (() => { try { return JSON.parse(d || '{}'); } catch { return {}; } })() })); }); rq.end(o ? JSON.stringify(o) : undefined); });
const tool = (st, id) => st.tools.find((t) => t.id === id) || {};

async function boot(P, T, platform, env) {
  fs.writeFileSync(path.join(T, 'c.json'), JSON.stringify({ port: P, workspace: path.join(T, 'ws') }));
  const srv = spawn('node', ['server.js'], { cwd: __dirname, env: { ...process.env, SHUB_CONFIG: path.join(T, 'c.json'), SHUB_NO_TIMER: '1', SHUB_HOME: path.join(T, 'home'), SHUB_SGAME_PLATFORM: platform, SHUB_SGAME_PATH: path.join(T, 'bin'), GITHUB_TOKEN: '', ...env }, stdio: ['ignore', 'pipe', 'ignore'] });
  let out = ''; srv.stdout.on('data', (d) => (out += d));
  await sleep(1200);
  return { srv, out: () => out };
}
async function waitJob(P) { let st; for (let i = 0; i < 80 && (st = (await req(P, '/api/sgame/status')).j).job && st.job.running; i++) await sleep(100); return (await req(P, '/api/sgame/status?fresh=1')).j; }

async function mac() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sgm-')); const B = path.join(T, 'bin'); const APPS = path.join(T, 'Applications'); const LOG = path.join(T, 'brew.log');
  fs.mkdirSync(path.join(T, 'home'), { recursive: true }); fs.mkdirSync(APPS);
  sh(path.join(B, 'git'), 'echo "git version 2.47.1"');
  sh(path.join(B, 'ffmpeg'), 'echo "ffmpeg version 7.1 Copyright"');
  sh(path.join(B, 'brew'), `echo "$@" >> ${LOG}
if [ "$1" = "--version" ]; then echo "Homebrew 4.4.0"; exit 0; fi
case "$3" in godot) mkdir -p ${APPS}/Godot.app/Contents; printf '<key>CFBundleShortVersionString</key>\\n<string>4.7.2</string>' > ${APPS}/Godot.app/Contents/Info.plist;; blender) mkdir -p ${APPS}/Blender.app;; draw-things) mkdir -p ${APPS}/"Draw Things.app";; esac
case "$2" in uv) printf '#!/bin/bash\\necho "$@" >> ${LOG}.uv\\nif [ "$1" = "--version" ]; then echo "uv 0.9.0"; exit 0; fi\\nif [ "$1" = "venv" ]; then mkdir -p "$4/bin"; printf "#!/bin/bash\\\\necho SG_OK\\\\n" > "$4/bin/python"; chmod +x "$4/bin/python"; fi\\n' > ${B}/uv; chmod +x ${B}/uv;; python@3.11) printf '#!/bin/bash\\necho "Python 3.11.11"\\n' > ${B}/python3.11; chmod +x ${B}/python3.11;; esac
echo "installed"`);
  const P = 4797; const { srv, out } = await boot(P, T, 'darwin', { SHUB_APPS_DIR: APPS });
  try {
    ok((await req(P, '/api/apps')).j.apps.some((a) => a.id === 'sgame' && a.type === 'internal'), 'Mac: S Game có trong danh sách công cụ');
    ok((await req(P, '/sgame.html')).s === 200, 'Mac: trang sgame.html mở được');
    ok(/S Game: thiếu \d+ công cụ/.test(out()), 'Mac: mở S Hub là tự kiểm tra, in số công cụ thiếu');
    let st = (await req(P, '/api/sgame/status')).j;
    ok(st.platform === 'darwin' && st.pm === 'brew' && st.supported, 'Mac: dùng Homebrew');
    ok(tool(st, 'git').ok && tool(st, 'git').version === '2.47.1' && tool(st, 'ffmpeg').version === '7.1', 'Mac: nhận git, ffmpeg có sẵn kèm phiên bản');
    ok(tool(st, 'brew').ok && !tool(st, 'godot').ok && !tool(st, 'blender').ok, 'Mac: báo thiếu Godot, Blender');
    ok(!st.tools.some((t) => t.id === 'winget' || t.id === 'comfyui') && tool(st, 'drawthings').auto, 'Mac: không hiện công cụ riêng của Windows, có Draw Things');
    ok(st.summary.missing.includes('Godot 4') && !st.summary.missing.includes('Xcode'), 'Mac: mục tuỳ chọn (Xcode) không tính là thiếu');
    ok((await req(P, '/api/sgame/install', { ids: ['xcode'] })).s === 400, 'Mac: Xcode cài tay → báo xem hướng dẫn');
    ok((await req(P, '/api/sgame/install', { ids: ['rm -rf /'] })).s === 400, 'Mac: id lạ bị chặn');
    ok((await req(P, '/api/sgame/install', { all: true })).s === 200, 'Mac: bấm Cài tất cả còn thiếu');
    st = await waitJob(P);
    const bl = fs.readFileSync(LOG, 'utf8');
    ok(/install --cask godot/.test(bl) && /install --cask blender/.test(bl) && /install --cask draw-things/.test(bl) && /install python@3.11/.test(bl), 'Mac: cài Godot, Blender, Draw Things, Python bằng brew');
    ok(!/android-commandlinetools|openjdk/.test(bl) && !fs.existsSync(path.join(T, 'home', 'SGame', 'ai3d')), 'Mac: Cài tất cả bỏ qua mục tuỳ chọn và AI 3D nặng');
    ok(bl.indexOf('install uv') >= 0 && bl.indexOf('install uv') < bl.length && st.job.order.indexOf('uv') < st.job.order.indexOf('pyenv'), 'Mac: tự cài uv trước môi trường Python');
    ok(/pip install --python .*faster-whisper/.test(fs.readFileSync(LOG + '.uv', 'utf8')), 'Mac: môi trường Python cài trimesh, pyrender, faster-whisper');
    ok(tool(st, 'godot').ok && tool(st, 'godot').version === '4.7.2' && tool(st, 'pyenv').ok && tool(st, 'blender').ok, 'Mac: kiểm tra lại thấy đủ, đọc được bản Godot');
    ok(JSON.stringify(st.summary.missing) === JSON.stringify(['AI dựng 3D từ ảnh (Hunyuan3D-2mini, TripoSR)', 'CIT Voice Studio']), 'Mac: chỉ còn AI 3D (nặng, bấm riêng) và CIT Voice Studio (cài tay): ' + st.summary.missing.join(', '));
    ok((await req(P, '/api/sgame/logs')).j.lines.some((l) => /✓ Xong Godot 4/.test(l.s)), 'Mac: nhật ký cài có từng bước');
  } catch (e) { fail++; console.log('FAIL', e); }
  srv.kill(); fs.rmSync(T, { recursive: true, force: true });
}

async function windows() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sgw-')); const B = path.join(T, 'bin'); const LOG = path.join(T, 'winget.log');
  fs.mkdirSync(path.join(T, 'home'), { recursive: true });
  sh(path.join(B, 'winget.exe'), `echo "$@" >> ${LOG}
if [ "$1" = "--version" ]; then echo "v1.9.25200"; exit 0; fi
case "$3" in GodotEngine.GodotEngine) printf '#!/bin/bash\\necho 4.7.2.stable\\n' > ${B}/godot.exe; chmod +x ${B}/godot.exe;; Gyan.FFmpeg) exit 1;; esac
echo "Successfully installed"`);
  sh(path.join(B, 'python.exe'), 'exit 9009'); // lối tắt Microsoft Store: không chạy được
  const P = 4798; const { srv } = await boot(P, T, 'win32', {});
  try {
    let st = (await req(P, '/api/sgame/status')).j;
    ok(st.platform === 'win32' && st.pm === 'winget' && tool(st, 'winget').ok, 'Windows: dùng winget');
    ok(!st.tools.some((t) => t.id === 'brew' || t.id === 'drawthings' || t.id === 'xcode') && tool(st, 'comfyui').manual, 'Windows: không hiện công cụ riêng của Mac, có ComfyUI thay Draw Things');
    ok(!tool(st, 'python').ok && /Microsoft Store/.test(tool(st, 'python').note), 'Windows: lối tắt python của Store không tính là đã có');
    ok((await req(P, '/api/sgame/install', { ids: ['godot', 'ffmpeg'] })).s === 200, 'Windows: bấm cài Godot và ffmpeg');
    st = await waitJob(P);
    const wl = fs.readFileSync(LOG, 'utf8');
    ok(/install --id GodotEngine.GodotEngine -e --silent --accept-source-agreements --accept-package-agreements/.test(wl), 'Windows: cài Godot bằng winget, không hỏi');
    ok(tool(st, 'godot').ok && tool(st, 'godot').version === '4.7.2.stable', 'Windows: kiểm tra lại thấy Godot');
    ok(st.job.failed.length === 1 && st.job.failed[0].id === 'ffmpeg' && !tool(st, 'ffmpeg').ok, 'Windows: cài lỗi được báo riêng, không dừng cả lượt');
    ok((await req(P, '/api/sgame/install', { ids: ['brew'] })).s === 400, 'Windows: không cho cài công cụ chỉ dành cho Mac');
  } catch (e) { fail++; console.log('FAIL', e); }
  srv.kill(); fs.rmSync(T, { recursive: true, force: true });
}

(async () => { await mac(); await windows(); console.log(`\n${pass} đạt, ${fail} lỗi`); process.exit(fail ? 1 : 0); })();
