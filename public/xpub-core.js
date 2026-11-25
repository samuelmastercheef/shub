// S Xpub: tính xpub và địa chỉ nạp BEP20/EVM hoặc TRC20 (Tron) ngay trong trình duyệt. Không phụ thuộc thư viện, không gọi mạng.
// Chạy được cả trong Node (để đối chiếu với @scure/bip32).
(function (g) {
  'use strict';
  const nodeCrypto = typeof module !== 'undefined' && typeof require === 'function' ? require('crypto') : null;
  const C = g.crypto && g.crypto.subtle ? g.crypto : nodeCrypto.webcrypto;
  const te = new TextEncoder();
  const cat = (...a) => { const o = new Uint8Array(a.reduce((t, x) => t + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
  const hex = (u) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');
  const unhex = (h) => Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));
  const big = (u) => (u.length ? BigInt('0x' + hex(u)) : 0n);
  const ser256 = (n) => unhex(n.toString(16).padStart(64, '0'));
  const ser32 = (n) => Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  const sha256 = async (d) => new Uint8Array(await C.subtle.digest('SHA-256', d));
  const hmac512 = async (key, data) => { const k = await C.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']); return new Uint8Array(await C.subtle.sign('HMAC', k, data)); };

  // ---- secp256k1 (Jacobian) ----
  const P = 2n ** 256n - 2n ** 32n - 977n, N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n, GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
  const mod = (a, m = P) => { const r = a % m; return r >= 0n ? r : r + m; };
  const pow = (b, e, m) => { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; } return r; };
  const inv = (a) => pow(a, P - 2n, P);
  const jdbl = (p) => { if (!p || p[1] === 0n) return null; const [x, y, z] = p, yy = (y * y) % P, s = (4n * x * yy) % P, m = (3n * x * x) % P, x3 = mod(m * m - 2n * s), y3 = mod(m * (s - x3) - 8n * yy * yy); return [x3, y3, (2n * y * z) % P]; };
  const jadd = (p, q) => {
    if (!p) return q; if (!q) return p; const [x1, y1, z1] = p, [x2, y2, z2] = q, z1z = (z1 * z1) % P, z2z = (z2 * z2) % P, u1 = (x1 * z2z) % P, u2 = (x2 * z1z) % P, s1 = (y1 * z2 * z2z) % P, s2 = (y2 * z1 * z1z) % P;
    if (u1 === u2) return s1 === s2 ? jdbl(p) : null; const h = mod(u2 - u1), r = mod(s2 - s1), hh = (h * h) % P, hhh = (h * hh) % P, v = (u1 * hh) % P, x3 = mod(r * r - hhh - 2n * v);
    return [x3, mod(r * (v - x3) - s1 * hhh), (h * z1 * z2) % P];
  };
  const mulG = (k) => { let r = null, a = [GX, GY, 1n]; while (k > 0n) { if (k & 1n) r = jadd(r, a); a = jdbl(a); k >>= 1n; } if (!r) throw new Error('khóa không hợp lệ'); const zi = inv(r[2]), zi2 = (zi * zi) % P; return [(r[0] * zi2) % P, (r[1] * zi2 * zi) % P]; };
  const pubC = (pt) => cat(Uint8Array.of(pt[1] & 1n ? 3 : 2), ser256(pt[0]));
  const pubU = (pt) => cat(ser256(pt[0]), ser256(pt[1]));

  // ---- Keccak-256 (Ethereum, đệm 0x01) ----
  const M64 = (1n << 64n) - 1n, RC = [], ROT = [[0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14]];
  (() => { let r = 1; for (let i = 0; i < 24; i++) { let c = 0n; for (let j = 0; j < 7; j++) { if (r & 1) c |= 1n << BigInt((1 << j) - 1); r = r & 0x80 ? (r << 1) ^ 0x171 : r << 1; } RC.push(c); } })();
  const rol = (x, n) => (n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M64);
  const keccakF = (s) => {
    for (let rd = 0; rd < 24; rd++) {
      const c = [0, 1, 2, 3, 4].map((x) => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]);
      for (let x = 0; x < 5; x++) { const d = c[(x + 4) % 5] ^ rol(c[(x + 1) % 5], 1); for (let y = 0; y < 25; y += 5) s[y + x] ^= d; }
      const b = new Array(25); for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) b[y + 5 * ((2 * x + 3 * y) % 5)] = rol(s[x + 5 * y], ROT[x][y]);
      for (let y = 0; y < 25; y += 5) for (let x = 0; x < 5; x++) s[y + x] = b[y + x] ^ (~b[y + (x + 1) % 5] & M64 & b[y + (x + 2) % 5]);
      s[0] ^= RC[rd];
    }
  };
  const keccak256 = (msg) => {
    const rate = 136, pl = rate - (msg.length % rate), p = new Uint8Array(msg.length + pl); p.set(msg); p[msg.length] ^= 1; p[p.length - 1] ^= 0x80;
    const s = new Array(25).fill(0n);
    for (let o = 0; o < p.length; o += rate) { for (let i = 0; i < rate / 8; i++) { let v = 0n; for (let j = 7; j >= 0; j--) v = (v << 8n) | BigInt(p[o + i * 8 + j]); s[i] ^= v; } keccakF(s); }
    const out = new Uint8Array(32); for (let i = 0; i < 4; i++) for (let j = 0; j < 8; j++) out[i * 8 + j] = Number((s[i] >> BigInt(8 * j)) & 255n); return out;
  };

  // ---- RIPEMD-160 ----
  const ripemd160 = (msg) => {
    const R1 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8, 3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12, 1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2, 4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13];
    const R2 = [5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12, 6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2, 15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13, 8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14, 12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11];
    const S1 = [11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8, 7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12, 11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5, 11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12, 9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6];
    const S2 = [8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6, 9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11, 9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5, 15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8, 8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11];
    const K1 = [0, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e], K2 = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0];
    const f = (j, x, y, z) => (j < 16 ? x ^ y ^ z : j < 32 ? (x & y) | (~x & z) : j < 48 ? (x | ~y) ^ z : j < 64 ? (x & z) | (y & ~z) : x ^ (y | ~z));
    const l = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;
    const len = msg.length, padl = (len + 9 + 63) & ~63, p = new Uint8Array(padl); p.set(msg); p[len] = 0x80; const bits = BigInt(len) * 8n; for (let i = 0; i < 8; i++) p[padl - 8 + i] = Number((bits >> BigInt(8 * i)) & 255n);
    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    for (let o = 0; o < padl; o += 64) {
      const X = []; for (let i = 0; i < 16; i++) X.push((p[o + i * 4] | (p[o + i * 4 + 1] << 8) | (p[o + i * 4 + 2] << 16) | (p[o + i * 4 + 3] << 24)) >>> 0);
      let a1 = h0, b1 = h1, c1 = h2, d1 = h3, e1 = h4, a2 = h0, b2 = h1, c2 = h2, d2 = h3, e2 = h4;
      for (let j = 0; j < 80; j++) {
        const r = (j / 16) | 0;
        let t = (l((a1 + f(j, b1, c1, d1) + X[R1[j]] + K1[r]) >>> 0, S1[j]) + e1) >>> 0; a1 = e1; e1 = d1; d1 = l(c1, 10); c1 = b1; b1 = t;
        t = (l((a2 + f(79 - j, b2, c2, d2) + X[R2[j]] + K2[r]) >>> 0, S2[j]) + e2) >>> 0; a2 = e2; e2 = d2; d2 = l(c2, 10); c2 = b2; b2 = t;
      }
      const t = (h1 + c1 + d2) >>> 0; h1 = (h2 + d1 + e2) >>> 0; h2 = (h3 + e1 + a2) >>> 0; h3 = (h4 + a1 + b2) >>> 0; h4 = (h0 + b1 + c2) >>> 0; h0 = t;
    }
    const out = new Uint8Array(20); [h0, h1, h2, h3, h4].forEach((h, i) => { for (let j = 0; j < 4; j++) out[i * 4 + j] = (h >>> (8 * j)) & 255; }); return out;
  };

  // ---- Base58Check ----
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const b58check = async (payload) => { const chk = (await sha256(await sha256(payload))).slice(0, 4), d = cat(payload, chk); let n = big(d), s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } for (const b of d) { if (b === 0) s = '1' + s; else break; } return s; };

  // ---- BIP39 ----
  const nfkd = (s) => String(s).normalize('NFKD');
  const normM = (m) => String(m).trim().toLowerCase().replace(/\s+/g, ' ');
  async function entropyToMnemonic(ent, words) {
    const cs = ent.length / 4; const h = await sha256(ent); let bits = ''; for (const b of ent) bits += b.toString(2).padStart(8, '0'); bits += h[0].toString(2).padStart(8, '0').slice(0, cs);
    const out = []; for (let i = 0; i < bits.length; i += 11) out.push(words[parseInt(bits.slice(i, i + 11), 2)]); return out.join(' ');
  }
  async function generateMnemonic(words, strength = 128) { return entropyToMnemonic(C.getRandomValues(new Uint8Array(strength / 8)), words); }
  async function validateMnemonic(m, words) {
    const w = normM(m).split(' '); if (![12, 15, 18, 21, 24].includes(w.length)) return false; let bits = '';
    for (const x of w) { const i = words.indexOf(x); if (i < 0) return false; bits += i.toString(2).padStart(11, '0'); }
    const entLen = (bits.length / 33) * 32, ent = new Uint8Array(entLen / 8); for (let i = 0; i < ent.length; i++) ent[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
    const h = await sha256(ent); return h[0].toString(2).padStart(8, '0').slice(0, entLen / 32) === bits.slice(entLen);
  }
  async function mnemonicToSeed(m, pass = '') {
    const k = await C.subtle.importKey('raw', te.encode(nfkd(normM(m))), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await C.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-512', salt: te.encode('mnemonic' + nfkd(pass)), iterations: 2048 }, k, 512));
  }

  // ---- BIP32 ----
  const master = async (seed) => { const I = await hmac512(te.encode('Bitcoin seed'), seed); return { k: big(I.slice(0, 32)), c: I.slice(32) }; };
  async function child(node, i) {
    const hard = i >= 0x80000000, data = hard ? cat(Uint8Array.of(0), ser256(node.k), ser32(i)) : cat(pubC(mulG(node.k)), ser32(i)), I = await hmac512(node.c, data), il = big(I.slice(0, 32)), k = (il + node.k) % N;
    if (il >= N || k === 0n) throw new Error('chỉ số không hợp lệ, thử lại với cụm từ khác'); return { k, c: I.slice(32) };
  }
  const eip55 = (h) => { const lo = h.toLowerCase(), hh = hex(keccak256(te.encode(lo))); return '0x' + [...lo].map((ch, i) => (parseInt(hh[i], 16) >= 8 ? ch.toUpperCase() : ch)).join(''); };
  const addrOf = (pt) => eip55(hex(keccak256(pubU(pt)).slice(-20)));

  // ---- Mạng hỗ trợ ----
  // evm: BEP20 (BSC), ERC20, Polygon… dùng chung địa chỉ m/44'/60'. tron: TRC20, m/44'/195', địa chỉ T… (base58, tiền tố 0x41).
  const COINS = { evm: { coin: 60, name: 'BEP20 / ERC20 (EVM)' }, tron: { coin: 195, name: 'TRC20 (Tron)' } };
  const coinOf = (net) => { const c = COINS[net || 'evm']; if (!c) throw new Error('mạng không hỗ trợ: ' + net); return c; };
  const tronAddr = async (pt) => b58check(cat(Uint8Array.of(0x41), keccak256(pubU(pt)).slice(-20)));
  const addrFor = async (net, pt) => (net === 'tron' ? tronAddr(pt) : addrOf(pt));
  const MAXN = 1000, H = 0x80000000;
  const range = (start, count) => {
    start = Number(start) || 0; count = count == null ? 3 : Number(count);
    if (!Number.isInteger(start) || start < 0 || start >= H) throw new Error('vị trí bắt đầu phải là số nguyên từ 0');
    if (!Number.isInteger(count) || count < 1 || count > MAXN) throw new Error('số địa chỉ phải từ 1 đến ' + MAXN);
    if (start + count > H) throw new Error('vượt quá chỉ số tối đa'); return [start, count];
  };

  // m/44'/coin'/0'/0 -> xpub + địa chỉ m/44'/coin'/0'/0/i (i = start … start+count-1)
  async function deriveAccount(mnemonic, { count = 3, start = 0, passphrase = '', network = 'evm', withKeys = false } = {}) {
    const { coin } = coinOf(network); [start, count] = range(start, count);
    const seed = await mnemonicToSeed(mnemonic, passphrase); let n = await master(seed);
    for (const i of [44 + H, coin + H, 0 + H]) n = await child(n, i);
    const parentPub = pubC(mulG(n.k)); const ext = await child(n, 0), extPub = pubC(mulG(ext.k)), fp = ripemd160(await sha256(parentPub)).slice(0, 4);
    const xpub = await b58check(cat(unhex('0488b21e'), Uint8Array.of(4), fp, ser32(0), ext.c, extPub));
    const addrs = [];
    for (let i = start; i < start + count; i++) { const c = await child(ext, i), a = { index: i, address: await addrFor(network, mulG(c.k)) }; if (withKeys) a.key = c.k; addrs.push(a); }
    return { xpub, network, path: `m/44'/${coin}'/0'/0`, addresses: addrs };
  }

  // ---- Suy địa chỉ chỉ từ xpub (không cần cụm từ, an toàn để tra cứu) ----
  const b58decode = async (s) => {
    s = String(s).trim(); let n = 0n; for (const ch of s) { const v = B58.indexOf(ch); if (v < 0) throw new Error('ký tự không hợp lệ trong xpub'); n = n * 58n + BigInt(v); }
    let h = n.toString(16); if (h.length % 2) h = '0' + h; let zeros = 0; for (const ch of s) { if (ch === '1') zeros++; else break; }
    const d = cat(new Uint8Array(zeros), n ? unhex(h) : new Uint8Array(0)); if (d.length < 5) throw new Error('xpub quá ngắn');
    const body = d.slice(0, -4), chk = (await sha256(await sha256(body))).slice(0, 4);
    if (hex(chk) !== hex(d.slice(-4))) throw new Error('xpub sai checksum (gõ nhầm hoặc thiếu ký tự)'); return body;
  };
  const liftX = (b) => { // khôi phục điểm từ khoá công khai nén 33 byte
    if (b.length !== 33 || (b[0] !== 2 && b[0] !== 3)) throw new Error('khoá công khai không hợp lệ');
    const x = big(b.slice(1)); if (x >= P) throw new Error('khoá công khai không hợp lệ');
    const y2 = mod(x * x * x + 7n); let y = pow(y2, (P + 1n) / 4n, P); if ((y * y) % P !== y2) throw new Error('điểm không nằm trên đường cong');
    if ((y & 1n) !== BigInt(b[0] & 1)) y = P - y; return [x, y];
  };
  const toAff = (j) => { if (!j) throw new Error('điểm vô cực'); const zi = inv(j[2]), zi2 = (zi * zi) % P; return [(j[0] * zi2) % P, (j[1] * zi2 * zi) % P]; };
  async function parseXpub(xpub) {
    if (/^[xyzt]prv/i.test(String(xpub).trim())) throw new Error('đây là khoá riêng (xprv), không nhập vào đây');
    const b = await b58decode(xpub); if (b.length !== 78) throw new Error('xpub phải dài 78 byte sau giải mã');
    if (hex(b.slice(0, 4)) !== '0488b21e') throw new Error('chỉ nhận xpub chuẩn (bắt đầu bằng xpub)');
    return { depth: b[4], c: b.slice(13, 45), pt: liftX(b.slice(45)) };
  }
  async function pubChild(node, i) {
    if (i >= H) throw new Error('xpub không suy được chỉ số hardened');
    const I = await hmac512(node.c, cat(pubC(node.pt), ser32(i))), il = big(I.slice(0, 32)); if (il >= N) throw new Error('chỉ số không hợp lệ');
    const g = mulG(il); return { c: I.slice(32), pt: toAff(jadd([g[0], g[1], 1n], [node.pt[0], node.pt[1], 1n])) };
  }
  async function addressesFromXpub(xpub, { start = 0, count = 3, network = 'evm' } = {}) {
    coinOf(network); [start, count] = range(start, count); const node = await parseXpub(xpub), out = [];
    for (let i = start; i < start + count; i++) out.push({ index: i, address: await addrFor(network, (await pubChild(node, i)).pt) });
    return out;
  }

  // ---- Ký ECDSA secp256k1 (RFC 6979, low-s) cho trang gom tiền ----
  const hmac256 = async (key, data) => { const k = await C.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return new Uint8Array(await C.subtle.sign('HMAC', k, data)); };
  async function signHash(hash32, d) {
    if (!(d > 0n && d < N)) throw new Error('khoá riêng không hợp lệ');
    const x = ser256(d), h1 = ser256(big(hash32) % N); let V = new Uint8Array(32).fill(1), K = new Uint8Array(32);
    K = await hmac256(K, cat(V, Uint8Array.of(0), x, h1)); V = await hmac256(K, V); K = await hmac256(K, cat(V, Uint8Array.of(1), x, h1)); V = await hmac256(K, V);
    const z = big(hash32);
    for (;;) {
      V = await hmac256(K, V); const k = big(V);
      if (k > 0n && k < N) {
        const R = mulG(k), r = R[0] % N;
        if (r !== 0n) { let s = (pow(k, N - 2n, N) * ((z + r * d) % N)) % N; let rec = Number(R[1] & 1n) | (R[0] >= N ? 2 : 0); if (s > N / 2n) { s = N - s; rec ^= 1; } if (s !== 0n) return { r, s, rec }; }
      }
      K = await hmac256(K, cat(V, Uint8Array.of(0))); V = await hmac256(K, V);
    }
  }
  const keyFromHex = (h) => { const m = String(h).trim().replace(/^0x/i, ''); if (!/^[0-9a-f]{64}$/i.test(m)) throw new Error('khoá riêng phải là 64 ký tự hex'); const d = BigInt('0x' + m); if (!(d > 0n && d < N)) throw new Error('khoá riêng không hợp lệ'); return d; };
  const evmAddressOfKey = (d) => addrOf(mulG(d));

  const checksumAddress = (a) => { if (!/^0x[0-9a-fA-F]{40}$/.test(String(a))) throw new Error('địa chỉ EVM không hợp lệ'); const c = eip55(a.slice(2)); if (a !== a.toLowerCase() && a.slice(2) !== a.slice(2).toUpperCase() && a !== c) throw new Error('địa chỉ sai checksum (gõ nhầm?)'); return c; };
  const api = { checksumAddress, generateMnemonic, validateMnemonic, deriveAccount, addressesFromXpub, parseXpub, mnemonicToSeed, keccak256, ripemd160, hex, unhex, signHash, keyFromHex, evmAddressOfKey, COINS };
  g.SXpub = api; if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
