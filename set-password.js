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
      if (/reset|password/.test(subj)) {
        const text = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
        // Try: reset link with token, or a raw token
        const linkM = text.match(/https?:\/\/[^\s"']*reset[^\s"']*/i);
        const tokenM = text.match(/(?:token|code)[^0-9a-zA-Z]{0,20}([a-zA-Z0-9\-_]{10,})/i);
        console.log('📧 Reset email:', m.subject);
        say(`📧 إيميل الاسترجاع وصل: ${m.subject}`);
        console.log('🔍 Context:', text.slice(0, 300));
        return { link: linkM ? linkM[0] : null, token: tokenM ? tokenM[1] : null, fullText: text };
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

  // Step 1: Request password reset
  say('📤 Requesting password reset...');
  const r1 = await fetch(API + '/identity/password-reset/', {
    method: 'POST', headers: HEADERS, body: JSON.stringify({ email }),
  });
  const t1 = await r1.text();
  say(`← ${r1.status}`);
  if (!r1.ok) throw new Error('password-reset failed: ' + r1.status + ' ' + t1.slice(0, 150));

  // Step 2: Read reset email
  say('✉️ Waiting for reset email...');
  const since = Date.now();
  const { link, token, fullText } = await waitForResetEmail(acc, since, 180000, say);

  // Step 3: Submit new password (try common field combinations)
  const attempts = [];
  if (token) attempts.push({ token, password: newPass }, { token, new_password: newPass });
  if (link) {
    const tm = link.match(/(?:token|code)=([^&]+)/);
    if (tm) attempts.push({ token: tm[1], password: newPass }, { token: tm[1], new_password: newPass });
  }
  for (const body of attempts) {
    say('🔑 Trying password-reset-token...');
    const r2 = await fetch(API + '/identity/password-reset-token/', {
      method: 'POST', headers: HEADERS, body: JSON.stringify(body),
    });
    const t2 = await r2.text();
    say(`← ${r2.status}`);
    if (r2.ok) return true;
  }
  throw new Error('All password-reset-token attempts failed');
}

module.exports = { setPassword };

if (require.main === module) main().catch(e => { console.error('❌ FAILED:', e.message); process.exit(1); });
