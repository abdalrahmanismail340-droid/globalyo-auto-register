/**
 * Core Global YO registration logic (shared by CLI and Telegram bot).
 * Usage:
 *   const { registerAccount } = require('./lib');
 *   const acc = await registerAccount({ firstName: 'Abood', lastName: 'Test', onProgress: console.log });
 */
const { chromium } = require('playwright');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

// Sandbox workaround: this dev environment sits behind a MITM egress proxy that
// headless Chromium can't use directly (and whose IP gets Cloudflare-challenged on
// the API domain). On a normal machine this is false and everything goes direct.
const EPROXY = process.env.HTTPS_PROXY || process.env.https_proxy || '';
const SANDBOX = /hatch-egress-proxy/.test(EPROXY);

const SIGNUP_URL = 'https://www.globalyo.com/sign-up';

const rand = (n, chars = 'abcdefghijklmnopqrstuvwxyz0123456789') =>
  Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
const randPass = (n = 16) => rand(n, 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%^&*');

const { ImapFlow } = require('imapflow');

// Hotmail account pool: reads accounts from hotmail_accounts.json (or .txt).
// Supported formats:
//   JSON: [{"email":"a@hotmail.com","password":"..."}, ...]
//   TXT:  one per line as  email:password  (or email|password)
// Used accounts are tracked in .used_hotmails.json so each /register uses a fresh one.
const HOTMAIL_FILE = path.join(__dirname, 'hotmail_accounts.json');
const HOTMAIL_TXT = path.join(__dirname, 'hotmail_accounts.txt');
const USED_FILE = path.join(__dirname, '.used_hotmails.json');

function loadHotmailAccounts() {
  let accounts = [];
  // 1) Env var (easiest for Railway): HOTMAIL_ACCOUNTS="email:pass\nemail2:pass2" or JSON
  const envAcc = process.env.HOTMAIL_ACCOUNTS || '';
  if (envAcc.trim()) {
    const t = envAcc.trim();
    if (t.startsWith('[')) {
      try { accounts = JSON.parse(t); } catch {}
    } else {
      accounts = parseHotmailLines(t);
    }
  }
  // 2) JSON file
  if (!accounts.length && fs.existsSync(HOTMAIL_FILE)) {
    try { accounts = JSON.parse(fs.readFileSync(HOTMAIL_FILE, 'utf8')); } catch {}
  }
  // 3) TXT file
  if (!accounts.length && fs.existsSync(HOTMAIL_TXT)) {
    accounts = parseHotmailLines(fs.readFileSync(HOTMAIL_TXT, 'utf8'));
  }
  return accounts.filter(a => a.email && a.password);
}

function parseHotmailLines(text) {
  return text.split('\n')
    .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(l => {
      const parts = l.split('|');
      if (parts.length >= 2) {
        return {
          email: parts[0].trim(),
          password: parts[1].trim(),
          refreshToken: (parts[2] || '').trim(),
          clientId: (parts[3] || '').trim(),
        };
      }
      const m = l.match(/^([^:|;\s]+)\s*[:|;]\s*(\S+)(?:\s*[:|;]\s*(\S+))?/);
      return m ? { email: m[1].trim(), password: m[2].trim(), extra: m[3] || '' } : null;
    }).filter(Boolean);
}

function getUsedSet() {
  try { return new Set(JSON.parse(fs.readFileSync(USED_FILE, 'utf8'))); }
  catch { return new Set(); }
}

function nextHotmailAccount() {
  const accounts = loadHotmailAccounts();
  if (!accounts.length) throw new Error('مفيش هوتميلات! حط ملف hotmail_accounts.json أو hotmail_accounts.txt جنب البوت');
  const used = getUsedSet();
  const fresh = accounts.find(a => !used.has(a.email.toLowerCase()));
  if (!fresh) throw new Error('كل الهوتميلات استُخدمت! ابعت ملف جديد أو امسح .used_hotmails.json');
  return fresh;
}

function markHotmailUsed(email) {
  const used = getUsedSet();
  used.add(email.toLowerCase());
  try { fs.writeFileSync(USED_FILE, JSON.stringify([...used], null, 1)); } catch {}
}

// Microsoft Graph API via OAuth refresh token (from the hotmail file's token fields).
async function graphAccessToken(account) {
  const params = new URLSearchParams({
    client_id: account.clientId,
    refresh_token: account.refreshToken,
    grant_type: 'refresh_token',
    scope: 'https://graph.microsoft.com/Mail.Read offline_access',
  });
  const r = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('graph token: ' + (j.error_description || j.error || r.status));
  return j.access_token;
}

function extractVerifyLink(text) {
  return (text.match(/https?:\/\/[^\s"'<>]*verif[^\s"'<>]*/i)
    || text.match(/https?:\/\/[^\s"'<>]*token[^\s"'<>]*/i) || [])[0] || null;
}

async function waitForGraphVerify(account, timeoutMs = 180000, onTick) {
  const accessToken = await graphAccessToken(account);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await fetch(
      'https://graph.microsoft.com/v1.0/me/messages?$top=10&$orderby=receivedDateTime%20desc&$select=subject,from,body',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (r.status === 401) throw new Error('graph token expired/invalid');
    const j = await r.json().catch(() => ({}));
    for (const m of j.value || []) {
      const subj = (m.subject || '').toLowerCase();
      const from = (((m.from || {}).emailAddress) || {}).address || '';
      if (/global|yomobile|verify|verification/.test(subj + ' ' + from)) {
        const body = (m.body || {}).content || '';
        const link = extractVerifyLink(body);
        if (link) return { subject: m.subject, link };
      }
    }
    if (onTick) onTick(Math.round((Date.now() - t0) / 1000));
    await new Promise(r2 => setTimeout(r2, 8000));
  }
  throw new Error('timed out waiting for verification email (Graph)');
}

// Wait for the Global YO verification email: try Graph API (token) first, fall back to IMAP.
async function waitForHotmailVerify(account, timeoutMs = 180000, onTick) {
  if (account.refreshToken && account.clientId) {
    try { return await waitForGraphVerify(account, timeoutMs, onTick); }
    catch (e) { onTick && onTick(0); /* fall through to IMAP */ }
  }
  return waitForImapVerify(account, timeoutMs, onTick);
}

// Wait for the Global YO verification email in a Hotmail inbox via IMAP.
async function waitForImapVerify({ email, password }, timeoutMs = 180000, onTick) {
  const client = new ImapFlow({
    host: 'outlook.office365.com', port: 993, secure: true,
    auth: { user: email, pass: password },
    logger: false,
  });
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        // search recent unseen (or all recent) messages
        const ids = await client.search({ since: new Date(Date.now() - 3600e3) }, { uid: true });
        for (const uid of ids.slice(-10)) {
          const msg = await client.fetchOne(uid.toString(), { bodyParts: ['text'], envelope: true });
          const subj = (msg.envelope.subject || '').toLowerCase();
          const from = ((msg.envelope.from || [])[0] || {}).address || '';
          if (/global|yomobile|verify|verification/.test(subj + ' ' + from)) {
            const body = (msg.bodyParts || []).map(p => p.toString()).join('\n');
            const link = (body.match(/https?:\/\/[^\s"'<>]*verif[^\s"'<>]*/i)
              || body.match(/https?:\/\/[^\s"'<>]*token[^\s"'<>]*/i) || [])[0];
            if (link) return { subject: msg.envelope.subject, link };
          }
        }
        if (onTick) onTick(Math.round((Date.now() - t0) / 1000));
        await new Promise(r => setTimeout(r, 8000));
      }
      throw new Error('timed out waiting for verification email in Hotmail');
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }
}

// Fallback: screenshot the captcha canvas and read it with OCR.Space (free API).
// Set OCRSPACE_KEY env var with your own free key from https://ocr.space/ocrapi
// (defaults to the public demo key, which is heavily rate-limited).
async function solveCaptchaOCR(page) {
  const key = process.env.OCRSPACE_KEY || 'helloworld';
  const buf = await page.locator('canvas#canv').screenshot();
  const form = new FormData();
  form.append('apikey', key);
  form.append('base64Image', 'data:image/png;base64,' + buf.toString('base64'));
  form.append('OCREngine', '2');
  form.append('scale', 'true');
  form.append('isTable', 'false');
  const r = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: form });
  const j = await r.json();
  if (j.IsErroredOnProcessing) throw new Error('ocr.space: ' + (j.ErrorMessage || 'processing error'));
  const text = ((j.ParsedResults || [])[0] || {}).ParsedText || '';
  return text.replace(/[^A-Za-z0-9]/g, '').slice(0, 6);
}

async function registerAccount({ firstName = 'Abood', lastName = 'Test', onProgress = () => {} } = {}) {
  const say = (m) => { try { onProgress(m); } catch (e) {} };
  const MAX_TRIES = 3;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      if (attempt > 1) say(`🔄 محاولة ${attempt}/${MAX_TRIES}...`);
      return await attemptOnce({ firstName, lastName, say });
    } catch (e) {
      lastErr = e;
      say(`⚠️ المحاولة ${attempt} فشلت: ${e.message}`);
      if (attempt < MAX_TRIES) await new Promise(r => setTimeout(r, 5000));
    }
  }
  throw lastErr;
}

async function attemptOnce({ firstName, lastName, say }) {
  const password = randPass();

  say('📧 بجيب هوتميل جديد من الملف...');
  const hm = nextHotmailAccount();
  const email = hm.email;
  const yoPassword = randPass(); // password for the new Global YO account
  say(`📧 الإيميل: ${email}`);

  say('🌐 بفتح المتصفح...');
  const launchOpts = {
    headless: true,
    // required for Chromium in Docker / low-RAM containers (Railway)
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-software-rasterizer'],
  };
  const ctxOpts = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  };
  // Optional residential proxy: PROXY_URL=http://user:pass@host:port
  // Routes all browser traffic through it (bypasses datacenter IP blocks).
  const PROXY_URL = process.env.PROXY_URL || '';
  if (PROXY_URL && !SANDBOX) {
    try {
      const pu = new URL(PROXY_URL);
      launchOpts.proxy = {
        server: `${pu.protocol}//${pu.host}`,
        username: pu.username ? decodeURIComponent(pu.username) : undefined,
        password: pu.password ? decodeURIComponent(pu.password) : undefined,
      };
      say('🔀 البروكسي متفعل — كل الترافيك هيعدي من خلاله');
    } catch { say('⚠️ PROXY_URL مش سليم — هكمل من غير بروكسي'); }
  }
  if (SANDBOX) {
    const probe = await new Promise(resolve => {
      const s = require('net').connect(8899, '127.0.0.1');
      s.on('connect', () => { s.destroy(); resolve(true); });
      s.on('error', () => resolve(false));
      setTimeout(() => resolve(false), 2000);
    });
    if (!probe) {
      const proxyProc = spawn('node', [path.join(__dirname, 'fwd-proxy.js')], { stdio: 'ignore', detached: true });
      proxyProc.unref();
      await new Promise(r => setTimeout(r, 1500));
    }
    launchOpts.proxy = { server: 'http://127.0.0.1:8899' };
    launchOpts.args.push('--disable-web-security', '--disable-features=IsolateOrigins,site-per-process');
    ctxOpts.ignoreHTTPSErrors = true;
  }
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  let lastApi = 'لم يتم أي طلب API';
  // Smart routing for the identity API: try direct first; if Cloudflare challenges
  // the XHR (403 + challenge page), retry the same request through the site's own
  // same-origin Next.js proxy (/api/storefront/public-proxy + original path).
  await page.route('https://play.prod.yomobile.xyz/api/v1.0/identity/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const viaProxy = 'https://www.globalyo.com/api/storefront/public-proxy' + u.pathname + u.search;
    const useProxy = async (why) => {
      say(`🛡️ ${why} — بحول على سيرفر الموقع...`);
      try {
        const proxyResp = await route.fetch({ url: viaProxy, timeout: 30000 });
        const proxyBody = await proxyResp.text().catch(() => '');
        const psnip = proxyBody.replace(/\s+/g, ' ').slice(0, 200);
        lastApi = `${req.method()} ${u.pathname} ← بروكسي ${proxyResp.status()}`;
        say(`🌐 بروكسي ← ${proxyResp.status()}`);
        if (proxyResp.status() >= 400) say(`📄 رد البروكسي: ${psnip || '(فارغ)'}`);
        return route.fulfill({ response: proxyResp });
      } catch (e) {
        lastApi = `${req.method()} ${u.pathname} ← البروكسي فشل`;
        say(`❌ البروكسي فشل: ${e.message.split('\n')[0]}`);
        return route.continue();
      }
    };
    if (SANDBOX) return useProxy('وضع الاختبار');
    try {
      const resp = await route.fetch({ timeout: 25000 });
      const body = await resp.text().catch(() => '');
      const snippet = body.replace(/\s+/g, ' ').slice(0, 200);
      lastApi = `${req.method()} ${u.pathname} ← ${resp.status()}`;
      say(`🌐 API ${req.method()} ${u.pathname} ← ${resp.status()}`);
      if (resp.status() >= 400) say(`📄 الرد: ${snippet || '(فارغ)'}`);
      // Any 403/429/503 on the identity API from a datacenter IP is treated as
      // a network-level block -> retry the same request via the site's own proxy.
      if ([403, 429, 503].includes(resp.status())) {
        return useProxy(`الـ API رد ${resp.status()}`);
      }
      return route.fulfill({ response: resp });
    } catch (e) {
      return useProxy(`تعذر الوصول المباشر (${e.message.split('\n')[0]})`);
    }
  });

  await page.addInitScript(() => {
    window.__captchaChars = [];
    const orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      try { if (this.canvas && this.canvas.id === 'canv') window.__captchaChars.push(String(text)); } catch (e) {}
      return orig.call(this, text, ...args);
    };
  });

  try {
    say('🛡️ بعدي Cloudflare...');
    try {
      await page.goto('https://play.prod.yomobile.xyz/api/v1.0/', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForFunction(() => !/just a moment/i.test(document.title), { timeout: 45000 });
    } catch (e) { /* best-effort */ }
    await page.goto(SIGNUP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // accept the cookie banner if it shows up (it can overlay the form)
    try {
      const acceptBtn = page.getByRole('button', { name: /accept all/i }).first();
      if (await acceptBtn.count()) {
        await acceptBtn.click({ timeout: 8000 });
        say('🍪 قبلت الكوكيز');
        await page.waitForTimeout(1000);
      }
    } catch (e) { /* no banner or already gone */ }
    await page.waitForFunction(
      () => /captcha/i.test(document.body.innerText) || /first name/i.test(document.body.innerText),
      { timeout: 60000 }
    ).catch(() => {});

    const killPopups = () => page.evaluate(() => {
      document.querySelectorAll('.ab-iam-root').forEach(e => e.remove());
    });

    if (await page.locator('canvas#canv').count()) {
      say('🧩 بحل الكابتشا...');
      // Strategy 1: hook — exact chars captured from the canvas as drawn (100% accurate).
      // Take the LAST 6 in case of a double-draw (the validator always holds the latest).
      const readCaptcha = () => page.evaluate(() =>
        ((window.__captchaChars || []).slice(-6).join('')));
      const waitChars = () => page.waitForFunction(
        () => (window.__captchaChars || []).length >= 6, { timeout: 20000 }).catch(() => {});
      await waitChars();
      let answer = await readCaptcha();
      if (!answer || answer.length < 6) {
        // force a fresh draw via the site's own reload handler, then wait for it
        await page.evaluate(() => {
          window.__captchaChars = [];
          const a = document.getElementById('reload_href');
          if (a) a.click();
        });
        await waitChars();
        answer = await readCaptcha();
      }
      // Strategy 2: OCR fallback — screenshot the canvas and read it with OCR.Space
      if (!answer || answer.length < 6) {
        say('🔍 بجرب قراءة الصورة (OCR)...');
        try {
          answer = await solveCaptchaOCR(page);
          if (answer) say(`🔍 الـ OCR قرأ: ${answer}`);
        } catch (e) { say(`🔍 الـ OCR فشل: ${e.message}`); }
      }
      if (!answer) {
        await page.screenshot({ path: 'captcha-fail.png' }).catch(() => {});
        throw new Error('could not solve captcha');
      }
      await page.locator('input#captcha, input[id="captcha"]').fill(answer);
      await killPopups();
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(2500);
      // if the canvas is still there, the answer was rejected -> let the retry loop handle it
      if (await page.locator('canvas#canv').count()) {
        throw new Error('captcha answer rejected, retrying');
      }
    }

    say('📝 بملا فورم التسجيل...');
    await page.waitForSelector('input[name="first_name"], input[id*="first"]', { timeout: 30000 });
    const tryFill = async (names, val) => {
      for (const n of names) {
        const loc = page.locator(`input[name="${n}"]`);
        if (await loc.count()) { await loc.first().fill(val); return; }
      }
      throw new Error('field not found: ' + names[0]);
    };
    await tryFill(['first_name'], firstName);
    await tryFill(['last_name'], lastName);
    await tryFill(['email'], email);
    await tryFill(['password'], yoPassword);
    for (const n of ['password_confirmation', 'passwordConfirmation']) {
      const loc = page.locator(`input[name="${n}"]`);
      if (await loc.count()) { await loc.first().fill(yoPassword); break; }
    }
    await killPopups();
    await page.locator('form button[type="submit"]').last().click();
    await page.waitForTimeout(6000);

    say('✉️ مستني إيميل التفعيل...');
    const verifyShown = await page.waitForFunction(
      () => /verify/i.test(document.body.innerText), { timeout: 30000 }
    ).then(() => true).catch(() => false);
    if (!verifyShown) {
      const txt = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 300));
      throw new Error(`التسجيل مكتملش. آخر طلب API: ${lastApi}. الصفحة بتقول: ` + txt);
    }
    const vmail = await waitForHotmailVerify(hm, 180000, (s) => { if (s % 30 === 0) say(`✉️ مستني إيميل التفعيل... (${s}s)`); });
    say(`✉️ وصل الإيميل: ${vmail.subject}`);
    say('🔗 بفتح لينك التفعيل...');
    await page.goto(vmail.link, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);

    markHotmailUsed(email);
    const out = { email, password: yoPassword, hotmailPassword: hm.password, firstName, lastName, createdAt: new Date().toISOString() };
    const fname = `account-${Date.now()}.json`;
    fs.writeFileSync(path.join(__dirname, fname), JSON.stringify(out, null, 2));
    say('✅ الحساب اتعمل واتفعل!');
    return out;
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { registerAccount };
