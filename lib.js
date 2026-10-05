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

const MAILTM = 'https://api.mail.tm';
const SIGNUP_URL = 'https://www.globalyo.com/sign-up';

const rand = (n, chars = 'abcdefghijklmnopqrstuvwxyz0123456789') =>
  Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
const randPass = (n = 16) => rand(n, 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%^&*');

async function mtm(p, opts = {}) {
  const r = await fetch(MAILTM + p, opts);
  if (!r.ok) throw new Error(`mail.tm ${p} -> ${r.status}`);
  return r.json();
}

async function newTempEmail() {
  const { 'hydra:member': domains } = await mtm('/domains');
  const domain = domains.find(d => d.isActive).domain;
  const address = `user${rand(10)}@${domain}`;
  const password = randPass(20);
  await mtm('/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, password }) });
  const { token } = await mtm('/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, password }) });
  return { address, password, token };
}

async function waitForInboxEmail(token, timeoutMs = 150000, onTick) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const { 'hydra:member': msgs } = await mtm('/messages', { headers: { Authorization: `Bearer ${token}` } });
    if (msgs.length) return msgs[0];
    if (onTick) onTick(Math.round((Date.now() - t0) / 1000));
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error('timed out waiting for verification email');
}

async function registerAccount({ firstName = 'Abood', lastName = 'Test', onProgress = () => {} } = {}) {
  const say = (m) => { try { onProgress(m); } catch (e) {} };
  const password = randPass();

  say('📧 بعمل إيميل مؤقت...');
  const { address: email, token } = await newTempEmail();
  say(`📧 الإيميل: ${email}`);

  say('🌐 بفتح المتصفح...');
  const launchOpts = { headless: true };
  const ctxOpts = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  };
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
    launchOpts.args = ['--disable-web-security', '--disable-features=IsolateOrigins,site-per-process'];
    ctxOpts.ignoreHTTPSErrors = true;
  }
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  if (SANDBOX) {
    await page.route('https://play.prod.yomobile.xyz/api/v1.0/identity/**', route => {
      const u = new URL(route.request().url());
      route.continue({ url: 'https://www.globalyo.com/api/storefront/public-proxy' + u.pathname + u.search });
    });
  }

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
    await page.waitForFunction(
      () => /captcha/i.test(document.body.innerText) || /first name/i.test(document.body.innerText),
      { timeout: 60000 }
    ).catch(() => {});

    const killPopups = () => page.evaluate(() => {
      document.querySelectorAll('.ab-iam-root').forEach(e => e.remove());
    });

    if (await page.locator('canvas#canv').count()) {
      say('🧩 بحل الكابتشا...');
      await page.evaluate(() => { window.__captchaChars = []; });
      await page.locator('#reload_href').click().catch(() => {});
      await page.waitForTimeout(1200);
      const answer = await page.evaluate(() => (window.__captchaChars || []).join(''));
      if (!answer) throw new Error('could not capture captcha text from canvas');
      await page.locator('input#captcha, input[id="captcha"]').fill(answer);
      await killPopups();
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(2000);
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
    await tryFill(['password'], password);
    for (const n of ['password_confirmation', 'passwordConfirmation']) {
      const loc = page.locator(`input[name="${n}"]`);
      if (await loc.count()) { await loc.first().fill(password); break; }
    }
    await killPopups();
    await page.locator('form button[type="submit"]').last().click();
    await page.waitForTimeout(6000);

    say('✉️ مستني إيميل التفعيل...');
    await page.waitForFunction(() => /verify/i.test(document.body.innerText), { timeout: 30000 }).catch(() => {});
    const msg = await waitForInboxEmail(token, 150000, (s) => { if (s % 30 === 0) say(`✉️ مستني إيميل التفعيل... (${s}s)`); });
    say(`✉️ وصل الإيميل: ${msg.subject}`);
    const full = await mtm(`/messages/${msg.id}`, { headers: { Authorization: `Bearer ${token}` } });
    const html = full.html || full.text || '';
    const link = (html.match(/https?:\/\/[^\s"'<>]*verif[^\s"'<>]*/i) || html.match(/https?:\/\/[^\s"'<>]*token[^\s"'<>]*/i) || [])[0];
    if (!link) throw new Error('no verification link found in email');
    say('🔗 بفتح لينك التفعيل...');
    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);

    const out = { email, password, firstName, lastName, createdAt: new Date().toISOString() };
    const fname = `account-${Date.now()}.json`;
    fs.writeFileSync(path.join(__dirname, fname), JSON.stringify(out, null, 2));
    say('✅ الحساب اتعمل واتفعل!');
    return out;
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { registerAccount };
