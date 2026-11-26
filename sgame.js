// S Game: kiểm tra máy có đủ công cụ làm game (Godot), dựng nhân vật 3D (Blender, Draw Things, Hunyuan3D/TripoSR)
// và làm video 3D chibi vinyl (ffmpeg, Whisper, CIT Voice Studio) không; thiếu thì bấm là cài (brew trên Mac, winget trên Windows).
// Bộ công cụ lấy theo dự án game cổ tích (Trăm Trứng Phiêu Lưu, Gióng, thu-3d, video 12 anh hùng).
// Thêm công cụ: thêm một mục vào danh sách trong hàm tools() bên dưới.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// ---- Danh sách công cụ ----
// detect.bins: tên lệnh trong PATH · detect.apps: app trên Mac (.app) · detect.files: đường dẫn cụ thể (có thể dùng * trong một đoạn)
// install.brew: { formula } hoặc { cask } · install.winget: id gói winget · install.steps: cài bằng lệnh riêng (môi trường Python)
// needs: công cụ phải có trước (tự cài trước nếu thiếu) · heavy: dung lượng lớn, chỉ cài khi bấm riêng · optional: chỉ cần cho một việc cụ thể
const GROUPS = [
  { id: 'base', icon: '🧰', name: 'Nền tảng', desc: 'Trình quản lý gói, git, Python, uv: các công cụ khác cần tới' },
  { id: 'engine', icon: '🎮', name: 'Làm game', desc: 'Engine Godot 4 và bộ xuất bản Android, iOS' },
  { id: 'char3d', icon: '🧸', name: 'Nhân vật 3D', desc: 'Vẽ ảnh gốc, dựng 3D từ ảnh 2D, chỉnh mô hình, gắn xương' },
  { id: 'video', icon: '🎬', name: 'Video 3D chibi vinyl', desc: 'Render, ghép hình, giọng đọc tiếng Việt, kiểm tra giọng' },
];

function tools(H, P) {
  const win = P === 'win32';
  const PF = process.env.ProgramFiles || 'C:\\Program Files';
  const LAD = process.env.LOCALAPPDATA || path.join(H, 'AppData', 'Local');
  return [
    { id: 'brew', group: 'base', name: 'Homebrew', only: 'darwin', desc: 'Trình cài gói cho Mac, S Game dùng để tự cài các công cụ khác.', detect: { bins: ['brew'] }, version: ['--version', /Homebrew ([\d.]+)/],
      manual: { darwin: { text: 'Mở Terminal, dán lệnh dưới rồi nhập mật khẩu Mac. Cài xong bấm Kiểm tra lại.', cmd: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"', url: 'https://brew.sh' } } },
    { id: 'winget', group: 'base', name: 'winget', only: 'win32', desc: 'Trình cài gói có sẵn trên Windows 10/11 (App Installer), S Game dùng để tự cài các công cụ khác.', detect: { bins: ['winget'] }, version: ['--version', /v?([\d.]+)/],
      manual: { win32: { text: 'Cài "App Installer" từ Microsoft Store rồi bấm Kiểm tra lại.', url: 'https://apps.microsoft.com/detail/9NBLGGH4NNS1' } } },
    { id: 'git', group: 'base', name: 'git', desc: 'Tải mã nguồn mô hình AI (Hunyuan3D, TripoSR) và repo game.', detect: { bins: ['git'] }, version: ['--version', /([\d.]+)/], install: { brew: { formula: 'git' }, winget: 'Git.Git' } },
    { id: 'python', group: 'base', name: 'Python 3.11', desc: 'Chạy các script dựng 3D, vẽ hoạ tiết, tạo âm thanh, ghép video.', detect: { bins: win ? ['python', 'py'] : ['python3.11', 'python3'] }, version: ['--version', /Python ([\d.]+)/], needVersion: true, install: { brew: { formula: 'python@3.11' }, winget: 'Python.Python.3.11' } },
    { id: 'uv', group: 'base', name: 'uv', desc: 'Tạo môi trường Python riêng cho từng bộ AI, cài thư viện nhanh.', detect: { bins: ['uv'], files: [path.join(H, '.local', 'bin', win ? 'uv.exe' : 'uv')] }, version: ['--version', /uv ([\d.]+)/], install: { brew: { formula: 'uv' }, winget: 'astral-sh.uv' } },

    { id: 'godot', group: 'engine', name: 'Godot 4', desc: 'Engine của Trăm Trứng Phiêu Lưu và Gióng: mở dự án, chạy thử, xuất bản.', detect: { bins: ['godot', 'godot4'], apps: ['Godot.app', 'Godot_mono.app'], files: win ? [path.join(LAD, 'Microsoft', 'WinGet', 'Packages', 'GodotEngine.GodotEngine*', 'Godot*.exe'), path.join(PF, 'Godot*', 'Godot*.exe')] : [] }, version: ['--version', /^([\d.]+[\w.]*)/], install: { brew: { cask: 'godot' }, winget: 'GodotEngine.GodotEngine' } },
    { id: 'godot-tpl', group: 'engine', name: 'Godot export templates', optional: true, desc: 'Bộ mẫu để Godot xuất file chạy Android, iOS, Windows, Mac.', detect: { dirs: [win ? path.join(process.env.APPDATA || path.join(H, 'AppData', 'Roaming'), 'Godot', 'export_templates') : path.join(H, 'Library', 'Application Support', 'Godot', 'export_templates')] },
      manual: { all: { text: 'Mở Godot → menu Editor → Manage Export Templates → Download and Install (khoảng 1 GB, đúng bản Godot đang dùng).' } } },
    { id: 'jdk', group: 'engine', name: 'Java JDK 17', optional: true, desc: 'Cần để Godot xuất bản Android (.apk, .aab).', detect: { bins: ['javac'], files: win ? [path.join(PF, 'Eclipse Adoptium', 'jdk-17*', 'bin', 'javac.exe')] : ['/opt/homebrew/opt/openjdk@17/bin/javac', '/usr/local/opt/openjdk@17/bin/javac'] }, version: ['-version', /javac ([\d.]+)/], install: { brew: { formula: 'openjdk@17' }, winget: 'EclipseAdoptium.Temurin.17.JDK' } },
    { id: 'android', group: 'engine', name: 'Android SDK', optional: true, heavy: '~3 GB', desc: 'Công cụ build Android cho Godot. Sau khi cài, khai báo đường dẫn SDK trong Godot → Editor Settings → Export → Android.',
      detect: { env: ['ANDROID_HOME', 'ANDROID_SDK_ROOT'], dirs: win ? [path.join(LAD, 'Android', 'Sdk')] : [path.join(H, 'Library', 'Android', 'sdk'), '/opt/homebrew/share/android-commandlinetools', '/usr/local/share/android-commandlinetools'] },
      install: { brew: { cask: 'android-commandlinetools' }, winget: 'Google.AndroidStudio' } },
    { id: 'xcode', group: 'engine', name: 'Xcode', only: 'darwin', optional: true, heavy: '~12 GB', desc: 'Cần để Godot xuất bản iOS và ký app.', detect: { apps: ['Xcode.app'] },
      manual: { darwin: { text: 'Cài Xcode từ App Store (miễn phí), mở một lần để đồng ý điều khoản.', url: 'macappstore://apps.apple.com/app/id497799835' } } },

    { id: 'blender', group: 'char3d', name: 'Blender', desc: 'Chỉnh mô hình 3D, gắn xương, bake texture, render tướng (Workbench) cho video.', detect: { bins: ['blender'], apps: ['Blender.app'], files: win ? [path.join(PF, 'Blender Foundation', 'Blender*', 'blender.exe')] : [] }, version: ['--version', /Blender ([\d.]+)/], install: { brew: { cask: 'blender' }, winget: 'BlenderFoundation.Blender' } },
    { id: 'drawthings', group: 'char3d', name: 'Draw Things', only: 'darwin', desc: 'Vẽ ảnh nhân vật 2D, nền, hoạ tiết bằng AI ngay trên Mac (offline).', detect: { apps: ['Draw Things.app'] }, install: { brew: { cask: 'draw-things' } } },
    { id: 'comfyui', group: 'char3d', name: 'ComfyUI', only: 'win32', desc: 'Vẽ ảnh nhân vật 2D, nền bằng AI trên Windows (thay cho Draw Things).', detect: { files: [path.join(LAD, 'Programs', '@comfyorgcomfyui-electron', 'ComfyUI.exe'), path.join(LAD, 'Programs', 'ComfyUI', 'ComfyUI.exe')] },
      manual: { win32: { text: 'Tải ComfyUI Desktop cho Windows rồi cài như app thường.', url: 'https://www.comfy.org/download' } } },
    { id: 'pyenv', group: 'char3d', name: 'Thư viện Python 3D và video', needs: ['uv'], desc: 'Môi trường S Game: trimesh, pyrender, scikit-image, Pillow, faster-whisper. Dùng cho xem trước mô hình, ghép video, kiểm tra giọng.', detect: { venv: 'py', imports: ['trimesh', 'pyrender', 'skimage', 'PIL', 'faster_whisper'] }, install: { steps: 'py' } },
    { id: 'ai3d', group: 'char3d', name: 'AI dựng 3D từ ảnh (Hunyuan3D-2mini, TripoSR)', needs: ['uv', 'git'], heavy: '~5 GB, model tải thêm ở lần chạy đầu', desc: 'Ảnh PNG nền trong suốt → mô hình GLB. Chạy GPU Apple (MPS) trên Mac M1 trở lên, card NVIDIA trên Windows.', detect: { venv: 'ai3d', repos: ['Hunyuan3D-2', 'TripoSR'] }, install: { steps: 'ai3d' } },

    { id: 'ffmpeg', group: 'video', name: 'ffmpeg', desc: 'Ghép khung hình, nhạc, giọng thành video; tạo âm thanh hiệu ứng cho game.', detect: { bins: ['ffmpeg'], files: win ? [path.join(LAD, 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg*', 'ffmpeg-*', 'bin', 'ffmpeg.exe')] : [] }, version: ['-version', /ffmpeg version ([^\s]+)/], install: { brew: { formula: 'ffmpeg' }, winget: 'Gyan.FFmpeg' } },
    { id: 'voice', group: 'video', name: 'CIT Voice Studio', desc: 'Giọng đọc tiếng Việt cho video (giọng Trúc Ly của Con Lạc). Kiểm tra bằng cách gọi http://127.0.0.1:8001.', detect: { http: 'http://127.0.0.1:8001/openapi.json', apps: ['CIT Voice Studio.app'] },
      manual: { all: { text: 'Tải bản cài trong repo cit-voice-studio, mở app lên là S Game thấy.', url: 'https://github.com/samuelmastercheef/cit-voice-studio#download' } } },
  ];
}

module.exports = function init({ WS, cfg = {}, json, body }) {
  const P = process.env.SHUB_SGAME_PLATFORM || process.platform;
  const win = P === 'win32';
  const H = process.env.SHUB_HOME || os.homedir();
  const sc = cfg.sgame || {};
  const ROOT = (sc.dir || '').replace(/^~(?=$|[\/\\])/, H) || path.join(H, 'SGame');
  // Môi trường Python: mặc định ~/SGame/<tên>; nếu đã dựng sẵn ở thư mục dự án game cổ tích thì nhận luôn
  const VENVS = {
    py: [path.join(ROOT, 'py'), path.join(H, 'Downloads', 'ClaudeCode', 'thu-3d')],
    ai3d: [path.join(ROOT, 'ai3d'), path.join(H, 'Downloads', 'ClaudeCode', 'thu-3d', 'hunyuan')],
  };
  const APPDIRS = process.env.SHUB_APPS_DIR ? [process.env.SHUB_APPS_DIR] : ['/Applications', path.join(H, 'Applications')];
  const EXTRA_APPS = (sc.apps || [path.join(H, 'Downloads', 'ClaudeCode', 'cong-cu')]).map((d) => d.replace(/^~(?=$|[\/\\])/, H));
  const SEP = win ? ';' : ':';
  const EXTRA_BIN = win ? [path.join(process.env.LOCALAPPDATA || path.join(H, 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Links'), path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps')]
    : ['/opt/homebrew/bin', '/usr/local/bin', path.join(H, '.local', 'bin'), '/opt/homebrew/opt/openjdk@17/bin'];
  const pathDirs = () => [...(process.env.SHUB_SGAME_PATH || process.env.PATH || '').split(SEP), ...(process.env.SHUB_SGAME_PATH ? [] : EXTRA_BIN)].filter(Boolean);
  const exts = win ? ['.exe', '.cmd', '.bat', ''] : [''];
  const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
  const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  const which = (bin) => { for (const d of pathDirs()) for (const e of exts) { const p = path.join(d, bin + e); if (isFile(p)) return p; } return ''; };
  // glob đơn giản: * trong từng đoạn đường dẫn
  const glob = (pat) => {
    const parts = pat.split(/[\/\\]/); let cur = [parts[0] === '' ? path.sep : parts[0] + (win && /:$/.test(parts[0]) ? '\\' : '')];
    for (const seg of parts.slice(1)) {
      if (!seg) continue; const next = [];
      for (const c of cur) {
        if (!seg.includes('*')) { next.push(path.join(c, seg)); continue; }
        const re = new RegExp('^' + seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
        try { for (const n of fs.readdirSync(c).sort().reverse()) if (re.test(n)) next.push(path.join(c, n)); } catch {}
      }
      cur = next;
    }
    return cur.filter((p) => fs.existsSync(p));
  };
  const runOut = (bin, args, ms = 6000) => new Promise((resolve) => {
    let out = ''; let p;
    try { p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); } catch { return resolve(''); }
    const t = setTimeout(() => { try { p.kill(); } catch {} }, ms);
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
    p.on('error', () => { clearTimeout(t); resolve(''); }); p.on('close', () => { clearTimeout(t); resolve(out); });
  });
  const plistVer = (app) => { try { const s = fs.readFileSync(path.join(app, 'Contents', 'Info.plist'), 'utf8'); const m = s.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/); return m ? m[1] : ''; } catch { return ''; } };
  const venvPy = (dir) => path.join(dir, '.venv', win ? 'Scripts' : 'bin', win ? 'python.exe' : 'python');

  const LIST = tools(H, P);
  const byId = (id) => LIST.find((t) => t.id === id);
  const forMe = (t) => !t.only || t.only === P;

  async function check(t) {
    const d = t.detect || {}; let where = '', version = '', note = '';
    for (const b of d.bins || []) { where = which(b); if (where) break; }
    if (!where && !win) for (const a of d.apps || []) { const hit = [...APPDIRS, ...EXTRA_APPS].map((x) => path.join(x, a)).find(isDir); if (hit) { where = hit; version = plistVer(hit); if (!hit.startsWith('/Applications')) note = 'bản nằm ở ' + path.dirname(hit).replace(H, '~'); break; } }
    if (!where) for (const f of d.files || []) { const hit = glob(f)[0]; if (hit) { where = hit; break; } }
    if (!where) for (const e of d.env || []) if (process.env[e] && isDir(process.env[e])) { where = process.env[e]; break; }
    if (!where) for (const x of d.dirs || []) if (isDir(x) && (t.id !== 'godot-tpl' || fs.readdirSync(x).length)) { where = x; if (t.id === 'godot-tpl') version = fs.readdirSync(x).sort().pop(); break; }
    if (!where && d.venv) {
      for (const dir of VENVS[d.venv]) {
        const py = venvPy(dir); if (!isFile(py)) continue;
        if (d.repos && !d.repos.some((r) => isDir(path.join(dir, r)) || isDir(path.join(dir, 'src')))) continue;
        if (d.imports) { const o = await runOut(py, ['-c', `import ${d.imports.join(',')};print('SG_OK')`], 30000); if (!o.includes('SG_OK')) { note = 'thiếu thư viện: ' + ((o.match(/No module named '([^']+)'/) || [])[1] || 'không rõ'); continue; } }
        where = dir; note = dir.startsWith(ROOT) ? '' : 'dùng môi trường có sẵn ở ' + dir.replace(H, '~'); break;
      }
    }
    if (!where && d.http) { try { const r = await fetch(d.http, { signal: AbortSignal.timeout(1500) }); if (r.ok) { where = d.http.replace(/\/[^/]*$/, ''); note = 'đang chạy'; } } catch {} }
    if (!where && d.http && !win) for (const a of d.apps || []) { const hit = APPDIRS.map((x) => path.join(x, a)).find(isDir); if (hit) { where = hit; note = 'đã cài, chưa mở'; break; } }
    if (where && !version && t.version && isFile(where)) { const o = await runOut(where, [t.version[0]]); const m = o.trim().match(t.version[1]); if (m) version = m[1]; }
    if (where && !version && t.version && /\.app$/.test(where)) { const exe = path.join(where, 'Contents', 'MacOS', path.basename(where, '.app').replace(/_mono$/, '')); if (isFile(exe)) { const o = await runOut(exe, [t.version[0]]); const m = o.trim().match(t.version[1]); if (m) version = m[1]; } }
    if (where && t.needVersion && !version) { note = 'lệnh ' + path.basename(where) + ' không chạy được (có thể là lối tắt Microsoft Store)'; where = ''; }
    if (t.id === 'python' && version && /^3\.(\d)\./.test(version + '.') && Number(version.split('.')[1]) < 10) note = 'bản cũ, các môi trường AI vẫn dùng Python 3.11 riêng qua uv';
    const m = t.manual && (t.manual[P] || t.manual.all);
    const auto = !!(t.install && (t.install.steps || (win ? t.install.winget : t.install.brew)));
    return { id: t.id, group: t.group, name: t.name, desc: t.desc, ok: !!where, where: where.replace(H, '~'), version, note, optional: !!t.optional, heavy: t.heavy || '', needs: t.needs || [], auto, manual: m || null };
  }

  let cache = null;
  async function status(fresh) {
    if (!fresh && cache && Date.now() - cache.at < 60000) return cache.data;
    const list = await Promise.all(LIST.filter(forMe).map(check));
    const need = list.filter((t) => !t.optional);
    const data = { platform: P, supported: P === 'darwin' || P === 'win32', pm: win ? 'winget' : 'brew', root: ROOT.replace(H, '~'), groups: GROUPS, tools: list,
      summary: { total: need.length, ok: need.filter((t) => t.ok).length, missing: need.filter((t) => !t.ok).map((t) => t.name), optionalMissing: list.filter((t) => t.optional && !t.ok).length } };
    cache = { at: Date.now(), data };
    return data;
  }

  // ---- Cài đặt (một việc một lúc, có nhật ký) ----
  let job = null; const LOG = [];
  const log = (s) => { for (const l of String(s).split(/\r?\n/).filter((x) => x.trim())) { LOG.push({ t: Date.now(), s: l.slice(0, 1000) }); if (LOG.length > 500) LOG.shift(); } };
  const bad = (m, s = 400) => { const e = new Error(m); e.status = s; throw e; };
  const exec = (bin, args, env = {}) => new Promise((resolve) => {
    log('$ ' + [path.basename(bin), ...args].join(' '));
    let p; try { p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env }, windowsHide: true }); } catch (e) { log(e.message); return resolve(1); }
    p.stdout.on('data', log); p.stderr.on('data', log); p.on('error', (e) => { log(e.message); resolve(1); }); p.on('close', (c) => resolve(c ?? 1));
  });
  const brewBin = () => process.env.SHUB_BREW_BIN || which('brew');
  const wingetBin = () => process.env.SHUB_WINGET_BIN || which('winget');
  const uvBin = () => process.env.SHUB_UV_BIN || which('uv') || (isFile(path.join(H, '.local', 'bin', win ? 'uv.exe' : 'uv')) ? path.join(H, '.local', 'bin', win ? 'uv.exe' : 'uv') : '');
  const gitBin = () => process.env.SHUB_GIT_BIN || which('git');
  const PY_PKGS = ['trimesh', 'pyrender', 'scikit-image', 'pillow', 'numpy', 'faster-whisper'];
  const AI3D_PKGS = ['torch', 'torchvision', 'transformers==4.57.*', 'diffusers==0.35.*', 'huggingface_hub', 'accelerate', 'einops', 'omegaconf', 'opencv-python', 'tqdm', 'trimesh', 'scikit-image', 'pygltflib', 'rembg', 'onnxruntime', 'imageio', 'pyrender'];
  const REPOS = { 'Hunyuan3D-2': 'https://github.com/Tencent-Hunyuan/Hunyuan3D-2', TripoSR: 'https://github.com/VAST-AI-Research/TripoSR' };

  async function installOne(t) {
    const i = t.install || {};
    if (i.steps) {
      const uv = uvBin(); if (!uv) bad('Cần uv trước.');
      const dir = path.join(ROOT, i.steps); fs.mkdirSync(dir, { recursive: true });
      if (i.steps === 'ai3d') for (const [n, url] of Object.entries(REPOS)) if (!isDir(path.join(dir, n))) { if (await exec(gitBin(), ['clone', '--depth', '1', url, path.join(dir, n)])) bad('Tải mã nguồn ' + n + ' lỗi.'); }
      if (!isFile(venvPy(dir)) && await exec(uv, ['venv', '--python', '3.11', path.join(dir, '.venv')])) bad('Tạo môi trường Python lỗi.');
      if (await exec(uv, ['pip', 'install', '--python', venvPy(dir), ...(i.steps === 'ai3d' ? AI3D_PKGS : PY_PKGS)])) bad('Cài thư viện Python lỗi, xem nhật ký.');
      return;
    }
    if (win) {
      const wg = wingetBin(); if (!wg) bad('Chưa có winget: cài "App Installer" từ Microsoft Store.');
      if (!i.winget) bad(t.name + ' chưa có gói winget, cài theo hướng dẫn.');
      const c = await exec(wg, ['install', '--id', i.winget, '-e', '--silent', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity']);
      if (c && c !== -1978335189 && c !== 2316632107) bad('Cài ' + t.name + ' lỗi (mã ' + c + '), xem nhật ký.'); // -1978335189: đã cài, không có bản mới
      return;
    }
    const br = brewBin(); if (!br) bad('Chưa có Homebrew: cài ở mục Nền tảng trước.');
    if (!i.brew) bad(t.name + ' chưa có gói Homebrew, cài theo hướng dẫn.');
    const args = i.brew.cask ? ['install', '--cask', i.brew.cask] : ['install', i.brew.formula];
    if (await exec(br, args, { HOMEBREW_NO_AUTO_UPDATE: '1', NONINTERACTIVE: '1', HOMEBREW_NO_ENV_HINTS: '1' })) bad('Cài ' + t.name + ' lỗi, xem nhật ký.');
  }

  async function runJob(ids) {
    const st = await status(true); const have = new Set(st.tools.filter((t) => t.ok).map((t) => t.id));
    // Thêm công cụ phụ thuộc còn thiếu lên trước
    const order = []; const add = (id) => { const t = byId(id); if (!t || !forMe(t) || have.has(id) || order.includes(id)) return; (t.needs || []).forEach(add); order.push(id); };
    ids.forEach(add);
    job.order = order; job.done = []; job.failed = [];
    if (!order.length) { log('Không có gì cần cài.'); return; }
    for (const id of order) {
      const t = byId(id); job.current = id; log('— Cài ' + t.name + ' —');
      try { await installOne(t); job.done.push(id); log('✓ Xong ' + t.name); }
      catch (e) { job.failed.push({ id, error: e.message }); log('✕ ' + t.name + ': ' + e.message); if (order.some((x) => (byId(x).needs || []).includes(id))) { log('Dừng vì công cụ sau cần ' + t.name + '.'); break; } }
    }
    job.current = null; cache = null;
  }

  // Kiểm tra lúc mở S Hub, in ra cửa sổ dòng lệnh
  if (!process.env.SHUB_NO_SGAME_BOOT) setTimeout(() => status(true).then((s) => {
    console.log(s.summary.missing.length ? `S Game: thiếu ${s.summary.missing.length} công cụ làm game (${s.summary.missing.join(', ')}). Mở S Hub → Game & 3D → S Game để cài.` : `S Game: đủ ${s.summary.total} công cụ làm game.`);
  }).catch(() => {}), 300);

  return async function handle(req, res, u) {
    if (!u.pathname.startsWith('/api/sgame/')) return false;
    const r = u.pathname.slice(11), post = req.method === 'POST';
    try {
      if (r === 'status') { const s = await status(u.searchParams.get('fresh') === '1'); return json(res, 200, { ...s, job: job && { running: job.running, order: job.order || [], done: job.done || [], failed: job.failed || [], current: job.current || null, error: job.error || '' } }), true; }
      if (r === 'logs') return json(res, 200, { lines: LOG }), true;
      if (r === 'install' && post) {
        if (job && job.running) bad('Đang cài, chờ xong.', 409);
        const b = await body(req); let ids = Array.isArray(b.ids) ? b.ids.filter((x) => typeof x === 'string') : [];
        if (b.all) { const s = await status(true); ids = s.tools.filter((t) => !t.ok && t.auto && !t.optional && !t.heavy).map((t) => t.id); }
        const unknown = ids.filter((id) => !byId(id) || !forMe(byId(id))); if (unknown.length) bad('Không rõ công cụ: ' + unknown.join(', '));
        const noAuto = ids.filter((id) => { const t = byId(id); return !(t.install && (t.install.steps || (win ? t.install.winget : t.install.brew))); });
        if (noAuto.length) bad(noAuto.map((id) => byId(id).name).join(', ') + ' cần cài tay, xem hướng dẫn.');
        job = { running: true, ids }; LOG.length = 0;
        (async () => { try { await runJob(ids); } catch (e) { job.error = e.message; log('Lỗi: ' + e.message); } finally { job.running = false; cache = null; } })();
        return json(res, 200, { ok: true }), true;
      }
      return json(res, 404, { error: 'not found' }), true;
    } catch (e) { return json(res, e.status || 500, { ok: false, error: e.message || String(e) }), true; }
  };
};
