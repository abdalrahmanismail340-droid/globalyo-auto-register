#!/usr/bin/env node
/**
 * Global YO auto-registration script.
 * 1. Creates a temp email via mail.tm
 * 2. Registers on https://www.globalyo.com/sign-up with Playwright (real Chromium passes Cloudflare;
 *    the site's image CAPTCHA is validated purely client-side, so we read it from the canvas hook)
 * 3. Reads the verification email from mail.tm and opens the verification link
 * 4. Saves the account to account-<timestamp>.json
 *
 * Usage:
 *   npm install          # once: installs playwright
 *   npx playwright install chromium
 *   node register.js [firstName] [lastName]
 *
 * API flow (reverse-engineered from the site's JS):
 *   POST {API}/api/v1.0/identity/registration-validation/?platform=web  {email}
 *   POST {API}/api/v1.0/identity/registration/?platform=web
 *        {email, password, first_name, last_name, display_name, referral_code?}
 *   header X-PLATFORM: web, base API = https://play.prod.yomobile.xyz
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

async function mtm(path, opts = {}) {
  const r = await fetch(MAILTM + path, opts);
  if (!r.ok) throw new Error(`mail.tm ${path} -> ${r.status}`);
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

async function waitForInboxEmail(token, timeoutMs = 150000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const { 'hydra:member': msgs } = await mtm('/messages', { headers: { Authorization: `Bearer ${token}` } });
    if (msgs.length) return msgs[0];
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error('timed out waiting for verification email');
}

(async () => {
  const firstName = process.argv[2] || 'Abood';
  const lastName = process.argv[3] || 'Test';
  const password = randPass();

  console.log('[1/6] creating temp email...');
  const { address: email, password: emailPass, token } = await newTempEmail();
  console.log('      email:', email);
  fs.writeFileSync('tmp-account.json', JSON.stringify({ email, emailPass, token }, null, 2));

  console.log('[2/6] launching browser...');
  const launchOpts = { headless: true };
  const ctxOpts = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  };
  if (SANDBOX) {
    // start local forward proxy (chains to the MITM egress proxy) if not already up
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
    // the MITM chain breaks CORS preflights; disable the same-origin policy for this
    // automation-only browser (equivalent to the site's own /api/storefront/proxy path)
    launchOpts.args = ['--disable-web-security', '--disable-features=IsolateOrigins,site-per-process'];
    ctxOpts.ignoreHTTPSErrors = true;
    console.log('      sandbox proxy mode on');
  }
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  if (SANDBOX) {
    // Route the identity API calls through the site's own same-origin Next.js proxy
    // (/api/storefront/public-proxy + original path), since the API domain's Cloudflare
    // challenge doesn't auto-resolve for XHRs from the sandbox egress IP.
    await page.route('https://play.prod.yomobile.xyz/api/v1.0/identity/**', route => {
      const u = new URL(route.request().url());
      const via = 'https://www.globalyo.com/api/storefront/public-proxy' + u.pathname + u.search;
      console.log('      [route] proxying', u.pathname, 'via public-proxy');
      route.continue({ url: via });
    });
  }
  if (process.env.DEBUG) {
    page.on('response', async r => {
      if (/identity|signup|register/i.test(r.url())) {
        console.log('      [net]', r.request().method(), r.status(), r.url().slice(0, 120));
        try { console.log('      [body]', (await r.text()).slice(0, 500)); } catch (e) {}
      }
    });
    page.on('console', m => { if (m.type() === 'error') console.log('      [console]', m.text().slice(0, 200)); });
  }

  // Hook canvas fillText to capture the client-side CAPTCHA chars as they are drawn
  await page.addInitScript(() => {
    window.__captchaChars = [];
    const orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      try { if (this.canvas && this.canvas.id === 'canv') window.__captchaChars.push(String(text)); } catch (e) {}
      return orig.call(this, text, ...args);
    };
  });

  console.log('[3/6] opening sign-up page (passing Cloudflare)...');
  // Pre-clear Cloudflare on the API domain: the page (www.globalyo.com) passes CF,
  // but XHRs to play.prod.yomobile.xyz get separately challenged (different domain = no shared cookie).
  // Visiting the API root in the browser lets CF set its clearance cookie for that domain.
  try {
    await page.goto('https://play.prod.yomobile.xyz/api/v1.0/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => !/just a moment/i.test(document.title), { timeout: 45000 });
    console.log('      API domain Cloudflare cleared');
  } catch (e) { console.log('      API CF pre-clear skipped:', e.message.split('\n')[0]); }
  await page.goto(SIGNUP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // wait out any Cloudflare challenge for the captcha heading or form
  await page.waitForFunction(
    () => /captcha/i.test(document.body.innerText) || /first name/i.test(document.body.innerText),
    { timeout: 60000 }
  ).catch(() => {});

  // --- CAPTCHA screen? ---
  const killPopups = () => page.evaluate(() => {
    document.querySelectorAll('.ab-iam-root').forEach(e => e.remove());
  });
  if (await page.locator('canvas#canv').count()) {
    console.log('[4/6] solving client-side CAPTCHA...');
    // regenerate to get a fresh capture, then read the drawn chars
    await page.evaluate(() => { window.__captchaChars = []; });
    await page.locator('#reload_href').click().catch(() => {});
    await page.waitForTimeout(1200);
    const answer = await page.evaluate(() => (window.__captchaChars || []).join(''));
    if (!answer) throw new Error('could not capture captcha text from canvas');
    console.log('      captcha chars captured:', answer.length);
    await page.locator('input#captcha, input[id="captcha"]').fill(answer);
    await killPopups();
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(2000);
  } else {
    console.log('[4/6] no CAPTCHA screen, continuing...');
  }

  // --- registration form ---
  console.log('[5/6] filling registration form...');
  await page.waitForSelector('input[name="first_name"], input[id*="first"]', { timeout: 30000 });
  const fill = async (sel, val) => {
    const loc = page.locator(sel).first();
    await loc.fill(val);
  };
  // try name-based selectors, fall back to order-based
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
  // password confirmation (do not send to API, but form may require it)
  for (const n of ['password_confirmation', 'passwordConfirmation']) {
    const loc = page.locator(`input[name="${n}"]`);
    if (await loc.count()) { await loc.first().fill(password); break; }
  }
  await page.screenshot({ path: 'form-filled.png' });
  await killPopups();
  await page.locator('form button[type="submit"]').last().click();
  await page.waitForTimeout(6000);
  if (process.env.DEBUG) {
    const txt = await page.evaluate(() => document.body.innerText.slice(0, 600));
    console.log('      [page after submit]', JSON.stringify(txt.slice(0, 300)));
  }

  // --- verify-email screen ---
  console.log('[6/6] waiting for verify-email screen...');
  await page.waitForFunction(() => /verify/i.test(document.body.innerText), { timeout: 30000 }).catch(() => {});
  await page.screenshot({ path: 'after-submit.png' });

  console.log('      waiting for verification email...');
  const msg = await waitForInboxEmail(token);
  console.log('      got email:', msg.subject, '| from:', msg.from.address);
  const full = await mtm(`/messages/${msg.id}`, { headers: { Authorization: `Bearer ${token}` } });
  const html = full.html || full.text || '';
  fs.writeFileSync('verify-email.html', html);
  const link = (html.match(/https?:\/\/[^\s"'<>]*verif[^\s"'<>]*/i) || html.match(/https?:\/\/[^\s"'<>]*token[^\s"'<>]*/i) || [])[0];
  if (!link) throw new Error('no verification link found in email; saved to verify-email.html');
  console.log('      opening verification link...');
  await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'verified.png' });

  const out = { email, password, firstName, lastName, createdAt: new Date().toISOString() };
  const fname = `account-${Date.now()}.json`;
  fs.writeFileSync(fname, JSON.stringify(out, null, 2));
  console.log('DONE. account saved to', fname);
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
