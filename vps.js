// S VPS - quản lý VPS qua SSH: deploy từ GitHub, tự cập nhật, dọn rác tự động.
// Chạy hoàn toàn bằng ssh có sẵn trên máy; không lưu private key, chỉ lưu đường dẫn tới key.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { shQ, exportsOf, PRE } = require('./vps-common');
const extInit = require('./vps-ext');

module.exports = function init({ WS, json, body }) {
  const FILE = path.join(WS, 'vps.json');
  const SSH_BIN = process.env.SHUB_SSH_BIN || 'ssh';
  const expand = (p) => String(p).replace(/^~(?=$|\/)/, os.homedir());
  const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { servers: [] }; } };
  const save = (d) => fs.writeFileSync(FILE, JSON.stringify(d, null, 2), { mode: 0o600 });

  // ---------- Kiểm tra đầu vào ----------
  const V = {
    id: /^[a-z0-9][a-z0-9_-]{0,40}$/i,
    host: /^[A-Za-z0-9._:-]{1,255}$/,
    user: /^[a-z_][a-z0-9_-]{0,31}$/i,
    key: /^[\w ~\/.\-]{0,300}$/,
    repo: /^(git@[\w.-]+:|https:\/\/[\w.-]+\/)[\w.\-\/]+$/,
    branch: /^[\w.\/-]{1,100}$/,
    dir: /^(~\/|\/)[\w.\/-]{1,200}$/,
  };
  const bad = (m) => { const e = new Error(m); e.status = 400; throw e; };
  const need = (re, v, label) => { if (!re.test(String(v ?? ''))) bad('Giá trị không hợp lệ: ' + label); return String(v); };
  function cleanServer(b, old) {
    const s = {
      id: old ? old.id : need(V.id, b.id || (b.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), 'id'),
      name: String(b.name || b.host).slice(0, 60),
      host: need(V.host, b.host, 'host'),
      port: Number(b.port || 22),
      user: need(V.user, b.user || 'root', 'user'),
      keyPath: need(V.key, b.keyPath || '', 'đường dẫn key'),
      tgToken: String(b.tgToken || '').replace(/[^\w:-]/g, ''),
      tgChat: String(b.tgChat || '').replace(/[^\w-]/g, ''),
      projects: old ? old.projects : [],
      cleanup: old ? old.cleanup : { enabled: false, keepDays: 7, hour: 3 },
    };
    if (!(s.port > 0 && s.port < 65536)) bad('Cổng SSH không hợp lệ');
    return s;
  }
  function cleanProject(b, old) {
    const p = {
      id: old ? old.id : need(V.id, b.id || (b.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), 'id dự án'),
      name: need(V.id, b.name || b.id, 'tên dự án (chữ, số, gạch)'),
      repo: need(V.repo, b.repo, 'URL repo'),
      branch: need(V.branch, b.branch || 'main', 'nhánh'),
      dir: need(V.dir, b.dir || `~/apps/${b.name}`, 'thư mục'),
      pm: ['pm2', 'systemd', 'docker', 'none'].includes(b.pm) ? b.pm : 'pm2',
      installCmd: String(b.installCmd || '').slice(0, 500),
      buildCmd: String(b.buildCmd || '').slice(0, 500),
      startCmd: String(b.startCmd || '').slice(0, 500),
      auto: old ? !!old.auto : false,
      intervalMin: Math.min(60, Math.max(1, Number(b.intervalMin || (old && old.intervalMin) || 5))),
    };
    if (p.pm === 'pm2' && !p.startCmd) bad('PM2 cần lệnh khởi động (vd: npm start)');
    return p;
  }

  // ---------- SSH ----------
  function sshArgs(s, remote = 'bash -s') {
    const a = ['-p', String(s.port), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=12', '-o', 'ServerAliveInterval=15'];
    if (s.keyPath) a.push('-i', expand(s.keyPath), '-o', 'IdentitiesOnly=yes');
    a.push(`${s.user}@${s.host}`, remote);
    return a;
  }
  function ssh(s, script, emit = () => {}, timeoutMs = 900000) {
    return new Promise((resolve) => {
      const p = spawn(SSH_BIN, sshArgs(s), { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      const feed = (d) => { const t = d.toString(); out += t; emit(t); };
      p.stdout.on('data', feed); p.stderr.on('data', feed);
      const t = setTimeout(() => { emit('\n[S VPS] Quá thời gian, ngắt kết nối\n'); p.kill('SIGKILL'); }, timeoutMs);
      p.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? 1, out }); });
      p.on('error', (e) => { clearTimeout(t); resolve({ code: 1, out: out + String(e.message) }); });
      p.stdin.on('error', () => {});
      p.stdin.end(script);
    });
  }

  // ---------- Script chạy trên VPS ----------

  const STATUS = PRE + `
echo "HOST=$(hostname)"
echo "OS=$( (. /etc/os-release 2>/dev/null; echo "$PRETTY_NAME") )"
echo "UPTIME=$(uptime -p 2>/dev/null)"
echo "LOAD=$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)"
echo "CPUS=$(nproc 2>/dev/null)"
free -m 2>/dev/null | awk '/Mem:/{print "MEM_USED="$3; print "MEM_TOTAL="$2}'
df -P / 2>/dev/null | awk 'NR==2{gsub("%","",$5); print "DISK_PCT="$5; print "DISK_USED="$3; print "DISK_TOTAL="$2}'
command -v pm2 >/dev/null 2>&1 && echo "PM2=$(pm2 jlist 2>/dev/null | grep -o '"status":"[a-z]*"' | sort | uniq -c | tr '\\n' ' ')"
command -v docker >/dev/null 2>&1 && echo "DOCKER=$(docker ps -q 2>/dev/null | wc -l) container"
echo "CRON=$(crontab -l 2>/dev/null | grep -c '# shub')"
for spec in $PROJECTS; do id="\${spec%%=*}"; d="\${spec#*=}"; d="\${d/#\\~/$HOME}"
  if [ -d "$d/.git" ]; then echo "PROJ_$id=$(git -C "$d" log -1 --pretty='%h|%s|%cr' 2>/dev/null)"; else echo "PROJ_$id=none"; fi
done
`;

  function deployScript(s, p, { force, rollback } = {}) {
    const env = {
      NAME: p.name, REPO: p.repo, BRANCH: p.branch, PM: p.pm,
      INSTALL: p.installCmd, BUILD: p.buildCmd, START: p.startCmd,
      FORCE: force ? '1' : '0', ROLLBACK: rollback ? '1' : '0',
      TG_TOKEN: s.tgToken, TG_CHAT: s.tgChat, SRV: s.name,
    };
    // DIR đã được kiểm tra chỉ gồm ký tự an toàn; ~ đổi thành $HOME để mở rộng trên VPS
    const head = exportsOf(env) + `export DIR="${p.dir.replace(/^~/, '$HOME')}"\nexport KEY="$HOME/.shub/keys/${p.id}"\n`;
    return head + PRE + `
set -o pipefail
mkdir -p "$HOME/.shub/logs"
KEYOPT=""; [ -f "$KEY" ] && KEYOPT="-i $KEY -o IdentitiesOnly=yes"
export GIT_SSH_COMMAND="ssh $KEYOPT -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
export GIT_TERMINAL_PROMPT=0
command -v git >/dev/null 2>&1 || { echo "Thiếu git trên VPS"; exit 20; }
mkdir -p "$(dirname "$DIR")"
FRESH=0
if [ ! -d "$DIR/.git" ]; then
  echo "== Clone $REPO ($BRANCH)"; git clone -b "$BRANCH" "$REPO" "$DIR" || { echo "Clone lỗi: kiểm tra quyền repo/deploy key"; notify "❌ [$SRV] $NAME: clone lỗi"; exit 21; }
  FRESH=1; PREV=""
else
  cd "$DIR"; PREV=$(git rev-parse HEAD 2>/dev/null)
  if [ "$ROLLBACK" = "1" ]; then
    T=$(cat .shub-prev 2>/dev/null); [ -z "$T" ] && { echo "Chưa có bản cũ để quay lại"; exit 22; }
    echo "== Quay về $T"; git reset --hard "$T" || exit 22
  else
    git fetch origin "$BRANCH" 2>&1 || { echo "Fetch lỗi"; exit 21; }
    NEWREMOTE=$(git rev-parse "origin/$BRANCH")
    if [ "$PREV" = "$NEWREMOTE" ] && [ "$FORCE" != "1" ]; then echo "Không có thay đổi ($(git log -1 --pretty='%h %s'))"; exit 0; fi
    if [ "$(cat .shub-failed 2>/dev/null)" = "$NEWREMOTE" ] && [ "$FORCE" != "1" ]; then echo "Bản $NEWREMOTE đã build lỗi trước đó, chờ commit mới (bấm Cập nhật ngay để thử lại)"; exit 0; fi
    git reset --hard "origin/$BRANCH" || exit 21
  fi
fi
cd "$DIR"; NEW=$(git rev-parse HEAD)
[ -n "$PREV" ] && [ "$PREV" != "$NEW" ] && [ "$ROLLBACK" != "1" ] && echo "$PREV" > .shub-prev
echo "== Phiên bản: $(git log -1 --pretty='%h %s')"
fail() { echo "❌ $1"; echo "$NEW" > .shub-failed; if [ -n "$PREV" ] && [ "$ROLLBACK" != "1" ]; then git reset --hard "$PREV" >/dev/null 2>&1; echo "Đã đưa mã về bản cũ $PREV; tiến trình đang chạy không bị đụng tới."; fi; notify "❌ [$SRV] $NAME deploy lỗi: $1"; exit 30; }

echo "== Cài thư viện"
if [ -n "$INSTALL" ]; then bash -c "$INSTALL" || fail "lệnh cài lỗi"
elif [ -f package-lock.json ]; then npm ci --no-audit --no-fund || fail "npm ci lỗi"
elif [ -f pnpm-lock.yaml ]; then (corepack enable >/dev/null 2>&1; pnpm install --frozen-lockfile) || fail "pnpm lỗi"
elif [ -f yarn.lock ]; then yarn install --frozen-lockfile || fail "yarn lỗi"
elif [ -f package.json ]; then npm install --no-audit --no-fund || fail "npm install lỗi"
elif [ -f requirements.txt ]; then { [ -d .venv ] || python3 -m venv .venv; } && .venv/bin/pip install -q -r requirements.txt || fail "pip lỗi"
else echo "(không có gì để cài)"; fi

echo "== Build"
if [ -n "$BUILD" ]; then bash -c "$BUILD" || fail "build lỗi"
elif [ -f package.json ] && grep -q '"build"' package.json; then npm run build || fail "npm run build lỗi"
else echo "(không có bước build)"; fi

echo "== Khởi động lại ($PM)"
case "$PM" in
  pm2) command -v pm2 >/dev/null 2>&1 || { echo "Thiếu pm2 (npm i -g pm2)"; exit 31; }
       if pm2 describe "$NAME" >/dev/null 2>&1; then pm2 restart "$NAME" --update-env; else pm2 start bash --name "$NAME" -- -c "$START"; fi; pm2 save >/dev/null 2>&1 ;;
  systemd) asroot systemctl restart "$NAME" ;;
  docker) docker compose up -d --build ;;
  none) echo "(không quản lý tiến trình)" ;;
esac
rm -f .shub-failed
echo "✅ Xong: $NAME @ $(git rev-parse --short HEAD)"
notify "✅ [$SRV] $NAME đã cập nhật lên $(git log -1 --pretty='%h %s')"
`;
  }

  function cleanupScript(s, { dry, onlyIfDisk, keepDays }) {
    const env = { DRY: dry ? '1' : '0', KEEP: String(keepDays || 7), ONLY_IF_DISK: String(onlyIfDisk || 0), TG_TOKEN: s.tgToken, TG_CHAT: s.tgChat, SRV: s.name };
    return exportsOf(env) + PRE + `
disk() { df -P / | awk 'NR==2{gsub("%","",$5); print $5}'; }
used() { df -P / | awk 'NR==2{print $3}'; }
B=$(disk); BU=$(used)
if [ "$ONLY_IF_DISK" -gt 0 ] && [ "$B" -lt "$ONLY_IF_DISK" ]; then exit 0; fi
echo "== Dọn rác $(date '+%F %T') | ổ đĩa đang dùng $B%"
HRS=$((KEEP*24)); EMERG=0; [ "$B" -ge 90 ] && EMERG=1 && echo "!! Ổ đĩa >= 90%: dọn mạnh hơn"
run() { echo "+ $*"; [ "$DRY" = "1" ] || "$@" 2>&1 | tail -n 3; }
sz() { du -sh "$@" 2>/dev/null | tail -1; }
if [ "$DRY" = "1" ]; then
  echo "[XEM TRƯỚC - chưa xóa gì]"
  echo "Nhật ký systemd: $(journalctl --disk-usage 2>/dev/null | grep -o '[0-9.]*[KMG]' | tail -1)"
  echo "Cache apt: $(sz /var/cache/apt)"; echo "Log /var/log: $(sz /var/log)"; echo "/tmp: $(sz /tmp)"
  command -v docker >/dev/null 2>&1 && docker system df 2>/dev/null
  echo "npm cache: $(sz ~/.npm)  pm2 logs: $(sz ~/.pm2/logs)"
fi
command -v apt-get >/dev/null 2>&1 && { run asroot apt-get clean; [ "$DRY" = "1" ] || asroot apt-get autoremove -y >/dev/null 2>&1; }
command -v journalctl >/dev/null 2>&1 && { D=$KEEP; [ "$EMERG" = "1" ] && D=1; run asroot journalctl --vacuum-time=\${D}d; }
if [ "$DRY" != "1" ]; then
  asroot find /var/log -type f \\( -name '*.gz' -o -name '*.[0-9]' -o -name '*.old' \\) -mtime +14 -delete 2>/dev/null
  asroot find /var/log -type f -name '*.log' -size +200M -exec truncate -s 0 {} \; 2>/dev/null
  find /tmp -xdev -type f -atime +7 -user "$(id -un)" -delete 2>/dev/null
  asroot find /var/tmp -xdev -type f -atime +14 -delete 2>/dev/null
fi
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  [ "$DRY" = "1" ] || { echo "+ docker prune (không xóa volume)"; docker container prune -f --filter "until=\${HRS}h" 2>/dev/null | tail -1
    if [ "$EMERG" = "1" ]; then docker image prune -a -f 2>/dev/null | tail -1; else docker image prune -a -f --filter "until=\${HRS}h" 2>/dev/null | tail -1; fi
    docker builder prune -f --filter "until=\${HRS}h" 2>/dev/null | tail -1; }
fi
command -v pm2 >/dev/null 2>&1 && [ "$DRY" != "1" ] && { echo "+ pm2 flush"; pm2 flush >/dev/null 2>&1; }
command -v npm >/dev/null 2>&1 && [ "$DRY" != "1" ] && { echo "+ npm cache clean"; npm cache clean --force >/dev/null 2>&1; }
command -v pip3 >/dev/null 2>&1 && [ "$DRY" != "1" ] && pip3 cache purge >/dev/null 2>&1
A=$(disk); AU=$(used)
if [ "$DRY" != "1" ]; then
  FREED=$(( (BU - AU) / 1024 )); echo "== Xong: $B% -> $A%, giải phóng khoảng \${FREED} MB"
  notify "🧹 [$SRV] Dọn rác: $B% -> $A% (~\${FREED} MB)"
else echo "== Hết xem trước"; fi
`;
  }

  // Cài/gỡ tác vụ tự chạy trên VPS (cron), chạy độc lập kể cả khi Mac tắt
  function agentScript(s, { projects, cleanup, backup, remove }) {
    let sh = PRE + 'mkdir -p "$HOME/.shub/logs"\ncommand -v crontab >/dev/null 2>&1 || { echo "VPS chưa có cron (apt install cron)"; exit 40; }\nCUR=$(crontab -l 2>/dev/null | grep -v "# shub-") || true\nNEWTAB="$CUR"\n';
    const lines = [];
    for (const p of projects) {
      const f = `$HOME/.shub/deploy-${p.id}.sh`;
      sh += `cat > ${f} <<'SHUB_EOF_${p.id.replace(/\W/g, '_')}'\n#!/bin/bash\n${deployScript(s, p)}\nSHUB_EOF_${p.id.replace(/\W/g, '_')}\nchmod 700 ${f}\n`;
      if (p.auto && !remove) lines.push(`*/${p.intervalMin} * * * * flock -n /tmp/shub-${p.id}.lock ${f} >> $HOME/.shub/logs/deploy-${p.id}.log 2>&1 # shub-deploy-${p.id}`);
    }
    if (cleanup) {
      sh += `cat > "$HOME/.shub/cleanup.sh" <<'SHUB_EOF_CLEAN'\n#!/bin/bash\nONLY_IF_DISK_ARG="$1"\n${cleanupScript(s, { keepDays: cleanup.keepDays }).replace(/ONLY_IF_DISK='0'/, `ONLY_IF_DISK="\${ONLY_IF_DISK_ARG:-0}"`)}\nSHUB_EOF_CLEAN\nchmod 700 "$HOME/.shub/cleanup.sh"\n`;
      if (cleanup.enabled && !remove) {
        lines.push(`0 ${Number(cleanup.hour) || 3} * * * flock -n /tmp/shub-clean.lock $HOME/.shub/cleanup.sh >> $HOME/.shub/logs/cleanup.log 2>&1 # shub-cleanup`);
        lines.push(`17 * * * * flock -n /tmp/shub-clean.lock $HOME/.shub/cleanup.sh 85 >> $HOME/.shub/logs/cleanup.log 2>&1 # shub-cleanup-emergency`);
      }
    }
    if (backup) {
      sh += `cat > "$HOME/.shub/backup.sh" <<'SHUB_EOF_BACKUP'\n#!/bin/bash\n${extInit.backupScript(s, { label: 'auto' })}\nSHUB_EOF_BACKUP\nchmod 700 "$HOME/.shub/backup.sh"\n`;
      if (backup.enabled && !remove) lines.push(`30 ${Number(backup.hour) % 24} * * * flock -n /tmp/shub-backup.lock $HOME/.shub/backup.sh >> $HOME/.shub/logs/backup.log 2>&1 # shub-backup`);
    }
    sh += `NEWTAB="$NEWTAB\n${lines.join('\n')}"\nprintf '%s\\n' "$NEWTAB" | sed '/^$/d' | crontab -\necho "Đã cập nhật cron:"; crontab -l | grep '# shub-' || echo "(không còn tác vụ shub nào)"\n`;
    return sh;
  }

  const GENKEY = (id) => `
mkdir -p "$HOME/.shub/keys"; chmod 700 "$HOME/.shub" "$HOME/.shub/keys"
K="$HOME/.shub/keys/${id}"
[ -f "$K" ] || ssh-keygen -t ed25519 -N "" -C "shub-${id}" -f "$K" >/dev/null 2>&1
cat "$K.pub"
`;

  // ---------- Job có stream ----------
  const jobs = new Map();
  function startJob(fn) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const J = { log: '', clients: new Set(), done: null };
    jobs.set(id, J);
    const emit = (t) => { J.log += t; J.clients.forEach((c) => c.write(`data: ${JSON.stringify({ t: 'log', s: t })}\n\n`)); };
    (async () => {
      let r; try { r = await fn(emit); } catch (e) { emit('\n' + e.message + '\n'); r = { code: 1 }; }
      J.done = { code: r.code };
      J.clients.forEach((c) => { c.write(`data: ${JSON.stringify({ t: 'done', code: r.code })}\n\n`); c.end(); });
      setTimeout(() => jobs.delete(id), 3600000);
    })();
    return id;
  }

  const findSP = (d, sid, pid) => {
    const s = d.servers.find((x) => x.id === sid); if (!s) bad('Không thấy server');
    const p = pid ? s.projects.find((x) => x.id === pid) : null; if (pid && !p) bad('Không thấy dự án');
    return [s, p];
  };
  const parseKV = (out) => { const o = {}; out.split('\n').forEach((l) => { const m = l.match(/^([A-Z0-9_a-z-]+)=(.*)$/); if (m) o[m[1]] = m[2]; }); return o; };
  const publicServer = (s) => ({ ...s, tgToken: s.tgToken ? '••••' + s.tgToken.slice(-4) : '' });

  // ---------- Router ----------
  let ext = null;
  return async function handle(req, res, u) {
    if (!u.pathname.startsWith('/api/vps/')) return false;
    try {
      const route = u.pathname.slice(9);
      const d = load();
      if (!ext) ext = extInit({ load, save, ssh, sshArgs, SSH_BIN, findSP, bad, startJob, json, body, WS, expand });
      if (await ext.handle(route, req, res, d)) return true;
      if (route === 'servers' && req.method === 'GET') return json(res, 200, { servers: d.servers.map(publicServer) }), true;
      if (route === 'servers' && req.method === 'POST') {
        const b = await body(req);
        const old = d.servers.find((x) => x.id === b.id);
        const s = cleanServer(b, old);
        if (b.keyPem && String(b.keyPem).trim()) {
          const pem = String(b.keyPem).replace(/\r/g, '').trim() + '\n';
          if (!/^-----BEGIN [A-Z ]*PRIVATE KEY-----\n[\s\S]+\n-----END [A-Z ]*PRIVATE KEY-----\n$/.test(pem) || pem.length > 20000) bad('Nội dung private key không hợp lệ (phải bắt đầu bằng -----BEGIN ... PRIVATE KEY-----)');
          const kd = path.join(WS, 'keys'); fs.mkdirSync(kd, { recursive: true, mode: 0o700 });
          const kp = path.join(kd, s.id); fs.writeFileSync(kp, pem, { mode: 0o600 }); fs.chmodSync(kp, 0o600);
          s.keyPath = kp;
        }
        if (old && String(b.tgToken || '').startsWith('••••')) s.tgToken = old.tgToken;
        if (old) d.servers[d.servers.indexOf(old)] = s; else { if (d.servers.some((x) => x.id === s.id)) bad('Trùng id server'); d.servers.push(s); }
        save(d); return json(res, 200, { ok: true, id: s.id }), true;
      }
      if (route === 'servers/delete' && req.method === 'POST') {
        const b = await body(req); d.servers = d.servers.filter((x) => x.id !== b.id); save(d); return json(res, 200, { ok: true }), true;
      }
      if (route === 'projects' && req.method === 'POST') {
        const b = await body(req); const [s] = findSP(d, b.server);
        const old = s.projects.find((x) => x.id === b.id);
        const p = cleanProject(b, old);
        if (old) s.projects[s.projects.indexOf(old)] = p; else { if (s.projects.some((x) => x.id === p.id)) bad('Trùng id dự án'); s.projects.push(p); }
        save(d); return json(res, 200, { ok: true, id: p.id }), true;
      }
      if (route === 'projects/delete' && req.method === 'POST') {
        const b = await body(req); const [s] = findSP(d, b.server); s.projects = s.projects.filter((x) => x.id !== b.id); save(d); return json(res, 200, { ok: true }), true;
      }
      if (route === 'test' && req.method === 'POST') {
        const b = await body(req); const [s] = findSP(d, b.server);
        const r = await ssh(s, 'echo OK; id -un; command -v git node npm pm2 docker python3 2>/dev/null | xargs -n1 basename | tr "\\n" " "', () => {}, 30000);
        return json(res, 200, { ok: r.code === 0 && r.out.startsWith('OK'), out: r.out.trim().slice(0, 600) }), true;
      }
      if (route === 'status' && req.method === 'POST') {
        const b = await body(req); const [s] = findSP(d, b.server);
        const projects = s.projects.map((p) => `${p.id}=${p.dir}`).join(' ');
        const r = await ssh(s, exportsOf({ PROJECTS: projects }) + STATUS, () => {}, 45000);
        if (r.code !== 0 && !r.out.includes('HOST=')) return json(res, 200, { ok: false, error: r.out.trim().slice(-400) }), true;
        return json(res, 200, { ok: true, kv: parseKV(r.out) }), true;
      }
      if (route === 'genkey' && req.method === 'POST') {
        const b = await body(req); const [s, p] = findSP(d, b.server, b.project);
        const r = await ssh(s, GENKEY(p.id), () => {}, 30000);
        return json(res, 200, { ok: r.code === 0, pubkey: r.out.trim().split('\n').pop(), help: 'Thêm khóa này vào GitHub: repo → Settings → Deploy keys → Add (chỉ cần quyền đọc).' }), true;
      }
      if (route === 'logs' && req.method === 'POST') {
        const b = await body(req); const [s, p] = findSP(d, b.server, b.project || null);
        const f = p ? `deploy-${p.id}.log` : 'cleanup.log';
        const extra = p && p.pm === 'pm2' ? `echo "--- pm2 ${p.name} ---"; pm2 logs ${shQ(p.name)} --lines 40 --nostream 2>&1 | tail -n 60` : '';
        const r = await ssh(s, `tail -n 80 "$HOME/.shub/logs/${f}" 2>/dev/null || echo "(chưa có nhật ký)"; ${extra}`, () => {}, 45000);
        return json(res, 200, { out: r.out }), true;
      }
      // Các thao tác dài -> job có stream
      if (['deploy', 'rollback', 'cleanup', 'agent'].includes(route) && req.method === 'POST') {
        const b = await body(req); const [s, p] = findSP(d, b.server, b.project || null);
        let fn;
        if (route === 'deploy') { if (!p) bad('Thiếu dự án'); fn = (e) => ssh(s, deployScript(s, p, { force: !!b.force }), e); }
        else if (route === 'rollback') { if (!p) bad('Thiếu dự án'); fn = (e) => ssh(s, deployScript(s, p, { rollback: true }), e); }
        else if (route === 'cleanup') fn = (e) => ssh(s, cleanupScript(s, { dry: !!b.dry, keepDays: s.cleanup.keepDays }), e);
        else {
          if (b.auto !== undefined && p) { p.auto = !!b.auto; if (b.intervalMin) p.intervalMin = Math.min(60, Math.max(1, Number(b.intervalMin))); }
          if (b.backupEnabled !== undefined) { ext.getBackup(s); s.backup.enabled = !!b.backupEnabled; if (b.backupHour !== undefined) s.backup.hour = Math.min(23, Math.max(0, Number(b.backupHour))); }
          if (b.cleanupEnabled !== undefined) { s.cleanup.enabled = !!b.cleanupEnabled; if (b.keepDays) s.cleanup.keepDays = Math.min(60, Math.max(1, Number(b.keepDays))); if (b.hour !== undefined) s.cleanup.hour = Math.min(23, Math.max(0, Number(b.hour))); }
          save(d);
          fn = (e) => ssh(s, agentScript(s, { projects: s.projects, cleanup: s.cleanup, backup: s.backup }), e);
        }
        return json(res, 200, { id: startJob(fn) }), true;
      }
      if (route === 'stream') {
        const J = jobs.get(u.searchParams.get('id')); if (!J) return json(res, 404, {}), true;
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(`data: ${JSON.stringify({ t: 'log', s: J.log })}\n\n`);
        if (J.done) { res.write(`data: ${JSON.stringify({ t: 'done', code: J.done.code })}\n\n`); res.end(); return true; }
        J.clients.add(res); req.on('close', () => J.clients.delete(res)); return true;
      }
      return json(res, 404, { error: 'not found' }), true;
    } catch (e) { json(res, e.status || 500, { error: String(e.message || e) }); return true; }
  };
};
