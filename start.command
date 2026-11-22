#!/bin/bash
# S Hub - Socin. Bấm đúp file này để chạy.
cd "$(dirname "$0")" || exit 1
NODE="$(command -v node)"
for c in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.nvm/versions/node"/*/bin/node; do [ -z "$NODE" ] && [ -x "$c" ] && NODE="$c"; done
if [ -z "$NODE" ]; then echo "Chưa cài Node.js. Cài bằng: brew install node (hoặc tải từ nodejs.org)"; read -n 1 -s -r -p "Nhấn phím bất kỳ để đóng"; exit 1; fi
[ -f config.json ] || cp config.example.json config.json
PORT=$("$NODE" -e "try{console.log(require('./config.json').port||4777)}catch{console.log(4777)}")
# Tắt bản S Hub cũ còn chạy (nếu có) để luôn chạy bản mới nhất, tránh mở nhầm bản cũ
for p in $(seq "$PORT" $((PORT+10))); do for pid in $(lsof -ti "tcp:$p" -sTCP:LISTEN 2>/dev/null); do ps -p "$pid" -o command= 2>/dev/null | grep -q "server.js" && kill "$pid" 2>/dev/null; done; done
sleep 0.5
(for i in $(seq 1 40); do sleep 0.5; for p in $(seq "$PORT" $((PORT+10))); do curl -s -m 1 "http://127.0.0.1:$p/api/env" >/dev/null 2>&1 && curl -s -m 1 "http://127.0.0.1:$p/brand.css" >/dev/null 2>&1 && { open "http://127.0.0.1:$p"; exit 0; }; done; done) &
"$NODE" server.js
echo; read -n 1 -s -r -p "S Hub đã dừng. Nhấn phím bất kỳ để đóng"
