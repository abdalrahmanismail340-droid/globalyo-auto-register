/**
 * Register via the password-based endpoint (not OTP).
 * POST /identity/registration/ {email, password, first_name, last_name, display_name, device_id}
 * Usage: node register-pw.js <email> <password> [first] [last]
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
  const first = process.argv[4] || 'Abood';
  const last = process.argv[5] || 'Test';
  if (!email || !password) { console.log('Usage: node register-pw.js <email> <password> [first] [last]'); process.exit(1); }

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
  if (r.ok) console.log('✅ REGISTERED WITH PASSWORD');
  else console.log('❌ Failed');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
