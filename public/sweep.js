// Gom USDT BEP20 từ các địa chỉ nạp (suy từ xpub) về ví chính. Đọc số dư bằng xpub; chỉ khi ký mới cần cụm từ.
// Khoá chỉ nằm trong bộ nhớ trang; ra mạng chỉ có địa chỉ ví và giao dịch đã ký, tới RPC nằm trong CSP.
const $ = (i) => document.getElementById(i);
const USDT = '0x55d398326f99059fF775485246999027B3197955', CHAIN = 56n, DEC = 18, TOPUP_GAS = 21000n;
let scan = null, keys = null, busy = false, stopReq = false;
const say = (id, t, bad) => { const s = $(id); s.textContent = t; s.className = bad ? 'err' : 'mut'; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = DEC, show = 6) => { const s = v.toString().padStart(d + 1, '0'), i = s.slice(0, -d), f = s.slice(-d).slice(0, show).replace(/0+$/, ''); return i + (f ? '.' + f : ''); };
const parseUnits = (t, d = DEC) => { const m = String(t).trim().match(/^(\d*)(?:\.(\d*))?$/); if (!m || (!m[1] && !m[2])) throw new Error('số không hợp lệ: ' + t); return BigInt((m[1] || '0') + (m[2] || '').slice(0, d).padEnd(d, '0')); };
const hx = (n) => '0x' + BigInt(n).toString(16);
const link = (h) => `<a href="https://bscscan.com/tx/${esc(h)}" target="_blank" rel="noopener noreferrer">${esc(h.slice(0, 18))}…</a>`;
function log(html) { const l = $('log'); l.hidden = false; l.insertAdjacentHTML('beforeend', html + '\n'); l.scrollTop = l.scrollHeight; }

// ---- JSON-RPC ----
let rid = 1;
async function rpc(calls) {
  const body = calls.map(([method, params]) => ({ jsonrpc: '2.0', id: rid++, method, params }));
  const r = await fetch($('rpc').value, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
  if (!r.ok) throw new Error('RPC trả lỗi HTTP ' + r.status);
  const j = await r.json(), arr = Array.isArray(j) ? j : [j], by = new Map(arr.map((x) => [x.id, x]));
  return body.map((b) => { const x = by.get(b.id); if (!x) throw new Error('RPC thiếu kết quả'); if (x.error) throw new Error('RPC: ' + (x.error.message || JSON.stringify(x.error))); return x.result; });
}
const one = async (m, p) => (await rpc([[m, p]]))[0];
async function checkChain() { const c = await one('eth_chainId', []); if (BigInt(c) !== CHAIN) throw new Error('RPC không phải BNB Smart Chain (chainId ' + c + ')'); }
const usdtOf = (a) => ['eth_call', [{ to: USDT, data: SEvmTx.erc20BalanceOf(a) }, 'latest']];

// ---- Bước 2: quét ----
function mainAddr() { const v = $('main').value.trim(); if (!v) throw new Error('Nhập địa chỉ ví chính trước'); const a = SXpub.checksumAddress(v); if (a.toLowerCase() === USDT.toLowerCase()) throw new Error('Ví chính không được là địa chỉ hợp đồng USDT'); return a; }
async function doScan() {
  if (busy) return; busy = true; $('signc').hidden = true; $('plan').hidden = true; resetConfirm();
  try {
    const main = mainAddr(), min = parseUnits($('min').value || '0'), gl = BigInt(Math.max(40000, +$('gl').value || 100000));
    const xpub = $('xpub').value.trim(), start = +$('start').value || 0, count = Math.min(500, Math.max(1, +$('count').value || 20));
    say('sst', 'Đang suy địa chỉ từ xpub…');
    const list = await SXpub.addressesFromXpub(xpub, { network: 'evm', start, count });
    if (list.some((a) => a.address.toLowerCase() === main.toLowerCase())) throw new Error('Ví chính trùng một địa chỉ nạp, hãy dùng ví khác');
    say('sst', 'Đang đọc số dư…'); await checkChain();
    const gasPrice = BigInt(await one('eth_gasPrice', []));
    for (let i = 0; i < list.length; i += 25) {
      const part = list.slice(i, i + 25), res = await rpc(part.flatMap((a) => [usdtOf(a.address), ['eth_getBalance', [a.address, 'latest']]]));
      part.forEach((a, k) => { a.usdt = BigInt(res[2 * k] === '0x' ? 0 : res[2 * k]); a.bnb = BigInt(res[2 * k + 1]); });
      say('sst', `Đang đọc số dư… ${Math.min(i + 25, list.length)}/${list.length}`);
    }
    const cost = gl * gasPrice;
    for (const a of list) { a.sweep = a.usdt > 0n && a.usdt >= min; a.topup = a.sweep && a.bnb < cost ? cost - a.bnb : 0n; }
    scan = { xpub, main, list, gasPrice, gl, min };
    renderScan(); say('sst', `Đã quét ${list.length} địa chỉ lúc ${new Date().toLocaleTimeString('vi-VN')}.`);
  } catch (e) { say('sst', 'Lỗi: ' + e.message, 1); } finally { busy = false; }
}
function renderScan() {
  const { list, gasPrice, gl, main } = scan, todo = list.filter((a) => a.sweep), tops = todo.filter((a) => a.topup > 0n);
  $('rows').innerHTML = list.map((a) => `<tr><td>#${a.index}</td><td>${esc(a.address)}</td><td class="n">${fmt(a.usdt, DEC, 4)}</td><td class="n">${fmt(a.bnb, DEC, 6)}</td><td>${a.sweep ? (a.topup ? `gom, nạp thêm ${fmt(a.topup)} BNB gas` : 'gom') : '<span class="mut">bỏ qua</span>'}</td></tr>`).join('');
  $('tb').hidden = false;
  const total = todo.reduce((t, a) => t + a.usdt, 0n), topTotal = tops.reduce((t, a) => t + a.topup, 0n), feeNeed = topTotal + BigInt(tops.length) * TOPUP_GAS * gasPrice;
  scan.feeNeed = feeNeed; scan.todo = todo; scan.tops = tops;
  $('plan').innerHTML = todo.length
    ? `<b>Kế hoạch:</b> gom <b>${fmt(total)} USDT</b> từ ${todo.length} địa chỉ về <b>${esc(main)}</b>.<br>Giá gas ${fmt(gasPrice, 9, 3)} gwei, tối đa ${fmt(gl * gasPrice)} BNB mỗi lệnh. ${tops.length ? `${tops.length} địa chỉ thiếu gas: ví phí cần khoảng <b>${fmt(feeNeed)} BNB</b>.` : 'Không cần nạp gas.'}<br><span class="mut">BNB thừa nhỏ còn lại trên địa chỉ nạp sẽ được dùng cho lần gom sau.</span>`
    : 'Không có địa chỉ nào đạt ngưỡng để gom.';
  $('plan').hidden = false; $('signc').hidden = !todo.length;
}

// ---- Bước 3: khoá ----
async function feeKey(v) {
  v = v.trim(); if (!v) return null;
  if (/^(0x)?[0-9a-f]{64}$/i.test(v)) return SXpub.keyFromHex(v);
  if (!(await SXpub.validateMnemonic(v, BIP39_EN))) throw new Error('Ví phí: không phải khoá riêng hex hay cụm từ hợp lệ');
  return (await SXpub.deriveAccount(v, { count: 1, withKeys: true })).addresses[0].key;
}
async function doCheck() {
  if (busy || !scan) return; busy = true; resetConfirm();
  try {
    const m = $('m').value; if (!(await SXpub.validateMnemonic(m, BIP39_EN))) throw new Error('Cụm từ ví nạp không hợp lệ');
    const idx = scan.todo.map((a) => a.index), lo = Math.min(...idx), hi = Math.max(...idx);
    say('kst', 'Đang suy khoá…');
    const acc = await SXpub.deriveAccount(m, { passphrase: $('pp').value, start: lo, count: hi - lo + 1, withKeys: true });
    if (acc.xpub !== scan.xpub) throw new Error('Cụm từ/passphrase không khớp xpub đã quét. Không ký gì cả.');
    const dep = new Map(acc.addresses.map((a) => [a.index, a]));
    for (const a of scan.todo) if (dep.get(a.index).address !== a.address) throw new Error('Địa chỉ #' + a.index + ' không khớp');
    let fee = null, feeAddr = null, feeBal = 0n;
    if (scan.tops.length) {
      fee = await feeKey($('fee').value); if (fee == null) throw new Error('Cần ví phí vì có địa chỉ thiếu BNB gas');
      feeAddr = SXpub.evmAddressOfKey(fee);
      if (scan.list.some((a) => a.address === feeAddr)) throw new Error('Ví phí trùng một địa chỉ nạp, hãy dùng ví khác');
      feeBal = BigInt(await one('eth_getBalance', [feeAddr, 'latest']));
      if (feeBal < scan.feeNeed) throw new Error(`Ví phí ${feeAddr} chỉ có ${fmt(feeBal)} BNB, cần khoảng ${fmt(scan.feeNeed)} BNB`);
    }
    keys = { dep, fee, feeAddr };
    $('summary').innerHTML = `Sẽ gửi ${scan.tops.length} lệnh nạp gas${feeAddr ? ` từ ví phí <b>${esc(feeAddr)}</b> (số dư ${fmt(feeBal)} BNB)` : ''}, rồi ${scan.todo.length} lệnh chuyển <b>toàn bộ USDT</b> về ví chính <b>${esc(scan.main)}</b>.<br>Kiểm tra kỹ 6 ký tự cuối ví chính: <b>${esc(scan.main.slice(-6))}</b>.`;
    $('confirmw').hidden = false; say('kst', 'Khoá khớp xpub.');
  } catch (e) { keys = null; say('kst', 'Lỗi: ' + e.message, 1); } finally { busy = false; }
}
function resetConfirm() { $('confirmw').hidden = true; $('ack').checked = false; $('word').value = ''; $('send').disabled = true; }
const gate = () => { $('send').disabled = busy || !keys || !$('ack').checked || $('word').value.trim().toUpperCase() !== 'GOM'; };

// ---- Gửi ----
async function waitReceipt(h, label) {
  for (let t = 0; t < 60; t++) {
    const r = await one('eth_getTransactionReceipt', [h]);
    if (r) { if (BigInt(r.status) !== 1n) throw new Error(label + ' thất bại trên chuỗi: ' + h); return r; }
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error(label + ' chưa được xác nhận sau 3 phút: ' + h);
}
async function sendRaw(raw, hash) { const h = await one('eth_sendRawTransaction', [raw]); if (h && h.toLowerCase() !== hash.toLowerCase()) throw new Error('RPC trả về mã giao dịch lạ'); return hash; }
async function doSend() {
  if (busy || !keys || !scan) return; busy = true; stopReq = false; gate(); $('stop').hidden = false; let ok = 0;
  try {
    await checkChain();
    const gasPrice = BigInt(await one('eth_gasPrice', [])), gl = scan.gl;
    if (gasPrice > scan.gasPrice * 3n) throw new Error('Giá gas tăng gấp 3 so với lúc quét, hãy quét lại');
    if (scan.tops.length) {
      let nonce = BigInt(await one('eth_getTransactionCount', [keys.feeAddr, 'pending']));
      const sent = [];
      for (const a of scan.tops) {
        const bnb = BigInt(await one('eth_getBalance', [a.address, 'latest'])), need = gl * gasPrice > bnb ? gl * gasPrice - bnb : 0n;
        if (!need) { log(`#${a.index} đã đủ gas, bỏ qua nạp`); continue; }
        const tx = await SEvmTx.signLegacy({ nonce, gasPrice, gasLimit: TOPUP_GAS, to: a.address, value: need, chainId: CHAIN }, keys.fee);
        await sendRaw(tx.raw, tx.hash); nonce++; sent.push([a, tx.hash]); log(`Nạp ${fmt(need)} BNB gas → #${a.index}: ${link(tx.hash)}`);
        if (stopReq) throw new Error('Đã dừng theo yêu cầu');
      }
      for (const [a, h] of sent) await waitReceipt(h, 'Nạp gas #' + a.index);
      if (sent.length) log('Các lệnh nạp gas đã xác nhận.');
    }
    for (const a of scan.todo) {
      if (stopReq) throw new Error('Đã dừng theo yêu cầu');
      const k = keys.dep.get(a.index), [bal, n] = await rpc([usdtOf(a.address), ['eth_getTransactionCount', [a.address, 'pending']]]), amt = BigInt(bal === '0x' ? 0 : bal);
      if (amt === 0n) { log(`#${a.index} không còn USDT, bỏ qua`); continue; }
      const tx = await SEvmTx.signLegacy({ nonce: BigInt(n), gasPrice, gasLimit: gl, to: USDT, value: 0n, data: SEvmTx.erc20Transfer(scan.main, amt), chainId: CHAIN }, k.key);
      await sendRaw(tx.raw, tx.hash); log(`Chuyển ${fmt(amt)} USDT #${a.index} → ví chính: ${link(tx.hash)}`);
      await waitReceipt(tx.hash, 'Chuyển USDT #' + a.index); ok++; log(`  ✓ #${a.index} đã xác nhận`);
    }
    log(`<b>Xong: đã gom ${ok}/${scan.todo.length} địa chỉ.</b> Quét lại để kiểm tra số dư.`);
  } catch (e) { log(`<span style="color:var(--bad)">Dừng: ${esc(e.message)}</span> (đã gom ${ok} địa chỉ). Quét lại trước khi chạy tiếp.`); }
  finally { busy = false; $('stop').hidden = true; wipe(false); }
}
function wipe(all = true) {
  keys = null; $('m').value = ''; $('pp').value = ''; $('fee').value = ''; resetConfirm(); say('kst', all ? 'Đã xoá khoá khỏi trang.' : 'Đã xoá khoá khỏi trang sau khi gửi.');
  if (all) { $('log').innerHTML = ''; $('log').hidden = true; }
}
$('scan').onclick = doScan; $('check').onclick = doCheck; $('send').onclick = doSend; $('stop').onclick = () => { stopReq = true; log('Sẽ dừng sau bước hiện tại…'); };
$('ack').onchange = gate; $('word').oninput = gate; $('clr').onclick = () => wipe(true);
for (const id of ['m', 'pp', 'fee']) $(id).oninput = () => { keys = null; resetConfirm(); };
for (const id of ['main', 'min', 'gl', 'xpub', 'start', 'count', 'rpc']) $(id).onchange = () => { scan = null; keys = null; $('signc').hidden = true; $('plan').hidden = true; resetConfirm(); };
window.addEventListener('pagehide', () => wipe(true));
