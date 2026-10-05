#!/usr/bin/env node
/**
 * Global YO Register Bot - GUI version.
 * Runs a local web server with a graphical control panel.
 * Usage: node gui.js  (or run the exe)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { registerAccount, loadHotmailAccounts } = require('./lib');

const PORT = process.env.GUI_PORT || 3000;
const state = {
  running: false,
  done: 0,
  failed: 0,
  logs: [],
  accounts: [],
  hotmailCount: 0,
};

function log(m) {
  const line = `[${new Date().toLocaleTimeString('en-GB')}] ${m}`;
  state.logs.push(line);
  if (state.logs.length > 300) state.logs.shift();
  console.log(line);
}

function refreshHotmailCount() {
  try { state.hotmailCount = loadHotmailAccounts().length; }
  catch { state.hotmailCount = 0; }
}
refreshHotmailCount();

// --- HTTP server ---
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Serve the GUI page
  if (url.pathname === '/' && req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(GUI_HTML);
    return;
  }

  // API: status
  if (url.pathname === '/api/status' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      running: state.running,
      done: state.done,
      failed: state.failed,
      hotmailCount: state.hotmailCount,
      accounts: state.accounts,
      logs: state.logs.slice(-80),
    }));
    return;
  }

  // API: upload hotmail txt
  if (url.pathname === '/api/hotmails' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 5e6) req.destroy(); });
    req.on('end', () => {
      try {
        fs.writeFileSync(path.join(__dirname, 'hotmail_accounts.txt'), body, 'utf8');
        try { fs.unlinkSync(path.join(__dirname, '.used_hotmails.json')); } catch {}
        refreshHotmailCount();
        log(`📥 اتحفظ ملف الهوتميلات (${state.hotmailCount} حساب)`);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, count: state.hotmailCount }));
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // API: start registration
  if (url.pathname === '/api/register' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      if (state.running) {
        res.end(JSON.stringify({ ok: false, error: 'في تسجيل شغال بالفعل' }));
        return;
      }
      let first = 'Abood', last = 'Test';
      try { const j = JSON.parse(body); first = j.first || first; last = j.last || last; } catch {}
      state.running = true;
      log(`🚀 بدأ التسجيل (${first} ${last})...`);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
      // run in background
      try {
        const acc = await registerAccount({
          firstName: first, lastName: last,
          onProgress: (m) => log(m),
        });
        state.done++;
        state.accounts.unshift({ email: acc.email, password: acc.password, name: `${acc.firstName} ${acc.lastName}`, at: acc.createdAt });
        log(`✅ حساب جديد: ${acc.email}`);
      } catch (e) {
        state.failed++;
        log(`❌ فشل التسجيل: ${e.message}`);
      } finally {
        state.running = false;
      }
    });
    return;
  }

  res.statusCode = 404;
  res.end('not found');
});

const GUI_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Global YO Register Bot</title>
<style>
  * { box-sizing: border-box; font-family: 'Segoe UI', Tahoma, sans-serif; }
  body { background: #0f0f1a; color: #eee; margin: 0; padding: 20px; }
  .wrap { max-width: 800px; margin: 0 auto; }
  h1 { text-align: center; color: #a78bfa; }
  .card { background: #1a1a2e; border-radius: 12px; padding: 18px; margin: 14px 0; border: 1px solid #2d2d44; }
  .card h2 { margin: 0 0 12px; font-size: 17px; color: #c4b5fd; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  button { background: #7c3aed; color: #fff; border: 0; border-radius: 8px; padding: 10px 20px; font-size: 15px; cursor: pointer; }
  button:hover { background: #6d28d9; }
  button:disabled { background: #444; cursor: not-allowed; }
  input[type=text] { background: #0f0f1a; color: #eee; border: 1px solid #2d2d44; border-radius: 8px; padding: 9px 12px; font-size: 14px; }
  .stat { display: inline-block; background: #252542; border-radius: 8px; padding: 8px 16px; margin: 4px; font-size: 14px; }
  .stat b { color: #a78bfa; }
  #logs { background: #0a0a14; border-radius: 8px; padding: 12px; height: 260px; overflow-y: auto; font-size: 13px; line-height: 1.7; direction: ltr; text-align: left; }
  #logs div { border-bottom: 1px solid #1a1a2e; padding: 2px 0; }
  .acc { background: #252542; border-radius: 8px; padding: 10px 14px; margin: 6px 0; font-size: 14px; direction: ltr; text-align: left; }
  .acc code { color: #a78bfa; }
  .drop { border: 2px dashed #7c3aed; border-radius: 10px; padding: 24px; text-align: center; cursor: pointer; color: #a78bfa; }
  .drop:hover { background: #1a1a2e; }
  .ok { color: #4ade80; } .err { color: #f87171; }
</style>
</head>
<body>
<div class="wrap">
  <h1>🤖 Global YO Register Bot</h1>

  <div class="card">
    <h2>📊 الحالة</h2>
    <div id="stats"></div>
  </div>

  <div class="card">
    <h2>📧 الهوتميلات</h2>
    <div class="drop" id="drop">اسحب ملف الـ txt هنا أو دوس للاختيار<input type="file" id="file" accept=".txt" style="display:none"></div>
    <div id="hmStatus" style="margin-top:10px"></div>
  </div>

  <div class="card">
    <h2>🚀 تسجيل جديد</h2>
    <div class="row">
      <input type="text" id="first" placeholder="First name" value="Abood">
      <input type="text" id="last" placeholder="Last name" value="Test">
      <button id="regBtn" onclick="doRegister()">سجل دلوقتي</button>
    </div>
  </div>

  <div class="card">
    <h2>✅ الحسابات المنشأة</h2>
    <div id="accounts"><span style="color:#666">لسه مفيش حسابات</span></div>
  </div>

  <div class="card">
    <h2>📝 السجل</h2>
    <div id="logs"></div>
  </div>
</div>

<script>
const $ = id => document.getElementById(id);
async function refresh() {
  try {
    const s = await (await fetch('/api/status')).json();
    $('stats').innerHTML =
      '<span class="stat">الحالة: <b>' + (s.running ? '⏳ شغال' : '💤 فاضي') + '</b></span>' +
      '<span class="stat">هوتميلات: <b>' + s.hotmailCount + '</b></span>' +
      '<span class="stat">ناجح: <b class="ok">' + s.done + '</b></span>' +
      '<span class="stat">فاشل: <b class="err">' + s.failed + '</b></span>';
    $('regBtn').disabled = s.running;
    $('regBtn').textContent = s.running ? 'شغال...' : 'سجل دلوقتي';
    $('logs').innerHTML = s.logs.map(l => '<div>' + escapeHtml(l) + '</div>').join('');
    $('logs').scrollTop = $('logs').scrollHeight;
    if (s.accounts.length) {
      $('accounts').innerHTML = s.accounts.map(a =>
        '<div class="acc">📧 <code>' + escapeHtml(a.email) + '</code> | 🔑 <code>' + escapeHtml(a.password) + '</code> | 👤 ' + escapeHtml(a.name) + '</div>'
      ).join('');
    }
  } catch {}
}
function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
async function doRegister() {
  const first = $('first').value.trim() || 'Abood';
  const last = $('last').value.trim() || 'Test';
  await fetch('/api/register', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ first, last }) });
  refresh();
}
// file upload
const drop = $('drop'), fileInput = $('file');
drop.onclick = () => fileInput.click();
drop.ondragover = e => { e.preventDefault(); drop.style.background = '#1a1a2e'; };
drop.ondrop = e => { e.preventDefault(); drop.style.background = ''; if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]); };
fileInput.onchange = () => { if (fileInput.files[0]) uploadFile(fileInput.files[0]); };
async function uploadFile(f) {
  $('hmStatus').innerHTML = '⏳ برفع...';
  const text = await f.text();
  const r = await fetch('/api/hotmails', { method: 'POST', body: text });
  const j = await r.json();
  $('hmStatus').innerHTML = j.ok ? '<span class="ok">✅ اتحفظ! ' + j.count + ' هوتميل</span>' : '<span class="err">❌ ' + j.error + '</span>';
  refresh();
}
setInterval(refresh, 2000);
refresh();
</script>
</body>
</html>`;

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  log(`🌐 الواجهة شغالة على ${url}`);
  console.log(`\n✅ افتح المتصفح على: ${url}\n`);
  // Try to open the browser automatically (Windows)
  try {
    require('child_process').exec(`start ${url}`, { shell: true });
  } catch {}
});
