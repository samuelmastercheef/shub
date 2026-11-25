// Dựng và ký giao dịch EVM kiểu legacy (EIP-155) cho trang gom tiền. Không gọi mạng; chỉ trả về giao dịch đã ký dạng hex.
// Dùng lõi ký của xpub-core.js (SXpub.signHash). Chạy được trong Node để test.
(function (g) {
  'use strict';
  const X = g.SXpub || (typeof require === 'function' ? require('./xpub-core.js') : null);
  const cat = (...a) => { const o = new Uint8Array(a.reduce((t, x) => t + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
  const bn = (n) => { n = BigInt(n); if (n < 0n) throw new Error('số âm'); if (n === 0n) return new Uint8Array(0); let h = n.toString(16); if (h.length % 2) h = '0' + h; return X.unhex(h); };
  const bytes = (h) => { const s = String(h || '').replace(/^0x/i, ''); if (s.length % 2 || /[^0-9a-f]/i.test(s)) throw new Error('hex không hợp lệ'); return X.unhex(s); };
  const rlpLen = (len, off) => (len < 56 ? Uint8Array.of(off + len) : (() => { const l = bn(len); return cat(Uint8Array.of(off + 55 + l.length), l); })());
  const rlp = (x) => {
    if (Array.isArray(x)) { const body = cat(...x.map(rlp)); return cat(rlpLen(body.length, 0xc0), body); }
    if (x.length === 1 && x[0] < 0x80) return x; return cat(rlpLen(x.length, 0x80), x);
  };
  const addr = (a) => { if (!/^0x[0-9a-fA-F]{40}$/.test(String(a))) throw new Error('địa chỉ EVM không hợp lệ: ' + a); return bytes(a); };

  async function signLegacy(tx, key) {
    const chainId = BigInt(tx.chainId);
    const f = [bn(tx.nonce), bn(tx.gasPrice), bn(tx.gasLimit), addr(tx.to), bn(tx.value || 0), bytes(tx.data || '')];
    const h = X.keccak256(rlp([...f, bn(chainId), new Uint8Array(0), new Uint8Array(0)]));
    const s = await X.signHash(h, key);
    const raw = rlp([...f, bn(BigInt(s.rec & 1) + chainId * 2n + 35n), bn(s.r), bn(s.s)]);
    return { raw: '0x' + X.hex(raw), hash: '0x' + X.hex(X.keccak256(raw)) };
  }
  // transfer(address,uint256) = 0xa9059cbb
  const erc20Transfer = (to, amount) => '0xa9059cbb' + X.hex(addr(to)).padStart(64, '0') + BigInt(amount).toString(16).padStart(64, '0');
  const erc20BalanceOf = (who) => '0x70a08231' + X.hex(addr(who)).padStart(64, '0');

  const api = { signLegacy, erc20Transfer, erc20BalanceOf, rlp };
  g.SEvmTx = api; if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
