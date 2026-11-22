// S VPS mở rộng: quản lý backup (nhiều phiên bản), Docker, tiến trình hệ thống.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { shQ, exportsOf, PRE } = require('./vps-common');

const BK_NAME = /^\d{8}-\d{6}_[\w-]{1,30}\.tar\.gz$/;
const SAFE = /^[\w.-]{1,128}$/;

// ---------- Script backup chạy trên VPS ----------
function backupScript(s, { label = 'auto', pin = false } = {}) {
  const b = s.backup || {};
  const env = {
    LABEL: label, PIN: pin ? '1' : '0',
    BK_PATHS: (b.paths && b.paths.length ? b.paths : s.projects.map((p) => p.dir)).join('\n'),
    BK_EXCLUDE: (b.exclude || []).join('\n'),
    BK_GITDIRS: s.projects.map((p) => p.dir).join('\n'),
    INCLUDE_GIT: b.includeGit === false ? '0' : '1',
    DB_MODE: b.dbMode || 'none', DB_CMD: b.dbCmd || '', BK_VOLUMES: (b.volumes || []).join(' '),
    KEEP_D: String(b.keepDaily ?? 7), KEEP_W: String(b.keepWeekly ?? 4), KEEP_M: String(b.keepMonthly ?? 3),
    TG_TOKEN: s.tgToken, TG_CHAT: s.tgChat, SRV: s.name,
  };
  return exportsOf(env) + PRE + `
set -o pipefail
BDIR="$HOME/.shub/backups"; mkdir -p "$BDIR" "$HOME/.shub/logs"; chmod 700 "$HOME/.shub" "$BDIR" 2>/dev/null
bkfail() { echo "❌ Backup lỗi: $1"; notify "❌ [$SRV] Backup lỗi: $1"; exit 50; }
AVAIL=$(df -Pk "$BDIR" | awk 'NR==2{print $4}'); [ "\${AVAIL:-0}" -lt 524288 ] && bkfail "ổ đĩa còn dưới 512MB, hãy dọn rác trước"
TS=$(date +%Y%m%d-%H%M%S); NAME="\${TS}_\${LABEL}.tar.gz"
S=$(mktemp -d); trap 'rm -rf "$S" "$BDIR/$NAME.part"' EXIT
X="$S/__shub__"; mkdir -p "$X"
echo "== Backup $NAME"
EXIST=(); while IFS= read -r p; do [ -z "$p" ] && continue; p="\${p/#\\~/$HOME}"
  if [ -e "$p" ]; then EXIST+=("\${p#/}"); echo "  + $p ($(du -sh "$p" 2>/dev/null | cut -f1))"; else echo "  - bỏ qua (không tồn tại): $p"; fi; done <<< "$BK_PATHS"
EXC=(); while IFS= read -r e; do [ -n "$e" ] && EXC+=("--exclude=$e"); done <<< "$BK_EXCLUDE"
[ "$INCLUDE_GIT" = "0" ] && EXC+=("--exclude=.git")
EXTRA=()
case "$DB_MODE" in
  mysql) mkdir -p "$X/db"; echo "  + dump MySQL/MariaDB"; { mysqldump --all-databases --single-transaction --routines 2>/dev/null || asroot mysqldump --all-databases --single-transaction --routines 2>/dev/null; } | gzip > "$X/db/mysql-all.sql.gz"; [ "$(stat -c %s "$X/db/mysql-all.sql.gz")" -lt 30 ] && echo "  ! dump MySQL rỗng (cần quyền truy cập DB)";;
  postgres) mkdir -p "$X/db"; echo "  + dump PostgreSQL"; if [ "$(id -u)" = "0" ]; then su postgres -c pg_dumpall 2>/dev/null; else sudo -n -u postgres pg_dumpall 2>/dev/null; fi | gzip > "$X/db/postgres-all.sql.gz"; [ "$(stat -c %s "$X/db/postgres-all.sql.gz")" -lt 30 ] && echo "  ! dump PostgreSQL rỗng";;
  custom) mkdir -p "$X/db"; echo "  + dump tùy chỉnh"; bash -c "$DB_CMD" 2>/dev/null | gzip > "$X/db/custom.sql.gz" || echo "  ! lệnh dump lỗi";;
esac
if [ -n "$BK_VOLUMES" ]; then mkdir -p "$X/vol"; for v in $BK_VOLUMES; do echo "  + docker volume $v"; DK run --rm -v "$v":/v:ro -v "$X/vol":/out alpine tar -czf "/out/$v.tar.gz" -C /v . 2>&1 | tail -n 2; done; fi
{ echo "time=$(date -Is)"; echo "host=$(hostname)"; echo "label=$LABEL"
  while IFS= read -r d; do [ -z "$d" ] && continue; d="\${d/#\\~/$HOME}"; [ -d "$d/.git" ] && echo "commit $d $(git -C "$d" log -1 --pretty='%h %s' 2>/dev/null)"; done <<< "$BK_GITDIRS"; } > "$X/MANIFEST.txt"
[ \${#EXIST[@]} -eq 0 ] && [ ! -d "$X/db" ] && [ ! -d "$X/vol" ] && bkfail "không có gì để backup: hãy điền thư mục cần backup hoặc thêm dự án"
tar -czf "$BDIR/$NAME.part" "\${EXC[@]}" -C / "\${EXIST[@]}" -C "$S" __shub__ 2>/tmp/shub-tar.err || { tail -n 3 /tmp/shub-tar.err; bkfail "tar lỗi"; }
tar -tzf "$BDIR/$NAME.part" >/dev/null 2>&1 || bkfail "file backup không đọc được"
mv "$BDIR/$NAME.part" "$BDIR/$NAME"
( cd "$BDIR" && sha256sum "$NAME" > "$NAME.sha256" )
COMMITS=$(grep '^commit ' "$X/MANIFEST.txt" | awk '{n=split($2,a,"/"); printf "%s@%s,", a[n], $3}' | sed 's/,$//')
printf '%s\\t%s\\t%s\\n' "$(date -Is)" "$LABEL" "$COMMITS" > "$BDIR/$NAME.meta"
[ "$PIN" = "1" ] && touch "$BDIR/$NAME.pin"
SZ=$(du -h "$BDIR/$NAME" | cut -f1)
echo "✅ Backup xong: $NAME ($SZ), đã kiểm tra đọc được"
# ---- Giữ phiên bản: N bản mới nhất + 1 bản/tuần + 1 bản/tháng; bản ghim không bị xóa
KEEP=""; DC=0; WSEEN=""; MSEEN=""; WC=0; MC=0
for f in $(ls -1 "$BDIR"/*.tar.gz 2>/dev/null | sort -r); do n=$(basename "$f"); k=0
  [ -f "$f.pin" ] && k=1
  if [ $DC -lt "$KEEP_D" ]; then k=1; DC=$((DC+1)); fi
  d=\${n:0:8}; wk=$(date -d "$d" +%G-%V 2>/dev/null); mo=\${d:0:6}
  if [ -n "$wk" ] && [ $WC -lt "$KEEP_W" ] && [[ " $WSEEN " != *" $wk "* ]]; then k=1; WSEEN="$WSEEN $wk"; WC=$((WC+1)); fi
  if [ $MC -lt "$KEEP_M" ] && [[ " $MSEEN " != *" $mo "* ]]; then k=1; MSEEN="$MSEEN $mo"; MC=$((MC+1)); fi
  [ $k -eq 0 ] && { echo "  xóa bản cũ: $n"; rm -f "$f" "$f.sha256" "$f.meta" "$f.pin"; }
done
notify "💾 [$SRV] Backup $NAME ($SZ)"
`;
}

const listBackupsScript = PRE + `
BDIR="$HOME/.shub/backups"
for f in $(ls -1 "$BDIR"/*.tar.gz 2>/dev/null | sort -r); do n=$(basename "$f"); sz=$(stat -c %s "$f"); pin=0; [ -f "$f.pin" ] && pin=1
  meta=$(cat "$f.meta" 2>/dev/null | tr '\\t' '~'); echo "B|$n|$sz|$pin|$meta"; done
echo "FREE|$(df -Pk "$BDIR" 2>/dev/null | awk 'NR==2{print $4*1024}')"
echo "TOTAL|$(du -sk "$BDIR" 2>/dev/null | cut -f1)"
echo "CRON|$(crontab -l 2>/dev/null | grep -c '# shub-backup')"
`;

function backupActScript(s, name, act, mode) {
  const head = exportsOf({ NAME: name }) + PRE + 'BDIR="$HOME/.shub/backups"; F="$BDIR/$NAME"\n[ -f "$F" ] || { echo "Không thấy bản backup $NAME"; exit 51; }\n';
  switch (act) {
    case 'delete': return head + 'rm -f "$F" "$F.sha256" "$F.meta" "$F.pin"; echo "Đã xóa $NAME"\n';
    case 'pin': return head + 'touch "$F.pin"; echo "Đã ghim $NAME (không bị xóa tự động)"\n';
    case 'unpin': return head + 'rm -f "$F.pin"; echo "Đã bỏ ghim $NAME"\n';
    case 'verify': return head + '(cd "$BDIR" && sha256sum -c "$NAME.sha256" 2>&1) && tar -tzf "$F" >/dev/null && echo "✅ Bản backup toàn vẹn" || { echo "❌ Bản backup hỏng"; exit 52; }\n';
    case 'contents': return head + 'echo "Nội dung (tối đa 300 mục):"; tar -tzf "$F" | head -n 300; echo; tar -xzOf "$F" __shub__/MANIFEST.txt 2>/dev/null\n';
    case 'restore':
      if (mode === 'tmp') return head + 'D="$HOME/.shub/restore/${NAME%.tar.gz}"; mkdir -p "$D" && tar -xzf "$F" -C "$D" && echo "✅ Đã giải nén vào: $D" && echo "(mã nguồn nằm trong thư mục con theo đường dẫn gốc; dump DB ở __shub__/db)"\n';
      // đè lên chỗ cũ: tự tạo bản an toàn trước, không đụng DB/volume
      return backupScript(s, { label: 'pre-restore', pin: true }).replace(/set -o pipefail/, 'set -o pipefail') +
        '\necho "== Khôi phục mã nguồn từ ' + name.replace(/'/g, '') + ' (đè lên đường dẫn gốc)"\n' + exportsOf({ NAME: name }) +
        'F="$BDIR/$NAME"; [ -f "$F" ] || { echo "Không thấy bản backup"; exit 51; }\ntar -xzf "$F" -C / --exclude="__shub__*" && echo "✅ Đã khôi phục. Hãy khởi động lại tiến trình liên quan. Bản trước khi khôi phục đã được ghim để quay lại." || { echo "❌ Giải nén lỗi"; exit 53; }\n';
  }
  throw new Error('Thao tác không hợp lệ');
}

// ---------- Docker ----------
const DOCKER_LIST = PRE + `
command -v docker >/dev/null 2>&1 || { echo "NODOCKER"; exit 0; }
echo "@@containers"; DK ps -a --format '{{json .}}' 2>&1
echo "@@stats"; DK stats --no-stream --format '{{json .}}' 2>/dev/null
echo "@@images"; DK images --format '{{json .}}' 2>&1
echo "@@dangling"; DK images -f dangling=true -q 2>/dev/null | wc -l
echo "@@volumes"; DK volume ls --format '{{json .}}' 2>&1
echo "@@df"; DK system df --format '{{json .}}' 2>/dev/null
`;
const COMPOSE = `
cdir() { c=$(DK ps -aq --filter "label=com.docker.compose.project=$PROJ" | head -1); [ -z "$c" ] && { echo "Không thấy compose project $PROJ"; exit 60; }
  DK inspect --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$c"; }
dc() { if DK compose version >/dev/null 2>&1; then DK compose "$@"; else (command -v docker-compose >/dev/null && asroot docker-compose "$@") || { echo "Thiếu docker compose"; exit 61; }; fi; }
D=$(cdir) || exit 60; cd "$D" || { echo "Không vào được $D"; exit 62; }; echo "== compose $PROJ @ $D"
`;
function dockerScript(act, p) {
  const id = p.id, proj = p.project;
  const e = exportsOf({ ID: id || '', PROJ: proj || '', FILTER: p.until || '' });
  switch (act) {
    case 'start': case 'stop': case 'restart': return e + PRE + `DK ${act} "$ID" && echo "✅ ${act} $ID"\n`;
    case 'rm': return e + PRE + 'DK rm -f "$ID" && echo "✅ Đã xóa container $ID (volume giữ nguyên)"\n';
    case 'logs': return e + PRE + 'DK logs --tail 200 --timestamps "$ID" 2>&1\n';
    case 'inspect': return e + PRE + `DK inspect --format 'Image: {{.Config.Image}}
Trạng thái: {{.State.Status}} (restart {{.RestartCount}}, policy {{.HostConfig.RestartPolicy.Name}})
Bắt đầu: {{.State.StartedAt}}
Mounts: {{range .Mounts}}{{.Source}}->{{.Destination}} {{end}}
Cổng: {{.NetworkSettings.Ports}}' "$ID"\n`;
    case 'img-rm': return e + PRE + 'DK rmi "$ID" 2>&1\n';
    case 'vol-rm': return e + PRE + 'DK volume rm "$ID" 2>&1\n';
    case 'compose-up': return e + PRE + COMPOSE + 'dc up -d 2>&1\n';
    case 'compose-pull': return e + PRE + COMPOSE + 'dc pull 2>&1 && dc up -d 2>&1 && echo "✅ Đã kéo image mới và chạy lại"\n';
    case 'compose-restart': return e + PRE + COMPOSE + 'dc restart 2>&1\n';
    case 'compose-down': return e + PRE + COMPOSE + 'dc down 2>&1 && echo "✅ Đã dừng và gỡ container (volume giữ nguyên)"\n';
    case 'compose-logs': return e + PRE + COMPOSE + 'dc logs --tail 200 --timestamps 2>&1\n';
    case 'prune-preview': return e + PRE + 'DK system df 2>&1; echo; echo "Container đã dừng:"; DK ps -a --filter status=exited --format "  {{.Names}} ({{.Status}})"; echo "Image không gắn thẻ: $(DK images -f dangling=true -q | wc -l)"\n';
    case 'prune': return e + PRE + 'echo "+ container đã dừng"; DK container prune -f 2>&1 | tail -n 2; echo "+ image không dùng"; DK image prune -f 2>&1 | tail -n 2; echo "+ build cache"; DK builder prune -f 2>&1 | tail -n 2; echo "(không xóa volume)"\n';
    case 'prune-all-images': return e + PRE + 'DK image prune -a -f 2>&1 | tail -n 3\n';
  }
  throw new Error('Thao tác docker không hợp lệ');
}

// ---------- Tiến trình / hệ thống ----------
const SYS_LIST = PRE + `
echo "@@pm2"; command -v pm2 >/dev/null 2>&1 && pm2 jlist 2>/dev/null || echo "[]"
echo; echo "@@failed"; systemctl --failed --no-legend --plain 2>/dev/null | awk '{print $1}'
echo "@@ports"; ss -tlnH 2>/dev/null | awk '{print $4}' | sed 's/.*://' | sort -un | tr '\\n' ' '
echo; echo "@@ports_proc"; (asroot ss -tlnpH 2>/dev/null || ss -tlnpH 2>/dev/null) | awk '{print $4" "$6}' | sed 's/users:((//; s/))//' | head -n 40
echo "@@cron"; crontab -l 2>/dev/null | grep -v '^#' | head -n 40
`;
function sysScript(act, p) {
  const e = exportsOf({ NAME: p.name || '', DIR: p.dir || '' });
  switch (act) {
    case 'pm2-restart': case 'pm2-stop': case 'pm2-start': return e + PRE + `pm2 ${act.slice(4)} "$NAME" 2>&1 | tail -n 8; pm2 save >/dev/null 2>&1\n`;
    case 'pm2-logs': return e + PRE + 'pm2 logs "$NAME" --lines 80 --nostream 2>&1 | tail -n 120\n';
    case 'pm2-flush': return e + PRE + 'pm2 flush >/dev/null 2>&1; echo "Đã xóa nhật ký PM2"\n';
    case 'svc-restart': return e + PRE + 'asroot systemctl restart "$NAME" 2>&1; asroot systemctl status "$NAME" --no-pager -n 15 2>&1 | head -n 20\n';
    case 'svc-status': return e + PRE + 'asroot systemctl status "$NAME" --no-pager -n 30 2>&1 | head -n 40\n';
    case 'disk': return exportsOf({ DIR: p.dir }) + PRE + 'echo "Dung lượng lớn nhất trong $DIR:"; du -xh --max-depth=1 "$DIR" 2>/dev/null | sort -rh | head -n 16\n';
  }
  throw new Error('Thao tác không hợp lệ');
}
const DISK_DIRS = ['/', '/var', '/var/lib', '/var/lib/docker', '/var/log', '/home', '/root', '/opt', '/srv', '/tmp'];

// ---------- Router ----------
module.exports = function ext(c) {
  const { load, save, ssh, sshArgs, SSH_BIN, findSP, bad, startJob, json, body, WS, expand } = c;
  const MIRROR = (sid) => path.join(WS, 'backups', sid);
  const parseBackups = (out) => {
    const list = []; let free = 0, total = 0, cron = 0;
    out.split('\n').forEach((l) => {
      const p = l.split('|');
      if (p[0] === 'B') { const [t, label, commits] = (p.slice(4).join('|') || '').split('~'); list.push({ name: p[1], bytes: Number(p[2]), pinned: p[3] === '1', time: t || '', label: label || '', commits: commits || '' }); }
      else if (p[0] === 'FREE') free = Number(p[1]) || 0; else if (p[0] === 'TOTAL') total = (Number(p[1]) || 0) * 1024; else if (p[0] === 'CRON') cron = Number(p[1]) || 0;
    });
    return { list, free, total, cron };
  };
  const cleanBackupCfg = (b, old = {}) => {
    const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };
    const lines = (v) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => String(x).trim()).filter(Boolean);
    const paths = b.paths === undefined ? old.paths || [] : lines(b.paths); const exclude = b.exclude === undefined ? old.exclude || [] : lines(b.exclude); const volumes = b.volumes === undefined ? old.volumes || [] : lines(b.volumes);
    paths.forEach((p) => { if (!/^(~\/|\/)[\w.\/ -]{1,200}$/.test(p) || p === '/' || /^\/(proc|sys|dev|run)(\/|$)/.test(p)) bad('Đường dẫn backup không hợp lệ: ' + p); });
    exclude.forEach((x) => { if (!/^[\w.*\/-]{1,100}$/.test(x)) bad('Mẫu loại trừ không hợp lệ: ' + x); });
    volumes.forEach((v) => { if (!SAFE.test(v)) bad('Tên volume không hợp lệ: ' + v); });
    const dbMode = ['none', 'mysql', 'postgres', 'custom'].includes(b.dbMode) ? b.dbMode : 'none';
    return {
      ...old, paths, exclude, volumes, dbMode, dbCmd: dbMode === 'custom' ? String(b.dbCmd || '').slice(0, 400) : '',
      includeGit: b.includeGit !== false, hour: num(b.hour, 0, 23, old.hour ?? 2),
      keepDaily: num(b.keepDaily, 1, 60, 7), keepWeekly: num(b.keepWeekly, 0, 26, 4), keepMonthly: num(b.keepMonthly, 0, 24, 3),
      mirror: !!b.mirror, mirrorKeep: num(b.mirrorKeep, 1, 100, 14), enabled: !!old.enabled,
    };
  };
  const defaultBackup = () => ({ paths: [], exclude: ['node_modules', '.venv', '__pycache__', '*.log', '.cache'], volumes: [], dbMode: 'none', dbCmd: '', includeGit: true, hour: 2, keepDaily: 7, keepWeekly: 4, keepMonthly: 3, mirror: false, mirrorKeep: 14, enabled: false });
  const getBackup = (s) => (s.backup = { ...defaultBackup(), ...(s.backup || {}) });

  // Tải một bản backup về Mac + kiểm tra sha256
  async function download(s, name, emit) {
    const dir = MIRROR(s.id); fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, name);
    emit(`Đang tải ${name} về ${dest}\n`);
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(dest + '.part');
      const p = spawn(SSH_BIN, sshArgs(s, `cat "$HOME/.shub/backups/${name}"`), { stdio: ['ignore', 'pipe', 'pipe'] });
      p.stdout.pipe(out); let err = ''; p.stderr.on('data', (d) => (err += d));
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Tải lỗi: ' + err.slice(-200)))));
      p.on('error', reject);
    });
    const r = await ssh(s, `cat "$HOME/.shub/backups/${name}.sha256"`, () => {}, 30000);
    const want = (r.out.match(/^[0-9a-f]{64}/) || [])[0];
    const h = crypto.createHash('sha256'); await new Promise((res) => fs.createReadStream(dest + '.part').on('data', (d) => h.update(d)).on('end', res));
    if (want && h.digest('hex') !== want) { fs.unlinkSync(dest + '.part'); throw new Error('Sai checksum, đã hủy file tải về'); }
    fs.renameSync(dest + '.part', dest);
    emit(`✅ Đã lưu và kiểm tra toàn vẹn: ${dest}\n`);
    return dest;
  }
  async function mirrorServer(s, emit = () => {}) {
    const b = getBackup(s); if (!b.mirror) return;
    const r = await ssh(s, listBackupsScript, () => {}, 45000); if (r.code !== 0) return;
    const { list } = parseBackups(r.out);
    const dir = MIRROR(s.id); fs.mkdirSync(dir, { recursive: true });
    for (const x of list.slice(0, b.mirrorKeep)) { if (!fs.existsSync(path.join(dir, x.name))) { try { await download(s, x.name, emit); } catch (e) { emit('Lỗi mirror: ' + e.message + '\n'); } } }
    const have = fs.readdirSync(dir).filter((f) => BK_NAME.test(f)).sort().reverse();
    have.slice(b.mirrorKeep).forEach((f) => { try { fs.unlinkSync(path.join(dir, f)); } catch {} });
  }
  // Tự đồng bộ về Mac mỗi 30 phút khi S Hub đang chạy
  if (!process.env.SHUB_NO_TIMER) setInterval(() => { load().servers.forEach((s) => mirrorServer(s).catch(() => {})); }, 30 * 60 * 1000).unref();

  return {
    backupScript, getBackup,
    async handle(route, req, res, d) {
      if (!['backup/', 'docker/', 'sys/'].some((x) => route.startsWith(x))) return false;
      const b = req.method === 'POST' ? await body(req) : {};
      const [s] = findSP(d, b.server);
      if (route === 'backup/config') {
        const old = getBackup(s); s.backup = cleanBackupCfg(b.config || {}, old); save(d); return json(res, 200, { ok: true, backup: s.backup }), true;
      }
      if (route === 'backup/get') return json(res, 200, { backup: getBackup(s), mirrored: fs.existsSync(MIRROR(s.id)) ? fs.readdirSync(MIRROR(s.id)).filter((f) => BK_NAME.test(f)).sort().reverse() : [], mirrorDir: MIRROR(s.id) }), true;
      if (route === 'backup/list') {
        const r = await ssh(s, listBackupsScript, () => {}, 45000);
        if (r.code !== 0 && !/FREE\|/.test(r.out)) return json(res, 200, { ok: false, error: r.out.trim().slice(-300) }), true;
        return json(res, 200, { ok: true, ...parseBackups(r.out) }), true;
      }
      if (route === 'backup/run') { getBackup(s); return json(res, 200, { id: startJob((e) => ssh(s, backupScript(s, { label: 'manual' }), e)) }), true; }
      if (route === 'backup/act') {
        if (!BK_NAME.test(b.name || '')) bad('Tên bản backup không hợp lệ');
        if (!['delete', 'pin', 'unpin', 'verify', 'contents', 'restore'].includes(b.act)) bad('Thao tác không hợp lệ');
        getBackup(s);
        return json(res, 200, { id: startJob((e) => ssh(s, backupActScript(s, b.name, b.act, b.mode === 'inplace' ? 'inplace' : 'tmp'), e)) }), true;
      }
      if (route === 'backup/download') {
        if (!BK_NAME.test(b.name || '')) bad('Tên bản backup không hợp lệ');
        return json(res, 200, { id: startJob(async (e) => { try { await download(s, b.name, e); return { code: 0 }; } catch (x) { e(x.message + '\n'); return { code: 1 }; } }) }), true;
      }
      if (route === 'backup/mirror-now') return json(res, 200, { id: startJob(async (e) => { await mirrorServer(s, e); e('Đồng bộ xong.\n'); return { code: 0 }; }) }), true;
      if (route === 'docker/list') {
        const r = await ssh(s, DOCKER_LIST, () => {}, 60000);
        if (/NODOCKER/.test(r.out)) return json(res, 200, { ok: true, nodocker: true }), true;
        const sec = {}; let cur = null; r.out.split('\n').forEach((l) => { if (l.startsWith('@@')) { cur = l.slice(2); sec[cur] = []; } else if (cur && l.trim()) sec[cur].push(l); });
        const jl = (a) => (a || []).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        return json(res, 200, { ok: r.code === 0 || !!sec.containers, containers: jl(sec.containers), stats: jl(sec.stats), images: jl(sec.images), dangling: Number((sec.dangling || ['0'])[0]) || 0, volumes: jl(sec.volumes), df: jl(sec.df), raw: sec.containers && !jl(sec.containers).length ? sec.containers.join('\n') : '' }), true;
      }
      if (route === 'docker/act') {
        const act = String(b.act || '');
        if (b.id !== undefined && !SAFE.test(b.id)) bad('Tên/ID không hợp lệ');
        if (b.project !== undefined && !SAFE.test(b.project)) bad('Tên compose project không hợp lệ');
        const script = dockerScript(act, { id: b.id, project: b.project });
        return json(res, 200, { id: startJob((e) => ssh(s, script, e, 900000)) }), true;
      }
      if (route === 'sys/list') {
        const r = await ssh(s, SYS_LIST, () => {}, 45000);
        const sec = {}; let cur = null; r.out.split('\n').forEach((l) => { if (l.startsWith('@@')) { cur = l.slice(2); sec[cur] = []; } else if (cur) sec[cur].push(l); });
        let pm2 = []; try { pm2 = JSON.parse((sec.pm2 || []).join('\n').trim() || '[]').map((x) => ({ name: x.name, status: x.pm2_env && x.pm2_env.status, cpu: x.monit && x.monit.cpu, mem: x.monit && x.monit.memory, restarts: x.pm2_env && x.pm2_env.restart_time, uptime: x.pm2_env && x.pm2_env.pm_uptime })); } catch {}
        return json(res, 200, { ok: true, pm2, failed: (sec.failed || []).filter(Boolean), ports: (sec.ports || []).join(' ').trim(), portProc: (sec.ports_proc || []).filter(Boolean), cron: (sec.cron || []).filter(Boolean), diskDirs: DISK_DIRS }), true;
      }
      if (route === 'sys/act') {
        const act = String(b.act || '');
        if (b.name !== undefined && !SAFE.test(b.name)) bad('Tên không hợp lệ');
        if (act === 'disk' && !DISK_DIRS.includes(b.dir)) bad('Thư mục không nằm trong danh sách cho phép');
        const script = sysScript(act, { name: b.name, dir: b.dir });
        return json(res, 200, { id: startJob((e) => ssh(s, script, e, 180000)) }), true;
      }
      return false;
    },
  };
};
module.exports.backupScript = backupScript;
