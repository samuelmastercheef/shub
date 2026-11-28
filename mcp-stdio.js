#!/usr/bin/env node
// Cầu nối stdio ↔ cổng MCP của S Hub, cho client MCP chỉ nói stdio (Claude Desktop...).
// Đọc địa chỉ đang chạy (socin-chat/run.json) và mã khoá (socin-chat/mcp.json) trong thư mục làm việc của S Hub,
// nên cấu hình của client không chứa mã khoá. Không phụ thuộc thư viện ngoài.
const fs = require('fs');
const path = require('path');
const os = require('os');

const expand = (p) => String(p || '').replace(/^~(?=$|\/)/, os.homedir());
function workspace() {
  if (process.env.SHUB_WORKSPACE) return expand(process.env.SHUB_WORKSPACE);
  try { return expand(JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')).workspace || '~/TestHubWorkspace'); } catch { return expand('~/TestHubWorkspace'); }
}
function target(ws = workspace()) {
  try {
    const run = JSON.parse(fs.readFileSync(path.join(ws, 'socin-chat', 'run.json'), 'utf8'));
    const cfg = JSON.parse(fs.readFileSync(path.join(ws, 'socin-chat', 'mcp.json'), 'utf8'));
    if (typeof run.url !== 'string' || !/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(run.url) || typeof cfg.token !== 'string' || !cfg.token) return null;
    return { url: run.url, token: cfg.token };
  } catch { return null; }
}
const NOT_RUNNING = 'S Hub chưa chạy hoặc chưa bật Cổng MCP (S Hub → Plugin → Cổng MCP). Mở S Hub, bật lên rồi thử lại.';

async function forwardLine(line, getTarget = target, fetchImpl = fetch) {
  let msg; try { msg = JSON.parse(line); } catch { return JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON lỗi' } }); }
  const ids = (Array.isArray(msg) ? msg : [msg]).map((m) => m && m.id).filter((id) => id !== undefined);
  const errorAll = (message) => { if (!ids.length) return null; const errs = ids.map((id) => ({ jsonrpc: '2.0', id, error: { code: -32000, message } })); return JSON.stringify(Array.isArray(msg) ? errs : errs[0]); };
  const t = getTarget(); if (!t) return errorAll(NOT_RUNNING);
  try {
    const res = await fetchImpl(t.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${t.token}` }, body: line });
    if (res.status === 202) return null;
    if (res.status === 401) return errorAll('Mã khoá S Hub đã đổi. Khởi động lại client MCP.');
    const text = await res.text();
    if (res.status === 503) { try { return errorAll(JSON.parse(text).error.message); } catch { return errorAll(NOT_RUNNING); } }
    if (!res.ok) return errorAll(`S Hub trả lỗi ${res.status}`);
    return text.replace(/\r?\n/g, ' ');
  } catch { return errorAll(NOT_RUNNING); }
}

if (require.main === module) {
  let buf = ''; let chain = Promise.resolve();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      chain = chain.then(async () => { const out = await forwardLine(line); if (out) process.stdout.write(out + '\n'); });
    }
  });
}
module.exports = { forwardLine, target };
