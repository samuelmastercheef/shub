// Test S Xpub: lõi mật mã khớp vector chuẩn BIP39/BIP32, trang bị chặn mạng (CSP), và đăng ký trong S Hub.
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), { spawn } = require('child_process');
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL', m)); if (c) console.log('ok  ', m); };
const core = require('./public/xpub-core.js'), W = require('./public/xpub-words.js');
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
  const html = fs.readFileSync(path.join(__dirname, 'public/xpub.html'), 'utf8');
  ok(/connect-src 'none'/.test(html) && /default-src 'none'/.test(html) && !/<script>(?!\s*<)/.test(html.replace(/<script src="[^"]+"><\/script>/g, '')) && !/https?:\/\//.test(html.replace(/<meta[^>]*>/g, '')), 'trang chặn kết nối mạng (CSP), không script inline, không link ngoài');
  const js = fs.readFileSync(path.join(__dirname, 'public/xpub.js'), 'utf8') + fs.readFileSync(path.join(__dirname, 'public/xpub-core.js'), 'utf8');
  ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB/.test(js), 'mã không có lệnh gọi mạng hay lưu trữ');
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'shubx-')); fs.writeFileSync(path.join(T, 'c.json'), JSON.stringify({ workspace: path.join(T, 'ws'), port: 4793 }));
  const s = spawn('node', ['server.js'], { env: { ...process.env, SHUB_CONFIG: path.join(T, 'c.json'), SHUB_NO_TIMER: '1' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const get = (p) => new Promise((res) => http.get('http://127.0.0.1:4793' + p, (q) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => res({ s: q.statusCode, b })); }).on('error', () => res({ s: 0, b: '' })));
  const apps = JSON.parse((await get('/api/apps')).b); const list = apps.apps || apps;
  ok(list.some((a) => a.id === 'xpub' && a.type === 'internal'), 'S Xpub có trong danh sách công cụ của S Hub');
  ok((await get('/xpub.html')).s === 200 && (await get('/xpub-core.js')).s === 200 && (await get('/xpub-words.js')).s === 200 && (await get('/xpub.js')).s === 200, 'S Hub phục vụ đủ các file của S Xpub');
  let ui = '';
  try {
    const pw = require('playwright'), b = await pw.chromium.launch(), pg = await b.newPage(), reqs = []; pg.on('request', (q) => reqs.push(q.url()));
    await pg.goto('http://127.0.0.1:4793/xpub.html'); await pg.fill('#m', A); await pg.click('#go'); await pg.waitForSelector('#out:not([hidden])', { timeout: 15000 });
    const xp = await pg.textContent('#xp'); await pg.fill('#cmp', '0x9858effd232b4033e47d90003d41ec34ecaeda94'); const cm = await pg.textContent('#cmpr');
    await pg.fill('#m', 'xprv9s21ZrQH143K'); await pg.click('#go'); const er = await pg.textContent('#st');
    await pg.click('#gen'); await pg.waitForSelector('#newseed:not([hidden])'); const words = (await pg.$$('#seed span')).length;
    ui = JSON.stringify({ xp: xp === r.xpub, cm: /khớp #0/.test(cm), er: /Không nhập xprv/.test(er), words, ext: reqs.filter((u) => !u.startsWith('http://127.0.0.1:4793/')).length });
    await b.close();
  } catch (e) { ui = 'ERR ' + e.message.slice(0, 120); }
  s.kill();
  const u = ui.startsWith('{') ? JSON.parse(ui) : null;
  ok(u && u.xp && u.cm && u.er && u.words === 12 && u.ext === 0, 'giao diện: tính xpub, đối chiếu địa chỉ, chặn xprv, tạo ví mới, không có request ra ngoài ' + ui);
  console.log(`${pass} đạt, ${fail} lỗi`); process.exit(fail ? 1 : 0);
})();
