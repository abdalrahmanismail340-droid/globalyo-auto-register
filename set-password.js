/**
 * Set password for a Global YO account via the password-reset flow:
 * 1. POST /identity/password-reset/ {email} → reset email sent
 * 2. Read reset token/link from Hotmail via Graph API
 * 3. POST /identity/password-reset-token/ {token, password}
 *
 * Usage: node set-password.js <email> <new_password>
 */
const fs = require('fs');
const path = require('path');

const API = 'https://play.prod.yomobile.xyz/api/v1.0';
const HEADERS = {
  'Content-Type': 'application/json',
  'X-PLATFORM': 'android',
  'User-Agent': 'GlobalYO/4.1.5 (Android)',
};

// --- Hotmail lookup ---
function findHotmail(email) {
  const txt = fs.readFileSync(path.join(__dirname, 'hotmail_accounts.txt'), 'utf8');
  for (const l of txt.split('\n')) {
    const p = l.trim().split('|');
    if (p[0] && p[0].trim().toLowerCase() === email.toLowerCase() && p.length >= 4) {
      return { email: p[0].trim(), password: p[1].trim(), refreshToken: p[2].trim(), clientId: p[3].trim() };
    }
  }
  return null;
}

async function graphToken(acc) {
  const p = new URLSearchParams({ client_id: acc.clientId, refresh_token: acc.refreshToken, grant_type: 'refresh_token', scope: 'https://graph.microsoft.com/Mail.Read offline_access' });
  const r = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: p });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error('graph token failed');
  return j.access_token;
}

// Wait for password-reset email, extract token or link
async function waitForResetEmail(acc, sinceTime, timeoutMs = 180000, onProgress = () => {}) {
  const say = (m) => { try { onProgress(m); } catch {} };
  const at = await graphToken(acc);
  const t0 = Date.now();
  const seen = new Set();
  while (Date.now() - t0 < timeoutMs) {
    const r = await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=10&$orderby=receivedDateTime%20desc&$select=id,subject,body,receivedDateTime',
      { headers: { Authorization: `Bearer ${at}` } });
    const j = await r.json().catch(() => ({}));
    for (const m of j.value || []) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const recv = new Date(m.receivedDateTime).getTime();
      if (isNaN(recv) || recv < sinceTime - 10000) continue;
      const subj = (m.subject || '').toLowerCase();
      const body = (m.body || {}).content || '';
      if (/reset|password|contrase/.test(subj)) {
        const text = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
        // Extract all links from raw HTML (href attributes) + plain text URLs
        const allLinks = [...body.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)].map(m => m[1]);
        const textUrls = [...text.matchAll(/(https?:\/\/[^\s]+)/gi)].map(m => m[1]);
        const links = [...new Set([...allLinks, ...textUrls])];
        say(`🔗 لقيت ${links.length} لينك في الإيميل`);
        for (const l of links.slice(0, 5)) say(`🔗 ${l.slice(0, 150)}`);
        const linkM = links.find(l => /reset|token|password/i.test(l)) || links[0];
        const tokenM = text.match(/(?:token|code)[^0-9a-zA-Z]{0,20}([a-zA-Z0-9\-_]{10,})/i);
        console.log('📧 Reset email:', m.subject);
        say(`📧 إيميل الاسترجاع وصل: ${m.subject}`);
        return { link: linkM || null, token: tokenM ? tokenM[1] : null, allLinks: links, fullText: text };
      }
    }
    await new Promise(r2 => setTimeout(r2, 8000));
  }
  throw new Error('Reset email not received');
}

async function main() {
  const email = process.argv[2];
  const newPass = process.argv[3];
  if (!email || !newPass) { console.log('Usage: node set-password.js <email> <new_password>'); process.exit(1); }
  await setPassword(email, newPass, console.log);
  console.log('✅ Password set!');
}

async function setPassword(email, newPass, onProgress = () => {}) {
  const say = (m) => { try { onProgress(m); } catch {} };
  const acc = findHotmail(email);
  if (!acc) throw new Error('Hotmail account not found in hotmail_accounts.txt');

  const deviceId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });

  // Step 1: Request reset token (try password-reset-token first, then password-reset)
  say('📤 بطلب توكن الاسترجاع...');
  let reqOk = false;
  let reqBody = null;
  for (const ep of ['/identity/password-reset-token/', '/identity/password-reset/']) {
    const r = await fetch(API + ep, {
      method: 'POST', headers: HEADERS, body: JSON.stringify({ email, device_id: deviceId }),
    });
    const t = await r.text();
    say(`← ${ep} ${r.status}`);
    if (r.ok) { reqOk = true; try { reqBody = JSON.parse(t); } catch {} break; }
  }
  if (!reqOk) throw new Error('فشل طلب توكن الاسترجاع');
  // The 201 response might contain the reset token directly!
  if (reqBody) {
    const direct = reqBody.reset_token || reqBody.token || (reqBody.data && (reqBody.data.reset_token || reqBody.data.token));
    if (direct) {
      say('🔑 التوكن من الـ response مباشرة');
      return await submitNewPassword(deviceId, direct, newPass, say);
    }
  }

  // Step 2: Read reset email
  say('✉️ مستني إيميل الاسترجاع...');
  const since = Date.now();
  const { link, token, allLinks } = await waitForResetEmail(acc, since, 180000, say);
  // Extract reset_token from link query params or path
  // Links may be double-URL-encoded (AWS tracking wrapper) — decode first
  // Tracking links (awstrack.me) redirect — follow to get the real URL with full token
  let resetToken = token;
  const linksToTry = [...(allLinks || []), link].filter(Boolean);
  for (let l of linksToTry) {
    if (resetToken && resetToken.length > 20) break;
    // Follow redirects to get final URL (tracking wrappers truncate the token)
    let finalUrl = l;
    try {
      say('🔄 بتبع التحويل...');
      const rr = await fetch(l, { method: 'HEAD', redirect: 'follow' });
      if (rr.url && rr.url !== l) { finalUrl = rr.url; say('🔗 الرابط النهائي وصل'); }
    } catch {}
    // Decode repeatedly (tracking wrappers double-encode)
    let dec = finalUrl;
    for (let i = 0; i < 3; i++) {
      try { const d2 = decodeURIComponent(dec); if (d2 === dec) break; dec = d2; } catch { break; }
    }
    const qm = dec.match(/[?&](token|reset_token|code|key)=([^&]+)/i);
    if (qm && qm[2].length > 20) { resetToken = qm[2]; break; }
    const pm = dec.match(/\/([a-f0-9\-]{20,})\/?(?:\?|$)/i);
    if (pm) { resetToken = pm[1]; break; }
  }
  if (!resetToken) throw new Error('ملقتش توكن الاسترجاع في الإيميل');
  say(`🔑 التوكن وصل`);

  // Step 3: Submit new password
  return await submitNewPassword(deviceId, resetToken, newPass, say);
}

async function submitNewPassword(deviceId, resetToken, newPass, say) {
  say('🔑 بعين الباسورد الجديد...');
  const r2 = await fetch(API + '/identity/password-reset/', {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify({ device_id: deviceId, reset_token: resetToken, password: newPass }),
  });
  const t2 = await r2.text();
  say(`← ${r2.status}`);
  if (!r2.ok) throw new Error('فشل تعيين الباسورد: ' + r2.status + ' ' + t2.slice(0, 150));
  return true;
}

module.exports = { setPassword };

if (require.main === module) main().catch(e => { console.error('❌ FAILED:', e.message); process.exit(1); });
