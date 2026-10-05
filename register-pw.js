/**
 * Register via the password-based endpoint (not OTP).
 * POST /identity/registration/ {email, password, first_name, last_name, display_name, device_id}
 * Usage: node register-pw.js <email> <password> [first] [last]
 */
const fs = require('fs');
const path = require('path');
const API = 'https://play.prod.yomobile.xyz/api/v1.0';
const HEADERS = {
  'Content-Type': 'application/json',
  'X-PLATFORM': 'android',
  'User-Agent': 'GlobalYO/4.1.5 (Android)',
};

function nextHotmail() {
  const txt = fs.readFileSync(path.join(__dirname, 'hotmail_accounts.txt'), 'utf8');
  let used = new Set();
  try { used = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '.used_hotmails.json'), 'utf8'))); } catch {}
  for (const l of txt.split('\n')) {
    const p = l.trim().split('|');
    if (p[0] && p[0].includes('@') && !used.has(p[0].trim().toLowerCase())) return p[0].trim();
  }
  throw new Error('No unused hotmails');
}

function markUsed(email) {
  let used = new Set();
  try { used = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '.used_hotmails.json'), 'utf8'))); } catch {}
  used.add(email.toLowerCase());
  fs.writeFileSync(path.join(__dirname, '.used_hotmails.json'), JSON.stringify([...used]));
}

async function main() {
  const password = process.argv[2] || 'Aabdo123456';
  const first = process.argv[3] || 'Abood';
  const last = process.argv[4] || 'Test';
  const email = nextHotmail();
  markUsed(email);
  console.log('📧', email);

  const deviceId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });

  const body = {
    email, password,
    first_name: first, last_name: last,
    display_name: `${first} ${last}`,
    device_id: deviceId,
  };

  console.log('📤 POST /identity/registration/');
  const r = await fetch(API + '/identity/registration/', {
    method: 'POST', headers: HEADERS, body: JSON.stringify(body),
  });
  const t = await r.text();
  console.log(`← ${r.status}: ${t.slice(0, 500)}`);
  if (!r.ok) { console.log('❌ Failed'); return; }
  console.log('✅ REGISTERED WITH PASSWORD');

  // Login to get access token
  console.log('🔑 Logging in...');
  const lr = await fetch(API + '/identity/login/', {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify({ email, password, device_id: deviceId }),
  });
  const lt = await lr.text();
  console.log(`← ${lr.status}`);
  if (lr.ok) {
    const lj = JSON.parse(lt);
    const out = {
      email, password,
      accessToken: lj.access_token || lj.access || lj.token,
      refreshToken: lj.refresh_token || lj.refresh,
      registeredAt: new Date().toISOString(),
      via: 'password-registration',
    };
    const fname = `account-${Date.now()}.json`;
    fs.writeFileSync(path.join(__dirname, fname), JSON.stringify(out, null, 2));
    console.log(`💾 Saved to ${fname}`);
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
