// Test S Xpub: lõi mật mã khớp vector chuẩn BIP39/BIP32 (EVM + Tron), ký giao dịch khớp ethers, QR, trang offline bị chặn mạng (CSP),
// trang gom tiền chỉ nói chuyện với RPC trong danh sách (giả lập bằng Playwright), và đăng ký trong S Hub.
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), { spawn } = require('child_process');
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL', m)); if (c) console.log('ok  ', m); };
const core = require('./public/xpub-core.js'), W = require('./public/xpub-words.js'), QR = require('./public/xpub-qr.js'), TX = require('./public/evm-tx.js');
(async () => {
  ok(W.length === 2048 && W[0] === 'abandon' && W[2047] === 'zoo', 'danh sách BIP39 đủ 2048 từ');
  const A = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  ok(await core.validateMnemonic(A, W), 'chấp nhận cụm từ chuẩn');
  ok(!(await core.validateMnemonic(A.replace('about', 'abandon'), W)) && !(await core.validateMnemonic('abandon abandon', W)) && !(await core.validateMnemonic(A.replace('about', 'zzzz'), W)), 'từ chối sai checksum / sai số từ / từ lạ');
  const r = await core.deriveAccount(A);
  ok(r.xpub === 'xpub6EF8jXqFeFEW5bwMU7RpQtHkzE4KJxcqJtvkCjJumzW8CPpacXkb92ek4WzLQXjL93HycJwTPUAcuNxCqFPKKU5m5Z2Vq4nCyh5CyPeBFFr' && r.xpub.length === 111, 'xpub m/44\'/60\'/0\'/0 khớp tool gen-xpub gốc (@scure) và dài 111');
  ok(r.addresses.length === 3 && r.addresses[0].address === '0x9858EfFD232B4033E47d90003D41EC34EcaEda94', 'địa chỉ #0 khớp ví chuẩn MetaMask của cụm abandon…about');
  ok(core.hex(core.keccak256(new TextEncoder().encode(''))) === 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470', 'keccak256 rỗng đúng');
  ok(core.hex(core.ripemd160(new TextEncoder().encode('abc'))) === '8eb208f7e05d987a9b044a8e98c6b087f15a0bfc', 'ripemd160 đúng');
  const g = await core.generateMnemonic(W, 128), g2 = await core.generateMnemonic(W, 256);
  ok(g.split(' ').length === 12 && g2.split(' ').length === 24 && (await core.validateMnemonic(g, W)) && (await core.validateMnemonic(g2, W)) && g !== (await core.generateMnemonic(W, 128)), 'tạo cụm 12/24 từ hợp lệ và ngẫu nhiên');
  // TRC20, passphrase, địa chỉ thứ i, tra từ xpub (vector lấy từ ethers + tronweb)
  const t = await core.deriveAccount(A, { network: 'tron', start: 0, count: 8 });
  ok(t.xpub === 'xpub6EuK4CZWW5urEHdwAVDdDw327danAtccFcrXYvgf1DHrPXRwErt36xStQ2PNhn4hpwzPbzJ8pJVpewgChRnSs59q5Ay61GCfQZKUe71gbLq' && t.path === "m/44'/195'/0'/0", 'xpub TRC20 m/44\'/195\'/0\'/0 khớp chuẩn');
  ok(t.addresses[0].address === 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH' && t.addresses[7].address === 'TFj86XAQYBPvwUknt9yxmbc4k3zwUC7iVW', 'địa chỉ Tron #0, #7 khớp TronWeb');
  const p = await core.deriveAccount(A, { passphrase: 'Tr3zor', count: 1 });
  ok(p.xpub === 'xpub6DcXbRiSZuNV5KY36eW7RV7xjvaUxb8Fk5CF5wZxb8BfM2yP22watZvuSKFkVrsQhq8XnekHzqVSC71tSAn2QvqKj724m6UBA8v9YbBU7kH' && p.addresses[0].address === '0xD6a731794Be249b26DEE58d57103A5Cc7F0767cC', 'passphrase cho xpub và địa chỉ khác, khớp chuẩn');
  const i42 = await core.deriveAccount(A, { start: 42, count: 1 });
  ok(i42.addresses[0].index === 42 && i42.addresses[0].address === '0x1d918a9cF80FF04A837da847FB74bA41302476FB', 'địa chỉ thứ i bất kỳ (#42)');
  const fx = await core.addressesFromXpub(r.xpub, { start: 40, count: 3 }), ft = await core.addressesFromXpub(t.xpub, { network: 'tron', start: 7, count: 1 });
  ok(fx[2].address === i42.addresses[0].address && ft[0].address === t.addresses[7].address, 'suy địa chỉ chỉ từ xpub (EVM + Tron) khớp suy từ cụm từ');
  const bad = async (f) => { try { await f(); return false; } catch { return true; } };
  ok((await bad(() => core.addressesFromXpub(r.xpub.slice(0, -1) + 's'))) && (await bad(() => core.addressesFromXpub('xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi'))) && (await bad(() => core.deriveAccount(A, { count: 1001 }))), 'từ chối xpub sai checksum, xprv, quá 1000 địa chỉ');
  // Ký giao dịch: byte-identical với ethers v6 (vector tạo bằng Wallet.signTransaction)
  const d = 0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318n;
  const stx = await TX.signLegacy({ nonce: 7, gasPrice: 3000000000n, gasLimit: 65000, to: '0x55d398326f99059fF775485246999027B3197955', value: 0, data: TX.erc20Transfer('0x9858EfFD232B4033E47d90003D41EC34EcaEda94', 5n * 10n ** 18n), chainId: 56 }, d);
  ok(stx.raw === '0xf8a90784b2d05e0082fde89455d398326f99059ff775485246999027b319795580b844a9059cbb0000000000000000000000009858effd232b4033e47d90003d41ec34ecaeda940000000000000000000000000000000000000000000000004563918244f400008194a07bc8ac5d3648f5c033fcd0f08b7c7ef818177ce7f3a763988802278964dc037aa059ca07d3341908e2c41b4d241e0e2ed2271aafdec0aa18180dfcacb3e10a2639' && stx.hash === '0x420d1ecc04b3e6d3192cfef7aa95416892b8fb8fcc72442c0f2d0596961cc82b', 'ký giao dịch USDT BEP20 (EIP-155, RFC 6979) khớp ethers');
  ok(core.evmAddressOfKey(d) === '0x2c7536E3605D9C16a7a3D7b1898e529396a65c23' && (await bad(() => core.checksumAddress('0x9858EfFD232B4033E47d90003D41EC34EcaEdA94'))), 'địa chỉ từ khoá riêng, bắt lỗi checksum địa chỉ');
  // QR
  const q = QR.encode(r.xpub); ok(q.version === 7 && q.size === 45 && /<svg/.test(QR.svg(r.xpub)), 'QR xpub phiên bản 7');
  let jsQR = null; try { jsQR = require('jsqr'); } catch {}
  if (jsQR) {
    const dec = (txt) => { const e = QR.encode(txt), sc = 4, b = 4, n = (e.size + 2 * b) * sc, img = new Uint8ClampedArray(n * n * 4).fill(255); for (let y = 0; y < e.size; y++) for (let x = 0; x < e.size; x++) if (e.modules[y][x]) for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++) { const o = (((y + b) * sc + dy) * n + (x + b) * sc + dx) * 4; img[o] = img[o + 1] = img[o + 2] = 0; } const res = jsQR(img, n, n); return res && res.data; };
    ok([r.xpub, t.addresses[0].address, r.addresses[0].address, A, 'x'.repeat(700)].every((x) => dec(x) === x), 'QR giải mã lại đúng (jsQR)');
  } else console.log('skip QR giải mã (chưa cài jsqr)');
  const html = fs.readFileSync(path.join(__dirname, 'public/xpub.html'), 'utf8');
  ok(/connect-src 'none'/.test(html) && /default-src 'none'/.test(html) && !/<script>(?!\s*<)/.test(html.replace(/<script src="[^"]+"><\/script>/g, '')) && !/https?:\/\//.test(html.replace(/<meta[^>]*>/g, '')), 'trang chặn kết nối mạng (CSP), không script inline, không link ngoài');
  const js = ['xpub.js', 'xpub-core.js', 'xpub-qr.js', 'evm-tx.js'].map((f) => fs.readFileSync(path.join(__dirname, 'public', f), 'utf8')).join('\n');
  ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB/.test(js), 'mã offline (S Xpub, QR, ký giao dịch) không có lệnh gọi mạng hay lưu trữ');
  const sw = fs.readFileSync(path.join(__dirname, 'public/sweep.html'), 'utf8'), cs = (sw.match(/connect-src ([^;"]+)/) || [])[1] || '';
  ok(cs.split(/\s+/).filter(Boolean).every((h) => /^https:\/\/(bsc-dataseed\.bnbchain\.org|bsc-dataseed1\.binance\.org|bsc-rpc\.publicnode\.com)$/.test(h)) && /default-src 'none'/.test(sw) && !/localStorage|sessionStorage|indexedDB|sendBeacon|WebSocket/.test(fs.readFileSync(path.join(__dirname, 'public/sweep.js'), 'utf8')), 'trang gom tiền chỉ được kết nối tới RPC BSC trong danh sách, không lưu trữ');
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'shubx-')); fs.writeFileSync(path.join(T, 'c.json'), JSON.stringify({ workspace: path.join(T, 'ws'), port: 4793 }));
  const s = spawn('node', ['server.js'], { env: { ...process.env, SHUB_CONFIG: path.join(T, 'c.json'), SHUB_NO_TIMER: '1' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const get = (p) => new Promise((res) => http.get('http://127.0.0.1:4793' + p, (q) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => res({ s: q.statusCode, b })); }).on('error', () => res({ s: 0, b: '' })));
  const apps = JSON.parse((await get('/api/apps')).b); const list = apps.apps || apps;
  ok(list.some((a) => a.id === 'xpub' && a.type === 'internal'), 'S Xpub có trong danh sách công cụ của S Hub');
  ok((await get('/xpub.html')).s === 200 && (await get('/xpub-core.js')).s === 200 && (await get('/xpub-words.js')).s === 200 && (await get('/xpub.js')).s === 200, 'S Hub phục vụ đủ các file của S Xpub');
  let ui = '', ui2 = '', sweep = '';
  try {
    const pw = require('playwright'), b = await pw.chromium.launch(), pg = await b.newPage(), reqs = []; pg.on('request', (q) => reqs.push(q.url()));
    await pg.goto('http://127.0.0.1:4793/xpub.html'); await pg.fill('#m', A); await pg.click('#go'); await pg.waitForSelector('#out:not([hidden])', { timeout: 15000 });
    const xp = await pg.textContent('#xp'); await pg.fill('#cmp', '0x9858effd232b4033e47d90003d41ec34ecaeda94'); const cm = await pg.textContent('#cmpr');
    await pg.fill('#m', 'xprv9s21ZrQH143K'); await pg.click('#go'); const er = await pg.textContent('#st');
    await pg.click('#gen'); await pg.waitForSelector('#newseed:not([hidden])'); const words = (await pg.$$('#seed span')).length;
    ui = JSON.stringify({ xp: xp === r.xpub, cm: /khớp #0/.test(cm), er: /Không nhập xprv/.test(er), words, ext: reqs.filter((u) => !u.startsWith('http://127.0.0.1:4793/')).length });
    // TRC20 + vị trí + QR + CSV + in
    await pg.fill('#m', A); await pg.selectOption('#net', 'tron'); await pg.fill('#start', '7'); await pg.fill('#count', '2'); await pg.click('#go'); await pg.waitForFunction(() => /Xong/.test(document.getElementById('st').textContent));
    const tr = await pg.$$eval('#ad tr td:nth-child(2)', (x) => x.map((e) => e.textContent));
    await pg.click('#ad [data-qr]'); const qrOk = await pg.$eval('#qr', (e) => !!e.querySelector('svg'));
    const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#csv')]); const csv = fs.readFileSync(await dl.path(), 'utf8');
    await pg.evaluate(() => { window.print = () => { window._printed = document.getElementById('print').innerHTML; }; }); await pg.check('#pseed'); await pg.click('#prt'); const printed = await pg.evaluate(() => window._printed || '');
    await pg.selectOption('#net', 'evm'); await pg.fill('#start', '0'); await pg.fill('#count', '1'); await pg.fill('#pp', 'Tr3zor'); await pg.click('#go'); await pg.waitForFunction(() => /Xong/.test(document.getElementById('st').textContent));
    const ppx = await pg.textContent('#xp'), ppw = await pg.isVisible('#ppw');
    await pg.fill('#xin', r.xpub); await pg.fill('#xstart', '42'); await pg.fill('#xcount', '1'); await pg.click('#xgo'); await pg.waitForSelector('#xtb:not([hidden])'); const lk = await pg.textContent('#xad td:nth-child(2)');
    const u2 = { tr: tr[0] === t.addresses[7].address && tr.length === 2, qrOk, csv: csv.includes(`7,${t.addresses[7].address},m/44'/195'/0'/0/7`), print: printed.includes(t.xpub) && printed.includes('CỤM TỪ') && printed.includes('<svg'), pp: ppx === p.xpub && ppw, lk: lk === i42.addresses[0].address, ext: reqs.filter((u) => !u.startsWith('http://127.0.0.1:4793/')).length };
    ui2 = JSON.stringify(u2);
    // Trang gom tiền với RPC giả lập
    const dep = (await core.deriveAccount(A, { count: 5 })).addresses.map((a) => a.address.toLowerCase()), E = 10n ** 18n;
    const usdt = { [dep[1]]: 5n * E, [dep[3]]: E / 2n, [dep[4]]: 2n * E }, bnb = { [dep[4]]: E }, sent = [], other = [];
    const sp = await b.newPage(); sp.on('request', (q) => { const u = q.url(); if (!u.startsWith('http://127.0.0.1:4793/') && !u.startsWith('https://bsc-dataseed.bnbchain.org')) other.push(u); });
    await sp.route(/bsc-dataseed\.bnbchain\.org/, async (route) => {
      const H = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST', 'content-type': 'application/json' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: H });
      const reqs2 = JSON.parse(route.request().postData()), hx = (n) => '0x' + n.toString(16);
      const res = reqs2.map(({ id, method, params }) => {
        let result = null;
        if (method === 'eth_chainId') result = '0x38'; else if (method === 'eth_gasPrice') result = hx(10n ** 9n);
        else if (method === 'eth_getBalance') result = hx(bnb[params[0].toLowerCase()] || (params[0].toLowerCase() === '0x2c7536e3605d9c16a7a3d7b1898e529396a65c23' ? E : 0n));
        else if (method === 'eth_call') result = '0x' + (usdt['0x' + params[0].data.slice(-40)] || 0n).toString(16).padStart(64, '0');
        else if (method === 'eth_getTransactionCount') result = '0x0';
        else if (method === 'eth_sendRawTransaction') { sent.push(params[0]); result = '0x' + core.hex(core.keccak256(core.unhex(params[0].slice(2)))); }
        else if (method === 'eth_getTransactionReceipt') result = { status: '0x1' };
        return { jsonrpc: '2.0', id, result };
      });
      route.fulfill({ status: 200, headers: H, body: JSON.stringify(res) });
    });
    await sp.goto('http://127.0.0.1:4793/sweep.html');
    await sp.fill('#main', dep[0]); await sp.fill('#xpub', r.xpub); await sp.fill('#count', '5'); await sp.click('#scan'); await sp.waitForFunction(() => /Lỗi|Đã quét/.test(document.getElementById('sst').textContent));
    const same = await sp.textContent('#sst');
    await sp.fill('#main', '0x000000000000000000000000000000000000dEaD'); await sp.dispatchEvent('#main', 'change'); await sp.click('#scan'); await sp.waitForFunction(() => /Lỗi|Đã quét/.test(document.getElementById('sst').textContent));
    const plan = await sp.textContent('#plan');
    await sp.fill('#m', 'legal winner thank year wave sausage worth useful legal winner thank yellow'); await sp.click('#check'); await sp.waitForFunction(() => /Lỗi|khớp/.test(document.getElementById('kst').textContent));
    const wrong = await sp.textContent('#kst');
    await sp.fill('#m', A); await sp.fill('#fee', '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318'); await sp.click('#check'); await sp.waitForSelector('#confirmw:not([hidden])');
    const lockedBefore = await sp.isDisabled('#send'); await sp.check('#ack'); await sp.fill('#word', 'GOM');
    await sp.click('#send'); await sp.waitForFunction(() => /Xong|Dừng/.test(document.getElementById('log').textContent), null, { timeout: 30000 });
    const lg = await sp.textContent('#log'), wiped = (await sp.inputValue('#m')) === '' && (await sp.inputValue('#fee')) === '';
    const dead = '000000000000000000000000000000000000dead';
    const s3 = { same: /trùng một địa chỉ nạp/.test(same), plan: /gom 7 USDT từ 2 địa chỉ/.test(plan.replace(/\s+/g, ' ')), wrong: /không khớp xpub/.test(wrong), locked: lockedBefore, done: /Xong: đã gom 2\/2/.test(lg), n: sent.length,
      transfers: sent.filter((x) => x.includes('a9059cbb') && x.includes(dead)).length, topups: sent.filter((x) => x.toLowerCase().includes(dep[1].slice(2))).length, wiped, other: other.length };
    sweep = JSON.stringify(s3);
    await b.close();
  } catch (e) { const m = 'ERR ' + e.message.slice(0, 300); if (!ui) ui = m; else if (!ui2) ui2 = m; else sweep = m; }
  s.kill();
  const u = ui.startsWith('{') ? JSON.parse(ui) : null;
  ok(u && u.xp && u.cm && u.er && u.words === 12 && u.ext === 0, 'giao diện: tính xpub, đối chiếu địa chỉ, chặn xprv, tạo ví mới, không có request ra ngoài ' + ui);
  const v2 = ui2.startsWith('{') ? JSON.parse(ui2) : null;
  ok(v2 && v2.tr && v2.qrOk && v2.csv && v2.print && v2.pp && v2.lk && v2.ext === 0, 'giao diện: TRC20 + địa chỉ thứ i, QR, tải CSV, in kèm cụm từ, passphrase, tra từ xpub, không request ra ngoài ' + ui2);
  const v3 = sweep.startsWith('{') ? JSON.parse(sweep) : null;
  ok(v3 && v3.same && v3.plan && v3.wrong && v3.locked && v3.done && v3.n === 3 && v3.transfers === 2 && v3.topups === 1 && v3.wiped && v3.other === 0, 'gom tiền: chặn ví chính trùng địa chỉ nạp, kế hoạch đúng, từ chối cụm từ sai, khoá nút gửi, nạp gas 1 + chuyển USDT 2, xoá khoá sau khi gửi ' + sweep);
  console.log(`${pass} đạt, ${fail} lỗi`); process.exit(fail ? 1 : 0);
})();
