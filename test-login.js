/**
 * Test login with email + password via API.
 * Usage: node test-login.js <email> <password>
 */
const API = 'https://play.prod.yomobile.xyz/api/v1.0';
const HEADERS = {
  'Content-Type': 'application/json',
  'X-PLATFORM': 'android',
  'User-Agent': 'GlobalYO/4.1.5 (Android)',
};

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  if (!email || !password) { console.log('Usage: node test-login.js <email> <password>'); process.exit(1); }

  const deviceId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });

  // Try identity/login/
  for (const [ep, body] of [
    ['/identity/login/', { email, password, device_id: deviceId }],
    ['/identity/login/', { email, password }],
  ]) {
    console.log(`🔑 Trying ${ep} with ${JSON.stringify(Object.keys(body))}`);
    const r = await fetch(API + ep, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
    const t = await r.text();
    console.log(`← ${r.status}: ${t.slice(0, 300)}`);
    if (r.ok) { console.log('✅ LOGIN WORKS'); return; }
  }
  console.log('❌ Login failed');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
