// Phần dùng chung cho S VPS
const shQ = (s) => `'${String(s ?? '').replace(/'/g, `'\\''`)}'`;
const exportsOf = (o) => Object.entries(o).map(([k, v]) => `export ${k}=${shQ(v)}`).join('\n') + '\n';
const PRE = `
export PATH="$PATH:/usr/local/bin:/usr/local/sbin:/snap/bin:$HOME/.local/bin"; [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
DK() { if docker info >/dev/null 2>&1; then docker "$@"; else asroot docker "$@"; fi; }
SUDO=""; if [ "$(id -u)" != "0" ]; then if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then SUDO="sudo -n"; else SUDO="NONE"; fi; fi
asroot() { if [ "$SUDO" = "NONE" ]; then echo "  (bỏ qua: cần quyền root) $*"; return 0; fi; $SUDO "$@"; }
notify() { [ -n "$TG_TOKEN" ] && [ -n "$TG_CHAT" ] && curl -s -m 10 "https://api.telegram.org/bot$TG_TOKEN/sendMessage" --data-urlencode "chat_id=$TG_CHAT" --data-urlencode "text=$1" >/dev/null 2>&1 || true; }
`;
module.exports = { shQ, exportsOf, PRE };
