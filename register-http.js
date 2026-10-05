/**
 * Pure-HTTP Global YO registration via the mobile app's OTP API.
 * No browser needed — works on Termux with clean mobile IP.
 *
 * Flow:
 *   1. POST /api/v1.0/identity/email-otp-registration/ {email}
 *   2. Read OTP from Hotmail via Graph API
 *   3. POST /api/v1.0/identity/email-otp-verification/ {email, otp}
 */
const fs = require('fs');
const path = require('path');

const API = 'https://play.prod.yomobile.xyz/api/v1.0';
const HEADERS = {
  'Content-Type': 'application/json',
  'X-PLATFORM': 'android',
  'User-Agent': 'GlobalYO/4.1.5 (Android)',
};

// --- Hotmail pool ---
const HOTMAIL_TXT = path.join(__dirname, 'hotmail_accounts.txt');
function parseHotmailLines(text) {
  return text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(l => {
      const p = l.split('|');
      return p.length >= 2 ? { email: p[0].trim(), password: p[1].trim(), refreshToken: (p[2]||'').trim(), clientId: (p[3]||'').trim() } : null;
    }).filter(Boolean);
}
function loadHotmailAccounts() {
  if (!fs.existsSync(HOTMAIL_TXT)) return [];
  return parseHotmailLines(fs.readFileSync(HOTMAIL_TXT, 'utf8')).filter(a => a.email && a.password);
}
const USED_FILE = path.join(__dirname, '.used_hotmails.json');
function getUsed() { try { return new Set(JSON.parse(fs.readFileSync(USED_FILE, 'utf8'))); } catch { return new Set(); } }
function nextAccount() {
  const accs = loadHotmailAccounts();
  if (!accs.length) throw new Error('مفيش هوتميلات!');
  const used = getUsed();
  const f = accs.find(a => !used.has(a.email.toLowerCase()));
  if (!f) throw new Error('كل الهوتميلات استُخدمت!');
  return f;
}
function markUsed(email) {
  const u = getUsed(); u.add(email.toLowerCase());
  try { fs.writeFileSync(USED_FILE, JSON.stringify([...u])); } catch {}
}

// --- Graph API for OTP ---
async function graphToken(acc) {
  const p = new URLSearchParams({ client_id: acc.clientId, refresh_token: acc.refreshToken, grant_type: 'refresh_token', scope: 'https://graph.microsoft.com/Mail.Read offline_access' });
  const r = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: p });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error('graph token failed');
  return j.access_token;
}
async function waitForOTP(acc, timeoutMs = 180000, onTick) {
  const at = await graphToken(acc);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=10&$orderby=receivedDateTime%20desc&$select=subject,body,receivedDateTime',
      { headers: { Authorization: `Bearer ${at}` } });
    const j = await r.json().catch(() => ({}));
    for (const m of j.value || []) {
      // Only look at emails from the last 5 minutes
      const age = Date.now() - new Date(m.receivedDateTime).getTime();
      if (age > 5 * 60 * 1000) continue;
      const subj = (m.subject || '').toLowerCase();
      const body = (m.body || {}).content || '';
      if (/global|yomobile|otp|verif|code/.test(subj)) {
        // Extract 4-6 digit OTP
        const otpM = body.match(/\b(\d{4,6})\b/);
        if (otpM) return { otp: otpM[1], subject: m.subject };
      }
    }
    if (onTick) onTick(Math.round((Date.now() - t0) / 1000));
    await new Promise(r2 => setTimeout(r2, 8000));
  }
  throw new Error('OTP email not received');
}

// --- Registration ---
async function apiCall(path, body, say) {
  const url = API + path;
  say(`🌐 POST ${path}`);
  const r = await fetch(url, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  const txt = await r.text();
  say(`🌐 ← ${r.status}`);
  let j = {};
  try { j = JSON.parse(txt); } catch { j = { _raw: txt.slice(0, 200) }; }
  if (!r.ok) say(`📄 ${JSON.stringify(j).slice(0, 200)}`);
  return { status: r.status, body: j };
}

async function registerAccount({ firstName = 'Abood', lastName = 'Test', onProgress = () => {} } = {}) {
  const say = (m) => { try { onProgress(m); } catch {} };
  const acc = nextAccount();
  const email = acc.email;
  say(`📧 الإيميل: ${email}`);

  // Step 1: Request OTP
  say('📤 بطلب كود التفعيل...');
  const reg = await apiCall('/identity/email-otp-registration/', { email, first_name: firstName, last_name: lastName }, say);
  if (reg.status === 403) throw new Error('الـ API اتصد (403) — الـ IP متعلم عليه');
  if (reg.status !== 200 && reg.status !== 201) throw new Error(`فشل طلب الكود: ${reg.status}`);

  // Step 2: Wait for OTP email
  say('✉️ مستني إيميل الكود...');
  const { otp, subject } = await waitForOTP(acc, 180000, (s) => { if (s % 30 === 0) say(`✉️ مستني... (${s}s)`); });
  say(`🔢 الكود وصل: ${otp}`);

  // Step 3: Verify OTP
  say('✅ بتحقق من الكود...');
  const deviceId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
  const ver = await apiCall('/identity/email-otp-verification/', { email, otp, device_id: deviceId }, say);
  if (ver.status !== 200 && ver.status !== 201) throw new Error(`فشل التحقق: ${ver.status}`);

  markUsed(email);
  const out = { email, hotmailPassword: acc.password, verifiedAt: new Date().toISOString(), apiResponse: ver.body };
  const fname = `account-${Date.now()}.json`;
  fs.writeFileSync(path.join(__dirname, fname), JSON.stringify(out, null, 2));
  say('✅ الحساب اتعمل واتفعل!');
  return out;
}

module.exports = { registerAccount, loadHotmailAccounts };

// CLI: node register-http.js
if (require.main === module) {
  registerAccount({ onProgress: console.log })
    .then(a => console.log('\n✅ DONE:', a.email))
    .catch(e => { console.error('\n❌ FAILED:', e.message); process.exit(1); });
}
