const $=i=>document.getElementById(i);let busy=false,last=null,lastX=null;
const say=(t,bad,id='st')=>{const s=$(id);s.textContent=t;s.className=bad?'err':'mut'};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const NET={evm:'BEP20/ERC20 (EVM)',tron:'TRC20 (Tron)'};
function clearAll(){$('m').value='';$('pp').value='';$('pp').type='password';$('ppw').hidden=true;$('seed').innerHTML='';$('newseed').hidden=true;$('out').hidden=true;$('xp').textContent='';$('ad').innerHTML='';$('cmp').value='';$('cmpr').textContent='';$('qr').innerHTML='';$('qrw').hidden=true;$('print').innerHTML='';$('pseed').checked=false;last=null;say('')}
function rows(list,tb){$(tb).innerHTML=list.map(a=>`<tr><td>#${a.index}</td><td>${esc(a.address)}</td><td><button class="ghost s" data-qr="${esc(a.address)}" data-i="${a.index}">QR</button></td></tr>`).join('')}
function showQr(text,label,box='qr'){try{$(box).innerHTML=SQr.svg(text);$(box+'l').textContent=label;$(box+'w').hidden=false}catch(e){$(box+'l').textContent='Không tạo được QR: '+e.message;$(box+'w').hidden=false}}
async function calc(){
 if(busy)return;const m=$('m').value;if(/xprv|0x[0-9a-f]{64}/i.test(m)){say('Không nhập xprv hay khoá riêng. Chỉ nhập cụm từ khôi phục.',1);return}
 busy=true;say('Đang tính…');
 try{
  if(!(await SXpub.validateMnemonic(m,BIP39_EN))){say('Cụm từ không hợp lệ (cần 12/15/18/21/24 từ tiếng Anh BIP39, đúng checksum).',1);$('out').hidden=true;return}
  const network=$('net').value,start=+$('start').value||0,count=+$('count').value||3;
  const r=await SXpub.deriveAccount(m,{network,start,count,passphrase:$('pp').value});last=r;$('xp').textContent=r.xpub;
  $('pathl').textContent=`(${NET[network]}, đường dẫn ${r.path})`;$('pathi').textContent=r.path+'/i';$('adminl').hidden=network!=='evm';$('tronn').hidden=network!=='tron';
  $('len').textContent=`${r.xpub.length} ký tự`+(r.xpub.length===111?' (chuẩn 111)':' — bất thường');$('len').className=r.xpub.length===111?'ok':'err';
  rows(r.addresses,'ad');$('qrw').hidden=true;$('out').hidden=false;say(`Xong: ${r.addresses.length} địa chỉ từ #${start}.`);chk()
 }catch(e){say('Lỗi: '+e.message,1)}finally{busy=false}
}
function chk(){const v=$('cmp').value.trim().toLowerCase(),r=$('cmpr');if(!v||!last){r.textContent='';return}
 const a=last.addresses.find(a=>a.address.toLowerCase()===v),f=last.addresses[0].index,l=f+last.addresses.length-1;r.textContent=a?`✓ khớp #${a.index}`:`✗ không khớp #${f}–#${l}`;r.className=a?'ok':'err'}
async function gen(bits){clearAll();const m=await SXpub.generateMnemonic(BIP39_EN,bits);$('m').value=m;$('seed').innerHTML=m.split(' ').map((w,i)=>`<span><i>${i+1}</i>${w}</span>`).join('');$('newseed').hidden=false;calc()}
function download(name,text,type){const u=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000)}
const tag=n=>n==='tron'?'trc20':'bep20';
const csvOf=(list,path)=>'index,address,path\n'+list.map(a=>`${a.index},${a.address},${path}/${a.index}`).join('\n')+'\n';
function txtOf(r){return `S Xpub - ${NET[r.network]}\nTạo lúc: ${new Date().toLocaleString('vi-VN')}\nĐường dẫn: ${r.path}\nxpub: ${r.xpub}\n\nĐịa chỉ nạp:\n`+r.addresses.map(a=>`#${a.index}  ${a.address}`).join('\n')+`\n\nFile này chỉ có khoá công khai (xpub) và địa chỉ, không tiêu được tiền.\n`}
function printOut(){if(!last)return;const r=last,seed=$('pseed').checked?$('m').value.trim().toLowerCase().split(/\s+/):null;
 $('print').innerHTML=`<h2>S Xpub - ${esc(NET[r.network])}</h2><div class="mut">In lúc ${esc(new Date().toLocaleString('vi-VN'))} · đường dẫn ${esc(r.path)}</div>
 <div style="display:flex;gap:16px;align-items:flex-start;margin:10px 0"><div class="qr">${SQr.svg(r.xpub)}</div><div style="flex:1"><div class="mut">xpub</div><div class="box">${esc(r.xpub)}</div></div></div>
 <table><thead><tr><th>#</th><th>Địa chỉ nạp</th></tr></thead><tbody>${r.addresses.map(a=>`<tr><td>#${a.index}</td><td>${esc(a.address)}</td></tr>`).join('')}</tbody></table>
 ${seed?`<div style="margin-top:16px;border:2px solid #000;padding:10px;page-break-inside:avoid"><b>CỤM TỪ KHÔI PHỤC - BÍ MẬT. Ai có tờ giấy này là lấy được toàn bộ tiền.</b>${$('pp').value?'<div>Ví có dùng passphrase (không in ở đây, cần nhớ riêng).</div>':''}<div class="seed" style="margin-top:8px">${seed.map((w,i)=>`<span><i>${i+1}</i>${esc(w)}</span>`).join('')}</div></div>`:''}`;
 const done=()=>{$('print').innerHTML='';window.removeEventListener('afterprint',done)};window.addEventListener('afterprint',done);window.print();setTimeout(done,60000)}
async function lookup(){
 const x=$('xin').value.trim();if(!x){say('Dán xpub trước.',1,'xst');return}
 say('Đang tính…',0,'xst');
 try{const network=$('xnet').value,start=+$('xstart').value||0,count=+$('xcount').value||10;const list=await SXpub.addressesFromXpub(x,{network,start,count});
  lastX={list,path:`m/44'/${network==='tron'?195:60}'/0'/0`,network};rows(list,'xad');$('xtb').hidden=false;$('xcsv').hidden=false;$('xqrw').hidden=true;say(`${list.length} địa chỉ ${NET[network]} từ #${start}.`,0,'xst')}
 catch(e){$('xtb').hidden=true;$('xcsv').hidden=true;say('Lỗi: '+e.message,1,'xst')}
}
$('gen').onclick=()=>gen(128);$('gen24').onclick=()=>gen(256);$('go').onclick=calc;$('clr').onclick=clearAll;$('cmp').oninput=chk;
$('m').oninput=()=>{$('newseed').hidden=true;$('out').hidden=true};
for(const id of ['net','start','count'])$(id).onchange=()=>{if(!$('out').hidden)calc()};
$('pp').oninput=()=>{$('ppw').hidden=!$('pp').value;$('out').hidden=true};$('ppv').onclick=()=>{$('pp').type=$('pp').type==='password'?'text':'password'};
$('cp').onclick=async()=>{try{await navigator.clipboard.writeText($('xp').textContent);say('Đã sao chép xpub (xpub là khoá công khai, an toàn để dán vào Admin).')}catch{say('Không sao chép được, hãy bôi đen và copy thủ công.',1)}};
$('qrb').onclick=()=>{if($('qrw').hidden||$('qrl').textContent.indexOf('xpub')<0)showQr(last.xpub,'QR của xpub (khoá công khai)');else $('qrw').hidden=true};
$('ad').onclick=e=>{const b=e.target.closest('[data-qr]');if(b)showQr(b.dataset.qr,`QR địa chỉ nạp #${b.dataset.i}`)};
$('xad').onclick=e=>{const b=e.target.closest('[data-qr]');if(b)showQr(b.dataset.qr,`QR địa chỉ nạp #${b.dataset.i}`,'xqr')};
$('csv').onclick=()=>last&&download(`sxpub-${tag(last.network)}-dia-chi.csv`,csvOf(last.addresses,last.path),'text/csv');
$('txt').onclick=()=>last&&download(`sxpub-${tag(last.network)}.txt`,txtOf(last),'text/plain');
$('prt').onclick=printOut;$('xgo').onclick=lookup;$('xcsv').onclick=()=>lastX&&download(`sxpub-${tag(lastX.network)}-tra-cuu.csv`,csvOf(lastX.list,lastX.path),'text/csv');
window.addEventListener('pagehide',clearAll);
