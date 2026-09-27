// Dashboard AfriIX — monitoring + kelola AI dari browser. v2.1
// Tanpa dependency tambahan (http bawaan Node).
// Halaman: GET /?token=XXX  (token TIDAK ditanam di HTML, dibaca dari URL oleh JS)
// API (semua butuh token via ?token= / body.token):
//   GET  /health            -> "ok" (publik, untuk UptimeRobot)
//   GET  /api/state         -> status lengkap (kartu, grafik/jam, event, mute, config aman)
//   GET|POST /api/auto      -> {state:on|off} nyala/matikan auto-AI (tanpa state = baca saja)
//   POST /api/dnd           -> {minutes:0=mati} mode jangan-ganggu
//   POST /api/unmute        -> {num:"628xxx"|"all"} buka mute pengalihan
//   POST /api/cooldown      -> {sec:5..300} jeda AI per chat
//   POST /api/test          -> {prompt} uji AI (balikan jawaban + latensi + bahasa)
//   GET  /api/brain         -> statistik otak AI
//   POST /api/brain/reset   -> reset otak (konfirmasi di UI)
//   GET  /api/owner         -> status owner-dash (lisensi)
//   GET  /api/instance      -> info instance bot ini
//   POST /api/token/regen   -> regenerasi DASH_TOKEN (tulis .env + live)
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function jres(res, obj, code) {
  res.writeHead(code || 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readJson(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (d) => { b += d; if (b.length > 20000) { try { req.destroy(); } catch {} } });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function page() {
  return '<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<title>Dashboard AfriIX</title>'
  + '<style>'
   + ':root{--bg:#faf8f2;--bg2:#fffdf8;--card:#ffffff;--line:#e6d5a5;--txt:#28251e;--mut:#817966;--grn:#21864b;--red:#c43d3d;--blu:#b88918;--gold:#d4a72c;--r:10px}'
  + '*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}'
   + 'body{background:radial-gradient(1000px 400px at 50% -100px,#fff4cf 0%,var(--bg) 62%);color:var(--txt);font-family:"Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;line-height:1.55;min-height:100vh}'
  + 'header.top{position:sticky;top:0;z-index:10;background:linear-gradient(135deg,#0d1526,#14224a);border-bottom:1px solid var(--line);padding:10px 16px;display:flex;align-items:center;gap:12px}'
  + '.brand{display:flex;align-items:center;gap:10px}'
   + '.logo{width:42px;height:42px;border-radius:10px;object-fit:cover;border:1px solid var(--blu);box-shadow:0 0 18px rgba(212,168,61,.35)}'
  + '.brand h1{font-size:17px;letter-spacing:.2px}.brand small{color:var(--mut);font-size:11px;display:block}'
  + '.spacer{flex:1}'
  + '.statuspill{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.06);border:1px solid var(--line);border-radius:999px;padding:5px 12px;font-size:12px}'
  + '#clock{color:var(--mut);font-size:12px;font-variant-numeric:tabular-nums}'
  + 'nav#tabs{display:flex;gap:8px;padding:12px 16px;flex-wrap:wrap;position:sticky;top:59px;background:rgba(10,17,32,.92);backdrop-filter:blur(6px);z-index:9}'
  + 'nav#tabs button{background:var(--card);color:var(--txt);border:1px solid var(--line);border-radius:999px;padding:8px 15px;cursor:pointer;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.25)}'
  + 'nav#tabs button:active{transform:scale(.96)}'
  + 'nav#tabs button.on{background:linear-gradient(135deg,var(--blu),#8e6910);border-color:transparent;color:#fff;font-weight:700;box-shadow:0 4px 14px rgba(184,137,24,.35)}'
  + '.wrap{max-width:1060px;margin:auto;padding:4px 16px 30px}'
  + '.tab{display:none}.tab.on{display:block;animation:fade .18s ease}'
  + '@keyframes fade{from{opacity:0;transform:translateY(4px)}to{opacity:1}}'
  + '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:12px 0}'
  + '.card{background:linear-gradient(180deg,#141e38,#101830);border:1px solid var(--line);border-top:3px solid var(--blu);border-radius:var(--r);padding:12px 14px;box-shadow:0 4px 16px rgba(0,0,0,.3)}'
  + '.card b{font-size:22px;display:block;font-variant-numeric:tabular-nums}.card small{color:var(--mut)}'
  + '.card.ok{border-top-color:var(--grn)}.card.ok b{color:var(--grn)}'
  + '.card.bad{border-top-color:var(--red)}.card.bad b{color:var(--red)}'
  + '.card.warn{border-top-color:var(--gold)}'
  + 'h3.sec{margin:18px 0 4px;font-size:14px;text-transform:uppercase;letter-spacing:.6px;color:var(--mut);border-bottom:1px solid var(--line);padding-bottom:6px}'
  + '.btn{display:inline-block;margin:4px 8px 4px 0;padding:10px 18px;border-radius:11px;border:0;cursor:pointer;font-size:14px;font-weight:700;color:#fff;background:linear-gradient(135deg,var(--blu),#2563eb);text-decoration:none;box-shadow:0 4px 12px rgba(37,99,235,.35)}'
  + '.btn:active{transform:translateY(1px) scale(.98)}'
  + '.btn.grn{background:linear-gradient(135deg,#d4a72c,#a8790f);color:#2d2105;box-shadow:0 4px 12px rgba(184,137,24,.3)}'
  + '.btn.red{background:linear-gradient(135deg,#ef4444,#b91c1c);box-shadow:0 4px 12px rgba(239,68,68,.35)}'
  + '.btn.ghost{background:rgba(255,255,255,.05);border:1px solid var(--line);color:var(--txt);box-shadow:none}'
  + 'table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid var(--line);padding:8px;font-size:13px;text-align:left;vertical-align:top}'
  + 'th{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.4px}tbody tr:hover{background:rgba(255,255,255,.03)}'
  + '.row{display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin:10px 0}'
  + 'label{font-size:12px;color:var(--mut);display:block;margin-bottom:3px}'
  + 'input,select,textarea{background:#0b1330;border:1px solid var(--line);color:var(--txt);border-radius:10px;padding:10px;font-size:14px}'
  + 'input:focus,select:focus,textarea:focus{outline:none;border-color:var(--blu);box-shadow:0 0 0 3px rgba(59,130,246,.25)}'
  + 'input,select{min-width:140px}textarea{width:100%;min-height:70px;resize:vertical}'
  + '.box{background:linear-gradient(180deg,#121b33,#0e1630);border:1px solid var(--line);border-radius:var(--r);padding:14px 16px;margin:10px 0;box-shadow:0 4px 16px rgba(0,0,0,.25)}'
  + '.pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:800}'
  + '.pill.ok{background:rgba(34,197,94,.15);color:var(--grn)}.pill.bad{background:rgba(239,68,68,.15);color:var(--red)}.pill.warn{background:rgba(245,196,81,.15);color:var(--gold)}.pill.info{background:rgba(59,130,246,.15);color:#93c5fd}'
  + 'canvas{width:100%;background:#0b1330;border:1px solid var(--line);border-radius:var(--r)}'
  + '.mut{color:var(--mut);font-size:12px}.mono{font-family:monospace;word-break:break-all;font-size:12px}'
  + '#err{display:none;background:rgba(239,68,68,.12);border:1px solid var(--red);border-radius:10px;padding:10px 14px;margin:10px 0;font-size:13px}'
  + 'footer{text-align:center;color:var(--mut);font-size:12px;padding:18px 0 26px}'
  + '@media(max-width:640px){.grid{grid-template-columns:repeat(2,1fr)}#clock{display:none}}'
  + '</style></head><body>'
  + '<header class="top"><div class="brand"><img class="logo" src="/logo.png" alt="AfriIX logo"><div><h1>Dashboard AfriIX</h1><small>Management Ai Asisten By AfriIX</small></div></div>'
  + '<div class="spacer"></div><div class="statuspill"><span id="hdot">putih</span><span id="wastat">menghubungi…</span></div>'
  + '<span id="clock">-</span><button class="btn ghost" id="btnRefresh" style="margin:0;padding:8px 12px">Muat</button></header>'
  + '<div class="wrap">'
  + '<div id="err"></div>'
  + '<nav id="tabs">'
  + '<button data-t="ringkas" class="on">Ringkasan</button>'
  + '<button data-t="grafik">Grafik</button>'
  + '<button data-t="aktif">Aktivitas</button>'
  + '<button data-t="kontrol">Kontrol</button>'
  + '<button data-t="aiotak">AI dan Otak</button>'
  + '<button data-t="cust">Customer</button>'
  + '<button data-t="inst">Instance</button>'
  + '<button data-t="aman">Keamanan</button>'
  + '</nav>'
  + '<section id="t-ringkas" class="tab on"><div class="grid" id="cards"></div>'
  + '<div class="box"><b>Status koneksi</b><div id="connbox" class="mut">memuat…</div></div></section>'
  + '<section id="t-grafik" class="tab"><h3 class="sec">Aktivitas 24 jam terakhir (WIB)</h3>'
  + '<canvas id="ch24" height="220"></canvas><div class="mut">biru masuk · hijau AI · kuning dialihkan (per jam)</div>'
  + '<h3 class="sec">Proporsi total</h3><canvas id="donut" height="180"></canvas></section>'
  + '<section id="t-aktif" class="tab"><h3 class="sec">Event terakhir</h3>'
  + '<div class="row"><div><label>Filter tipe</label><select id="flt"><option value="">semua</option><option>conn</option><option>redir</option><option>mute</option><option>dash</option></select></div>'
  + '<div><label>&nbsp;</label><button class="btn ghost" id="btnEv">Muat</button></div></div>'
  + '<div class="box" style="padding:4px 12px;overflow-x:auto"><table><tr><th>Waktu</th><th>Tipe</th><th>Detail</th></tr><tbody id="evrows"><tr><td colspan="3">memuat…</td></tr></tbody></table></div></section>'
  + '<section id="t-kontrol" class="tab"><h3 class="sec">AI Auto-Jawab</h3><div class="row"><button class="btn grn" id="btnOn">ON</button><button class="btn red" id="btnOff">OFF</button><span id="autoSt" class="mut"></span></div>'
  + '<h3 class="sec">Jangan ganggu (DND)</h3><div class="row"><div><label>Menit</label><input id="dndMin" type="number" min="1" max="1440" value="60"></div><div><label>&nbsp;</label><button class="btn" id="btnDnd">Aktifkan</button><button class="btn ghost" id="btnDndOff">Matikan</button></div><span id="dndSt" class="mut"></span></div>'
  + '<h3 class="sec">Cooldown AI (detik/chat)</h3><div class="row"><div><label>Detik (5-300)</label><input id="cdSec" type="number" min="5" max="300" value="20"></div><div><label>&nbsp;</label><button class="btn" id="btnCd">Simpan</button></div><span id="cdSt" class="mut"></span></div>'
  + '<h3 class="sec">Mute pengalihan (<span id="muteN">0</span>)</h3><div class="row"><button class="btn ghost" id="btnUnAll">Buka semua</button></div>'
  + '<div class="box" style="padding:4px 12px;overflow-x:auto"><table><tr><th>Nomor</th><th>Sisa</th><th>Aksi</th></tr><tbody id="muterows"><tr><td colspan="3">tidak ada</td></tr></tbody></table></div></section>'
  + '<section id="t-aiotak" class="tab"><h3 class="sec">Mesin AI</h3><div class="box" id="engbox">memuat…</div>'
  + '<h3 class="sec">Uji AI</h3><div class="box"><textarea id="tPrompt" placeholder="Tulis pesan uji"></textarea>'
  + '<div class="row"><button class="btn" id="btnTest">Kirim uji</button><span id="tMeta" class="mut"></span></div>'
  + '<div id="tAns" class="box" style="background:#0b1330">belum ada hasil</div></div>'
  + '<h3 class="sec">Otak (pembelajaran)</h3><div class="box" id="brainbox">memuat… <button class="btn ghost" id="btnBrain">Muat ulang</button></div>'
  + '<div class="row"><button class="btn red" id="btnBrainReset">Reset otak</button></div></section>'
  + '<section id="t-cust" class="tab"><h3 class="sec">Customer dan Lisensi (mode jual)</h3><div class="box" id="ownerbox">memuat…</div>'
  + '<h3 class="sec">Daftar customer</h3><div class="box" id="custbox"><span class="mut">Belum ada mode dev/jual yang dipasang. Tabel customer akan muncul di sini setelah mode dev/jual bot diberikan. Sementara itu kelola lisensi lewat owner-dash (status di atas).</span></div></section>'
  + '<section id="t-inst" class="tab"><h3 class="sec">Instance bot</h3><div class="box" id="instbox">memuat… <button class="btn ghost" id="btnInst">Muat ulang</button></div>'
  + '<h3 class="sec">Instance lain</h3><div class="box"><span class="mut">Slot multi-instance disiapkan. Akan terisi otomatis setelah mode dev/multi-bot dipasang.</span></div></section>'
  + '<section id="t-aman" class="tab"><h3 class="sec">Keamanan</h3><div class="box" id="secbox">memuat…</div>'
  + '<div class="row"><button class="btn red" id="btnRegen">Regenerasi token</button></div>'
  + '<div id="newtok" class="box" style="display:none"></div>'
  + '<p class="mut">Token bocor atau dishare? Regenerasi segera. Setelah regenerasi, URL lama langsung mati.</p></section>'
  + '<footer>AfriIX Dashboard <b>v2.1</b> · Management Ai Asisten By AfriIX</footer>'
  + '</div>'
  + '<scr' + 'ipt>'
  + 'window.onerror=function(m,s,l,c){var e=document.getElementById("err");if(e){e.style.display="block";e.textContent="JS error: "+m+" baris "+l;}};'
  + 'var TOKEN="";try{TOKEN=new URLSearchParams(location.search).get("token")||"";}catch(e){TOKEN="";}'
  + 'function $(id){return document.getElementById(id);}'
  + 'function esc(s){if(s==null){return "";}return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}'
  + 'function on(id,ev,fn){var e=$(id);if(e){e.addEventListener(ev,fn);}}'
  + 'function showErr(m){var e=$("err");if(!e){return;}if(!m){e.style.display="none";e.textContent="";return;}e.style.display="block";e.textContent=m;}'
  + 'function api(p,body){var u=p+"?token="+encodeURIComponent(TOKEN);var o={};if(body){o={method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)};}return fetch(u,o).then(function(r){return r.text();}).then(function(t){try{return JSON.parse(t);}catch(e){return{error:t.slice(0,200)};}}).catch(function(e){return{error:"jaringan gagal"};});}'
  + 'function done(r){if(r&&r.error){showErr("Gagal: "+r.error);return;}showErr(null);load();}'
  + 'var S=null;'
  + 'function pill(t){var c="ok";if(t==="conn"){c="info";}else if(t==="redir"){c="warn";}else if(t==="mute"){c="bad";}return "<span class=\\\"pill "+c+"\\\">"+esc(t)+"</span>";}'
  + 'function fmtT(iso){try{return new Date(iso).toLocaleString("id-ID",{timeZone:"Asia/Jakarta",day:"numeric",month:"numeric",hour:"2-digit",minute:"2-digit"});}catch(e){return esc(iso);}}'
  + 'function fmtUp(ms){var m=Math.max(0,Math.floor(ms/60000));var d=Math.floor(m/1440);var h=Math.floor((m%1440)/60);var mm=m%60;if(d>0){return d+"h "+h+"j";}return h+"j "+mm+"m";}'
  + 'function load(){return api("/api/state").then(function(s){if(!s||s.error){showErr("Gagal muat: "+((s&&s.error)||"tidak dikenal"));return;}S=s;showErr(null);render();});}'
  + 'function switchTab(t){var bs=document.querySelectorAll("#tabs button");for(var i=0;i<bs.length;i++){var on_=bs[i].getAttribute("data-t")===t;if(on_){bs[i].classList.add("on");}else{bs[i].classList.remove("on");}}var ts=document.querySelectorAll(".tab");for(var j=0;j<ts.length;j++){if(ts[j].id==="t-"+t){ts[j].classList.add("on");}else{ts[j].classList.remove("on");}}if(t==="grafik"&&S){draw24();drawDonut();}}'
  + 'function card(cls,label,val,sub){return "<div class=\\\"card "+cls+"\\\"><small>"+label+"</small><b>"+val+"</b><small>"+sub+"</small></div>";}'
  + 'function render(){if(!S){return;}try{'
  + 'var dot=$("hdot");if(dot){dot.textContent=S.connected?"hijau":"merah";}'
  + 'var ws=$("wastat");if(ws){ws.textContent=S.connected?"Terhubung":"PUTUS";}'
  + 'var h="";'
  + 'h+=card("", "WA", S.connected?"Terhubung":"PUTUS", esc(S.user));'
  + 'h+=card(S.autoAi?"ok":"bad", "Auto-AI", S.autoAi?"ON":"OFF", S.enableAI?"fitur AI aktif":"ENABLE_AI mati");'
  + 'h+=card("", "Uptime", esc(fmtUp(Date.now()-S.startedAt)), "cooldown "+esc(String(S.cooldown))+" dtk");'
  + 'h+=card("", "Masuk", String(S.msgIn), "total");'
   + 'h+=card("", "Balasan AI", String(S.aiOut), "total");'
   + 'var at=S.aiTelemetry||{};h+="<div class=\"card ok\"><small>AI TOKENS REAL-TIME</small><b>"+(at.totalTokens||0).toLocaleString("id-ID")+"</b><small>in "+(at.inputTokens||0).toLocaleString("id-ID")+" · out "+(at.outputTokens||0).toLocaleString("id-ID")+" · req "+(at.requests||0)+"</small></div>";'
  + 'h+=card("", "Dialihkan", String(S.redirects), "ke owner");'
  + 'h+=card("", "Drop terakhir", esc((S.lastDrop&&S.lastDrop.reason)||"-"), esc(((S.lastDrop&&S.lastDrop.from)||"-")+" · "+((S.lastDrop&&S.lastDrop.at)||"-")));'
  + 'var dndOn=S.dnd&&S.dnd.on;'
  + 'h+=card(dndOn?"bad":"", "DND", dndOn?"AKTIF":"mati", esc((S.dnd&&S.dnd.left)||"-"));'
  + 'h+=card("", "Tidur ("+esc(String(S.sleep.start))+"-"+esc(String(S.sleep.end))+")", S.sleep.now?"malam":"siang", S.sleep.now?"istirahat":"terjaga");'
  + 'var cb=$("connbox");if(cb){cb.innerHTML="User: <span class=\\"mono\\">"+esc(S.user)+"</span> · Terakhir: "+esc(S.lastFrom)+" ("+esc(S.lastAt)+") · Model: "+esc(S.aiModel1);if(S.aiModel2&&S.aiModel2!=="-"){cb.innerHTML+=" / "+esc(S.aiModel2);}if(S.lastDrop&&S.lastDrop.reason&&S.lastDrop.reason!=="-"){cb.innerHTML+="<br>Drop terakhir: <b>"+esc(S.lastDrop.reason)+"</b> dari "+esc(S.lastDrop.from)+" ("+esc(S.lastDrop.at)+")";}}'
  + 'var aS=$("autoSt");if(aS){aS.textContent="Status: "+(S.autoAi?"ON":"OFF");}'
  + 'var dS=$("dndSt");if(dS){dS.textContent=dndOn?("Aktif, sisa "+S.dnd.left):"Mati";}'
  + 'var cS=$("cdSt");if(cS){cS.textContent="Aktif: "+S.cooldown+" dtk";}'
  + 'var mr="";if(S.muted&&S.muted.length){for(var i=0;i<S.muted.length;i++){var x=S.muted[i];mr+="<tr><td>"+esc(x.num)+"</td><td>"+esc(x.left)+"</td><td><button class=\\\"btn ghost\\\" data-un=\\\""+esc(x.num)+"\\\">Buka</button></td></tr>";}}else{mr="<tr><td colspan=\\\"3\\\">tidak ada</td></tr>";}'
  + 'var mt=$("muterows");if(mt){mt.innerHTML=mr;}'
  + 'var mn=$("muteN");if(mn){mn.textContent=String(S.muted?S.muted.length:0);}'
  + 'var flt=$("flt");var fv=flt?flt.value:"";var er="";var ev=S.events||[];'
  + 'for(var j=0;j<ev.length;j++){var e=ev[j];if(fv&&e.type!==fv){continue;}er+="<tr><td>"+fmtT(e.t)+"</td><td>"+pill(e.type)+"</td><td>"+esc(e.msg)+"</td></tr>";}'
  + 'var erT=$("evrows");if(erT){erT.innerHTML=er||"<tr><td colspan=\\\"3\\\">kosong</td></tr>";}'
  + 'var sb=$("secbox");if(sb){sb.innerHTML="Gagal auth: <b>"+((S.fails&&S.fails.n)||0)+"</b> · terakhir: "+esc((S.fails&&S.fails.last)||"-")+"<br><span class=\\\"mut\\\">Token min. 8 karakter. Jangan share URL bertoken.</span>";}'
  + 'draw24();drawDonut();bindUn();'
  + '}catch(e){showErr("Gagal tampilkan data.");}}'
  + 'function bindUn(){var bs=document.querySelectorAll("[data-un]");for(var i=0;i<bs.length;i++){(function(b){b.onclick=function(){unmute(b.getAttribute("data-un"));};})(bs[i]);}}'
  + 'function unmute(n){api("/api/unmute",{num:n}).then(done);}'
  + 'function draw24(){var c=$("ch24");if(!c||!S||!S.hourly){return;}var W=c.clientWidth||600;var H=220;var dpr=window.devicePixelRatio||1;c.width=W*dpr;c.height=H*dpr;var x=c.getContext("2d");x.scale(dpr,dpr);x.clearRect(0,0,W,H);'
  + 'var D=S.hourly.slice(-24);if(!D.length){x.fillStyle="#93a1c0";x.fillText("belum ada data",20,40);return;}'
  + 'var mx=1;for(var i=0;i<D.length;i++){var a=D[i].in||0;var b=D[i].ai||0;var r=D[i].redir||0;if(a>mx){mx=a;}if(b>mx){mx=b;}if(r>mx){mx=r;}}'
  + 'var gw=W/D.length;var bwm=Math.floor((gw-8)/3);if(bwm<2){bwm=2;}var cols=["#3b82f6","#22c55e","#f5c451"];'
  + 'for(var j=0;j<D.length;j++){var bx=j*gw+4;var v0=D[j].in||0;var v1=D[j].ai||0;var v2=D[j].redir||0;var vals=[v0,v1,v2];'
  + 'for(var k=0;k<3;k++){var hh=Math.round((vals[k]/mx)*(H-46));x.fillStyle=cols[k];x.fillRect(bx+k*(bwm+1),H-26-hh,bwm,hh);}'
  + 'if(D.length<=12||j%2===0){x.fillStyle="#93a1c0";x.font="9px sans-serif";x.fillText(String(D[j].h||"").slice(0,11),bx,H-10);}}}'
  + 'function drawDonut(){var c=$("donut");if(!c||!S){return;}var W=c.clientWidth||600;var H=180;var dpr=window.devicePixelRatio||1;c.width=W*dpr;c.height=H*dpr;var x=c.getContext("2d");x.scale(dpr,dpr);x.clearRect(0,0,W,H);'
  + 'var a=S.aiOut||0;var r=S.redirects||0;var m=S.msgIn||0;var rest=m-a-r;if(rest<0){rest=0;}var tot=a+r+rest;if(tot<1){tot=1;}var cx=W/2-60;var cy=H/2;var R=60;var ang=-Math.PI/2;'
  + 'var arr=[[rest,"#3b82f6","Masuk lain ("+rest+")"],[a,"#22c55e","AI ("+a+")"],[r,"#f5c451","Alih ("+r+")"]];'
  + 'for(var i=0;i<arr.length;i++){if(arr[i][0]<=0){continue;}var sw=(arr[i][0]/tot)*Math.PI*2;x.beginPath();x.strokeStyle=arr[i][1];x.lineWidth=26;x.arc(cx,cy,R,ang,ang+sw);x.stroke();ang+=sw;}'
  + 'x.font="13px sans-serif";for(var q=0;q<arr.length;q++){x.fillStyle=arr[q][1];x.fillRect(cx+80,30+q*24,12,12);x.fillStyle="#e8eefc";x.fillText(arr[q][2],cx+98,41+q*24);}}'
  + 'function bindTabs(){var nav=$("tabs");if(!nav){return;}nav.addEventListener("click",function(e){var t=e.target;if(!t||!t.closest){return;}var b=t.closest("button");if(!b){return;}var dt=b.getAttribute("data-t");if(dt){switchTab(dt);}});}'
  + 'function loadBrain(){return api("/api/brain").then(function(b){var box=$("brainbox");if(!box){return;}if(!b||b.error){box.textContent="Gagal: "+((b&&b.error)||"tidak dikenal");return;}var s=b.summary||{};var h="Chat dipelajari: <b>"+(s.chats||0)+"</b> · User unik: <b>"+(s.users||0)+"</b><br>";'
  + 'var bl=[];var langs=s.byLang||{};for(var k in langs){if(langs.hasOwnProperty(k)){bl.push(k+"="+langs[k]);}}h+="Bahasa: "+esc(bl.join(", ")||"-")+"<br>";'
  + 'var tsl=[];var tsls=s.topSlang||[];for(var i2=0;i2<tsls.length;i2++){tsl.push(tsls[i2].k+" ("+tsls[i2].c+")");}h+="Kata top: "+esc(tsl.join(", ")||"-")+"<br>";'
  + 'var tph=[];var tphs=s.topPhrases||[];for(var i3=0;i3<tphs.length;i3++){tph.push(tphs[i3].k+" ("+tphs[i3].c+")");}h+="Frasa top: "+esc(tph.join(" | ")||"-");'
  + 'box.innerHTML=h+" <button class=\\\"btn ghost\\\" id=\\\"btnBrain2\\\">Muat ulang</button>";on("btnBrain2","click",loadBrain);});}'
  + 'function loadOwner(){return api("/api/owner").then(function(o){var box=$("ownerbox");if(!box){return;}if(!o||o.error){box.textContent="Gagal: "+((o&&o.error)||"tidak dikenal");return;}var h="Owner-dash (lisensi): <b>"+(o.on?"AKTIF":"MATI")+"</b> · port "+esc(String(o.port))+"<br>";if(o.on){h+="<span class=\\\"mut\\\">Buka dengan host yang sama, port "+esc(String(o.port))+" + token OWNER_DASH_TOKEN.</span> <button class=\\\"btn ghost\\\" id=\\\"btnOwnerGo\\\">Buka owner-dash</button>";}else{h+="<span class=\\\"mut\\\">Mati. Jalankan di VPS: <span class=\\\"mono\\\">node owner-dash.js</span> (butuh OWNER_DASH_TOKEN di .env).</span>";}box.innerHTML=h;on("btnOwnerGo","click",function(){var t=prompt("Tempel OWNER_DASH_TOKEN:");if(t){location.href=location.protocol+"//"+location.hostname+":"+o.port+"/?token="+encodeURIComponent(t);}});});}'
  + 'function loadInst(){return api("/api/instance").then(function(r){var box=$("instbox");if(!box){return;}if(!r||r.error||!r.inst){box.innerHTML="Gagal: "+esc((r&&r.error)||"?")+" <button class=\\\"btn ghost\\\" id=\\\"btnInst2\\\">Muat ulang</button>";on("btnInst2","click",loadInst);return;}var i=r.inst;box.innerHTML="Nama: <b>"+esc(i.name)+"</b><br>Nomor: <span class=\\\"mono\\\">"+esc(i.number)+"</span><br>Baileys: "+esc(i.waLib)+" · Node: "+esc(i.node)+"<br>Platform: "+esc(i.platform)+" · Session: "+esc(i.session)+"<br>Uptime: "+esc(i.uptime)+" · Masuk: "+i.msgIn+" · AI: "+i.aiOut+" <button class=\\\"btn ghost\\\" id=\\\"btnInst2\\\">Muat ulang</button>";on("btnInst2","click",loadInst);});}'
  + 'function loadEng(){if(S){paintEng(S);return;}api("/api/state").then(function(s){if(s&&!s.error){paintEng(s);}});}'
  + 'function paintEng(s){var box=$("engbox");if(!box){return;}box.innerHTML="Model utama: <b>"+esc(s.aiModel1)+"</b> (key: "+esc(s.key1)+")<br>Cadangan: <b>"+esc(s.aiModel2)+"</b> (key: "+esc(s.key2)+")<br><span class=\\\"mut\\\">Urutan pakai: KEY1, KEY2, gratis. Total AI: "+s.aiOut+" balasan.</span>";}'
  + 'bindTabs();'
  + 'on("btnRefresh","click",function(){load();});'
  + 'on("btnEv","click",function(){load();});'
  + 'on("flt","change",function(){render();});'
  + 'on("btnOn","click",function(){api("/api/auto",{state:"on"}).then(done);});'
  + 'on("btnOff","click",function(){api("/api/auto",{state:"off"}).then(done);});'
  + 'on("btnDnd","click",function(){var v=$("dndMin");var n=v?parseInt(v.value,10):0;if(!n){n=0;}api("/api/dnd",{minutes:n}).then(done);});'
  + 'on("btnDndOff","click",function(){api("/api/dnd",{minutes:0}).then(done);});'
  + 'on("btnCd","click",function(){var v=$("cdSec");var n=v?parseInt(v.value,10):20;if(!n){n=20;}api("/api/cooldown",{sec:n}).then(done);});'
  + 'on("btnUnAll","click",function(){if(confirm("Buka semua mute?")){unmute("all");}});'
  + 'on("btnTest","click",function(){var p=$("tPrompt");var txt=p?p.value:"";if(!txt.trim()){return;}var an=$("tAns");if(an){an.textContent="menghubungi AI…";}var mt=$("tMeta");if(mt){mt.textContent="";}api("/api/test",{prompt:txt}).then(function(r){var a2=$("tAns");var m2=$("tMeta");if(!r||r.error){if(a2){a2.textContent="Gagal: "+((r&&r.error)||"tidak dikenal");}return;}if(a2){a2.textContent=r.answer||"(kosong)";}if(m2){m2.textContent=(r.ms||0)+" ms · "+(r.lang||"");}});});'
  + 'on("btnBrain","click",function(){loadBrain();});'
  + 'on("btnBrainReset","click",function(){if(confirm("Reset otak AI? Pembelajaran bahasa hilang permanen.")){api("/api/brain/reset",{}).then(function(r){if(r&&r.ok){showErr(null);loadBrain();}else{showErr("Gagal: "+((r&&r.error)||"?"));}});}});'
  + 'on("btnRegen","click",function(){if(!confirm("Regenerasi token? URL lama langsung mati.")){return;}api("/api/token/regen",{}).then(function(r){var box=$("newtok");if(!box){return;}if(!r||r.error||!r.token){box.style.display="block";box.textContent="Gagal: "+((r&&r.error)||"?");return;}var nu=location.origin+location.pathname+"?token="+r.token;box.style.display="block";box.innerHTML="Token baru (salin sekarang, cuma tampil sekali):<br><span class=\\\"mono\\\">"+esc(r.token)+"</span><br><a class=\\\"btn grn\\\" style=\\\"margin-top:8px\\\" href=\\\""+nu+"\\\">Buka dengan token baru</a>";});});'
  + 'on("btnInst","click",function(){loadInst();});'
  + 'setInterval(function(){var d=new Date();var c=$("clock");if(!c){return;}try{c.textContent=d.toLocaleString("id-ID",{timeZone:"Asia/Jakarta"});}catch(e){c.textContent=d.toLocaleString();}},1000);'
  + 'setInterval(function(){load();},15000);'
  + 'window.addEventListener("resize",function(){if(S){draw24();drawDonut();}});'
  + 'load().then(function(){loadEng();loadBrain();loadOwner();loadInst();});'
  + '</scr' + 'ipt></body></html>';
}

function startDashboard(opts) {
  const port = opts.port, host = opts.host || '127.0.0.1';
  const logoFile = path.join(__dirname, '..', 'logo.png');
  let liveToken = opts.token;
  const getState = opts.getState, setAuto = opts.setAuto;
  const actions = opts.actions || {};
  const fails = { n: 0, last: '-' };
  if (!liveToken || liveToken === 'ganti-token-ini' || liveToken.length < 8) {
    console.log('⚠️ DASH_TOKEN masih default/lemah. Set DASH_TOKEN minimal 8 karakter acak di .env!');
  }
  const hits = {};
  function limited(ip) {
    const now = Date.now();
    if (!hits[ip]) hits[ip] = [];
    hits[ip] = hits[ip].filter((t) => now - t < 60000);
    hits[ip].push(now);
    return hits[ip].length > 30;
  }
  // Cek owner-dash (port 3001 default) hidup/mati — untuk tab Customer.
  function probeOwner() {
    const oport = parseInt(process.env.OWNER_DASH_PORT || '3001', 10);
    return new Promise((resolve) => {
      const rq = http.get({ host: '127.0.0.1', port: oport, path: '/health', timeout: 2000 }, (r) => {
        resolve({ on: r.statusCode === 200, port: oport });
        try { r.resume(); } catch {}
      });
      rq.on('timeout', () => { try { rq.destroy(); } catch {} resolve({ on: false, port: oport }); });
      rq.on('error', () => resolve({ on: false, port: oport }));
    });
  }
  function regenTokenInEnv() {
    const nt = crypto.randomBytes(32).toString('hex');
    const envPath = path.join(__dirname, '..', '.env');
    let raw = '';
    try { raw = fs.readFileSync(envPath, 'utf8'); }
    catch { throw new Error('.env tidak ditemukan: ' + envPath); }
    if (/^DASH_TOKEN=.*$/m.test(raw)) raw = raw.replace(/^DASH_TOKEN=.*$/m, 'DASH_TOKEN=' + nt);
    else raw += (raw.endsWith('\n') ? '' : '\n') + 'DASH_TOKEN=' + nt + '\n';
    fs.writeFileSync(envPath, raw);
    try { fs.chmodSync(envPath, 0o600); } catch {}
    return nt;
  }
  const server = http.createServer(async (req, res) => {
    const ip = req.socket?.remoteAddress || 'x';
    if (limited(ip)) { res.writeHead(429, { 'Content-Type': 'text/plain' }); res.end('too many requests'); return; }
    let url;
    try { url = new URL(req.url, 'http://x'); }
    catch { res.writeHead(400); res.end('bad request'); return; }
    if (url.pathname === '/logo.png') {
      try { const logo = fs.readFileSync(logoFile); res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' }); res.end(logo); } catch { res.writeHead(404); res.end('not found'); }
      return;
    }
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end('ok');
      return;
    }
    let body = {};
    if (req.method === 'POST') body = await readJson(req);
    const qTok = url.searchParams.get('token') || body.token || '';
    if (!liveToken || qTok.length < 8 || qTok !== liveToken) {
      fails.n++;
      try { fails.last = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }); } catch { fails.last = new Date().toISOString(); }
      res.writeHead(401, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end('unauthorized');
      return;
    }
    try {
      if (url.pathname === '/api/state') {
        const st = getState();
        st.fails = { ...fails };
        return jres(res, st);
      }
      if (url.pathname === '/api/auto') {
        const st = (url.searchParams.get('state') || body.state || '').toLowerCase();
        const cur0 = getState();
        if (st === 'on' || st === 'off') {
          const on = st === 'on';
          if (setAuto) setAuto(on);
          else if (actions.setAuto) actions.setAuto(on);
          const cur = getState();
          return jres(res, { ok: true, autoAi: cur.autoAi });
        }
        return jres(res, { ok: true, autoAi: cur0.autoAi });
      }
      if (url.pathname === '/api/dnd' && req.method === 'POST') {
        if (!actions.setDnd) return jres(res, { error: 'tak didukung versi ini' }, 400);
        return jres(res, { ok: true, dnd: actions.setDnd(parseInt(body.minutes, 10) || 0) });
      }
      if (url.pathname === '/api/unmute' && req.method === 'POST') {
        if (!actions.unmute) return jres(res, { error: 'tak didukung versi ini' }, 400);
        return jres(res, { ok: true, ...(actions.unmute(body.num || 'all')) });
      }
      if (url.pathname === '/api/cooldown' && req.method === 'POST') {
        if (!actions.setCooldown) return jres(res, { error: 'tak didukung versi ini' }, 400);
        return jres(res, { ok: true, ...(actions.setCooldown(body.sec)) });
      }
      if (url.pathname === '/api/test' && req.method === 'POST') {
        if (!actions.testAi) return jres(res, { error: 'tak didukung versi ini' }, 400);
        try {
          const r = await actions.testAi(body.prompt);
          return jres(res, { ok: true, ...r });
        } catch (e) { return jres(res, { error: String(e.message || e).slice(0, 200) }, 500); }
      }
      if (url.pathname === '/api/brain') {
        if (!actions.getBrain) return jres(res, { error: 'tak didukung versi ini' }, 400);
        return jres(res, { ok: true, ...(actions.getBrain()) });
      }
      if (url.pathname === '/api/brain/reset' && req.method === 'POST') {
        if (!actions.resetBrain) return jres(res, { error: 'tak didukung versi ini' }, 400);
        try { return jres(res, { ok: true, ...(actions.resetBrain()) }); }
        catch (e) { return jres(res, { error: String(e.message || e).slice(0, 200) }, 500); }
      }
      if (url.pathname === '/api/owner') {
        return jres(res, { ok: true, ...(await probeOwner()) });
      }
      if (url.pathname === '/api/instance') {
        if (!actions.getInstance) return jres(res, { error: 'tak didukung versi ini' }, 400);
        try { return jres(res, { ok: true, inst: actions.getInstance() }); }
        catch (e) { return jres(res, { error: String(e.message || e).slice(0, 200) }, 500); }
      }
      if (url.pathname === '/api/token/regen' && req.method === 'POST') {
        try {
          const nt = regenTokenInEnv();
          liveToken = nt;
          try { (actions.log || (() => {}))('dash', 'DASH_TOKEN diregenerasi'); } catch {}
          return jres(res, { ok: true, token: nt });
        } catch (e) { return jres(res, { error: String(e.message || e).slice(0, 200) }, 500); }
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(page());
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('err');
    }
  });
  server.listen(port, host, () => console.log(`📊 Dashboard di ${host}:${port} (butuh token)`));
  server.on('error', (e) => {
    console.log(`⚠️ Dashboard gagal jalan di ${host}:${port}: ${e.message}. Bot tetap jalan tanpa dashboard.`);
    console.log('   Solusi: kill proses lama atau ganti DASH_PORT di .env');
    try { server.close(() => {}); } catch {}
  });
  return server;
}

module.exports = { startDashboard };
