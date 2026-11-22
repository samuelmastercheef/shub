const $=i=>document.getElementById(i);let busy=false;
const say=(t,bad)=>{const s=$('st');s.textContent=t;s.className=bad?'err':'mut'};
function clearAll(){$('m').value='';$('seed').innerHTML='';$('newseed').hidden=true;$('out').hidden=true;$('xp').textContent='';$('ad').innerHTML='';$('cmp').value='';$('cmpr').textContent='';say('')}
async function calc(){
 if(busy)return;const m=$('m').value;if(/xprv|0x[0-9a-f]{64}/i.test(m)){say('Không nhập xprv hay khoá riêng. Chỉ nhập cụm từ khôi phục.',1);return}
 busy=true;say('Đang tính…');
 try{
  if(!(await SXpub.validateMnemonic(m,BIP39_EN))){say('Cụm từ không hợp lệ (cần 12/15/18/21/24 từ tiếng Anh BIP39, đúng checksum).',1);$('out').hidden=true;return}
  const r=await SXpub.deriveAccount(m);$('xp').textContent=r.xpub;
  $('len').textContent=`${r.xpub.length} ký tự`+(r.xpub.length===111?' (chuẩn 111)':' — bất thường');$('len').className=r.xpub.length===111?'ok':'err';
  $('ad').innerHTML=r.addresses.map(a=>`<tr><td>#${a.index}</td><td>${a.address}</td></tr>`).join('');window._ad=r.addresses;$('out').hidden=false;say('Xong.');chk()
 }catch(e){say('Lỗi: '+e.message,1)}finally{busy=false}
}
function chk(){const v=$('cmp').value.trim().toLowerCase(),r=$('cmpr');if(!v||!window._ad){r.textContent='';return}
 const i=window._ad.findIndex(a=>a.address.toLowerCase()===v);r.textContent=i>=0?`✓ khớp #${i}`:'✗ không khớp #0–#2';r.className=i>=0?'ok':'err'}
async function gen(bits){clearAll();const m=await SXpub.generateMnemonic(BIP39_EN,bits);$('m').value=m;$('seed').innerHTML=m.split(' ').map((w,i)=>`<span><i>${i+1}</i>${w}</span>`).join('');$('newseed').hidden=false;calc()}
$('gen').onclick=()=>gen(128);$('gen24').onclick=()=>gen(256);$('go').onclick=calc;$('clr').onclick=clearAll;$('cmp').oninput=chk;
$('m').oninput=()=>{$('newseed').hidden=true;$('out').hidden=true};
$('cp').onclick=async()=>{try{await navigator.clipboard.writeText($('xp').textContent);say('Đã sao chép xpub (xpub là khoá công khai, an toàn để dán vào Admin).')}catch{say('Không sao chép được, hãy bôi đen và copy thủ công.',1)}};
window.addEventListener('pagehide',clearAll);
