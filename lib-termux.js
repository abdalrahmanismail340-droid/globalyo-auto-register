/**
 * Termux/Android version of the registration logic.
 * Uses Chrome DevTools Protocol (CDP) directly instead of Playwright
 * (Playwright doesn't support Android).
 *
 * Usage:
 *   const { registerAccount } = require('./lib-termux');
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const CDP = require('chrome-remote-interface');

const SIGNUP_URL = 'https://www.globalyo.com/sign-up';
const CHROMIUM = '/data/data/com.termux/files/usr/bin/chromium';
const DEBUG_PORT = 19222;

const rand = (n, chars = 'abcdefghijklmnopqrstuvwxyz0123456789') =>
  Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
const randPass = (n = 16) => rand(n, 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%^&*');

// --- Hotmail pool (same as lib.js) ---
const HOTMAIL_TXT = path.join(__dirname, 'hotmail_accounts.txt');
const HOTMAIL_FILE = path.join(__dirname, 'hotmail_accounts.json');
const USED_FILE = path.join(__dirname, '.used_hotmails.json');

function parseHotmailLines(text) {
  return text.split('\n')
    .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(l => {
      const parts = l.split('|');
      if (parts.length >= 2) {
        return { email: parts[0].trim(), password: parts[1].trim(), refreshToken: (parts[2] || '').trim(), clientId: (parts[3] || '').trim() };
      }
      return null;
    }).filter(Boolean);
}
function loadHotmailAccounts() {
  let accounts = [];
  if (fs.existsSync(HOTMAIL_TXT)) accounts = parseHotmailLines(fs.readFileSync(HOTMAIL_TXT, 'utf8'));
  if (!accounts.length && fs.existsSync(HOTMAIL_FILE)) {
    try { accounts = JSON.parse(fs.readFileSync(HOTMAIL_FILE, 'utf8')); } catch {}
  }
  return accounts.filter(a => a.email && a.password);
}
function getUsedSet() {
  try { return new Set(JSON.parse(fs.readFileSync(USED_FILE, 'utf8'))); }
  catch { return new Set(); }
}
function nextHotmailAccount() {
  const accounts = loadHotmailAccounts();
  if (!accounts.length) throw new Error('مفيش هوتميلات! ابعت /sethotmails وبعدين ملف الـ txt');
  const used = getUsedSet();
  const fresh = accounts.find(a => !used.has(a.email.toLowerCase()));
  if (!fresh) throw new Error('كل الهوتميلات استُخدمت!');
  return fresh;
}
function markHotmailUsed(email) {
  const used = getUsedSet();
  used.add(email.toLowerCase());
  try { fs.writeFileSync(USED_FILE, JSON.stringify([...used], null, 1)); } catch {}
}

// --- Graph API / IMAP (same as lib.js) ---
function extractVerifyLink(text) {
  return (text.match(/https?:\/\/[^\s"'<>]*verif[^\s"'<>]*/i)
    || text.match(/https?:\/\/[^\s"'<>]*token[^\s"'<>]*/i) || [])[0] || null;
}
async function graphAccessToken(account) {
  const params = new URLSearchParams({
    client_id: account.clientId, refresh_token: account.refreshToken,
    grant_type: 'refresh_token', scope: 'https://graph.microsoft.com/Mail.Read offline_access',
  });
  const r = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('graph token: ' + (j.error_description || j.error || r.status));
  return j.access_token;
}
async function waitForHotmailVerify(account, timeoutMs = 180000, onTick) {
  // Try Graph API first
  if (account.refreshToken && account.clientId) {
    try {
      const at = await graphAccessToken(account);
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        const r = await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=10&$orderby=receivedDateTime%20desc&$select=subject,from,body',
          { headers: { Authorization: `Bearer ${at}` } });
        const j = await r.json().catch(() => ({}));
        for (const m of j.value || []) {
          const subj = (m.subject || '').toLowerCase();
          const from = (((m.from || {}).emailAddress) || {}).address || '';
          if (/global|yomobile|verify|verification/.test(subj + ' ' + from)) {
            const link = extractVerifyLink((m.body || {}).content || '');
            if (link) return { subject: m.subject, link };
          }
        }
        if (onTick) onTick(Math.round((Date.now() - t0) / 1000));
        await new Promise(r2 => setTimeout(r2, 8000));
      }
    } catch {}
  }
  throw new Error('timed out waiting for verification email');
}

// --- CDP browser controller ---
async function launchChromium() {
  // Kill any existing instance on our port
  try { execSync(`pkill -f "remote-debugging-port=${DEBUG_PORT}"`); } catch {}
  await new Promise(r => setTimeout(r, 1000));
  const proc = spawn(CHROMIUM, [
    '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--no-zygote', '--single-process', '--disable-software-rasterizer',
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'about:blank',
  ], { stdio: 'ignore', detached: true });
  proc.unref();
  // Wait for DevTools endpoint
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (r.ok) return proc;
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('chromium failed to start with remote debugging');
}

async function registerAccount({ firstName = 'Abood', lastName = 'Test', onProgress = () => {} } = {}) {
  const say = (m) => { try { onProgress(m); } catch {} };
  const hm = nextHotmailAccount();
  const email = hm.email;
  const yoPassword = randPass();
  say(`📧 الإيميل: ${email}`);

  say('🌐 بفتح المتصفح...');
  const proc = await launchChromium();
  let client;
  try {
    client = await CDP({ port: DEBUG_PORT });
    const { Page, Runtime, Fetch, Network } = client;
    await Promise.all([Page.enable(), Runtime.enable(), Network.enable()]);

    // Helper: evaluate JS in page
    const evl = async (expr, awaitPromise = false) => {
      const res = await Runtime.evaluate({ expression: expr, awaitPromise, returnByValue: true });
      if (res.exceptionDetails) throw new Error('eval failed: ' + (res.exceptionDetails.text || 'unknown'));
      return res.result ? res.result.value : undefined;
    };
    const goto = async (url) => {
      await Page.navigate({ url });
      await Page.loadEventFired();
      await new Promise(r => setTimeout(r, 3000));
    };

    // Track API calls via Network
    let lastApi = 'لم يتم أي طلب API';
    Network.responseReceived(async (params) => {
      const url = params.response.url || '';
      if (url.includes('/api/v1.0/identity/')) {
        lastApi = `${params.response.status} ${url.split('?')[0].split('/').slice(-2).join('/')}`;
        say(`🌐 API ← ${params.response.status}`);
      }
    });

    // 1) Go to signup
    await goto(SIGNUP_URL);

    // 2) Accept cookies if present
    await evl(`(() => {
      const btns = [...document.querySelectorAll('button')];
      const b = btns.find(x => /accept all/i.test(x.innerText));
      if (b) b.click();
    })()`).catch(() => {});

    // 3) Hook canvas fillText to capture captcha
    await evl(`(() => {
      window.__captchaText = '';
      const orig = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function(t, ...a) {
        if (this.canvas && this.canvas.id === 'canv' && /^[A-Za-z0-9]$/.test(t)) {
          window.__captchaText += t;
        }
        return orig.call(this, t, ...a);
      };
    })()`);

    // Wait for captcha to be drawn
    say('🧩 بحل الكابتشا...');
    let captcha = '';
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1500));
      captcha = await evl(`window.__captchaText || ''`).catch(() => '');
      if (captcha.length >= 6) break;
    }
    if (captcha.length < 6) throw new Error('الكابتشا متحلتش (canvas فاضي)');
    say(`🧩 الكابتشا: ${captcha}`);

    // 4) Fill form
    say('📝 بملا فورم التسجيل...');
    await evl(`(() => {
      const set = (names, val) => {
        for (const n of names) {
          const el = document.querySelector('input[name="' + n + '"]');
          if (el) { el.focus(); el.value = val; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); return true; }
        }
        return false;
      };
      set(['first_name','firstName'], ${JSON.stringify(firstName)});
      set(['last_name','lastName'], ${JSON.stringify(lastName)});
      set(['email'], ${JSON.stringify(email)});
      set(['password'], ${JSON.stringify(yoPassword)});
      const c1 = document.querySelector('input[name="password_confirmation"]') || document.querySelector('input[name="passwordConfirmation"]');
      if (c1) { c1.focus(); c1.value = ${JSON.stringify(yoPassword)}; c1.dispatchEvent(new Event('input', {bubbles:true})); }
      const cap = document.querySelector('input[name="captcha"], input[id*="captcha"]');
      if (cap) { cap.focus(); cap.value = ${JSON.stringify(captcha)}; cap.dispatchEvent(new Event('input', {bubbles:true})); }
    })()`);

    // 5) Submit
    await evl(`(() => {
      const f = document.querySelector('form');
      const btn = f ? f.querySelector('button[type="submit"]') : document.querySelector('button[type="submit"]');
      if (btn) btn.click();
    })()`);
    await new Promise(r => setTimeout(r, 8000));

    // 6) Check for API block
    if (/← (403|404|429|503)/.test(lastApi)) {
      throw new Error(`الـ API اتصد (آخر طلب: ${lastApi}). الـ IP متعلم عليه من Cloudflare.`);
    }

    // 7) Wait for verify text
    say('✉️ مستني إيميل التفعيل...');
    let verified = false;
    for (let i = 0; i < 20; i++) {
      const txt = await evl(`document.body.innerText`).catch(() => '');
      if (/verify/i.test(txt)) { verified = true; break; }
      await new Promise(r => setTimeout(r, 3000));
    }
    if (!verified) throw new Error(`التسجيل مكتملش. آخر طلب API: ${lastApi}`);

    // 8) Get verification email
    const vmail = await waitForHotmailVerify(hm, 180000, (s) => { if (s % 30 === 0) say(`✉️ مستني إيميل التفعيل... (${s}s)`); });
    say(`✉️ وصل الإيميل: ${vmail.subject}`);
    say('🔗 بفتح لينك التفعيل...');
    await goto(vmail.link);
    await new Promise(r => setTimeout(r, 4000));

    markHotmailUsed(email);
    const out = { email, password: yoPassword, hotmailPassword: hm.password, firstName, lastName, createdAt: new Date().toISOString() };
    const fname = `account-${Date.now()}.json`;
    fs.writeFileSync(path.join(__dirname, fname), JSON.stringify(out, null, 2));
    say('✅ الحساب اتعمل واتفعل!');
    return out;
  } finally {
    try { await client.close(); } catch {}
    try { proc.kill(); } catch {}
    try { execSync(`pkill -f "remote-debugging-port=${DEBUG_PORT}"`); } catch {}
  }
}

module.exports = { registerAccount, loadHotmailAccounts };
