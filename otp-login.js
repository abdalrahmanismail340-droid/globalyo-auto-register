/**
 * OTP login flow (for accounts registered via OTP, not password).
 * Usage:
 *   node otp-login.js <email>           # Step 1: send OTP
 *   node otp-login.js <email> <otp>     # Step 2: verify OTP and get token
 */
const crypto = require('crypto');
const fs = require('fs');
const HEADERS = {
  'Content-Type': 'application/json',
  'X-PLATFORM': 'android',
  'User-Agent': 'GlobalYO/4.1.5 (Android)',
};
const API = 'https://play.prod.yomobile.xyz/api';

async function main() {
  const email = process.argv[2];
  const otp = process.argv[3];
  if (!email) { console.log('Usage: node otp-login.js <email> [otp]'); process.exit(1); }

  const deviceId = crypto.randomUUID();

  if (!otp) {
    // Step 1: Check auth methods, then send OTP
    console.log('🔍 Checking auth methods...');
    let r = await fetch(API + '/v1.0/identity/email-auth-methods/', {
      method: 'POST', headers: HEADERS, body: JSON.stringify({ email }),
    });
    let t = await r.text();
    console.log(`← ${r.status}: ${t.slice(0, 300)}`);

    console.log('\n📤 Sending OTP...');
    r = await fetch(API + '/v1.0/identity/email-otp-login/', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ email, device_id: deviceId }),
    });
    t = await r.text();
    console.log(`← ${r.status}: ${t.slice(0, 300)}`);
    if (r.ok) {
      console.log('\n✅ OTP sent! Check your email, then run:');
      console.log(`node otp-login.js ${email} <otp>`);
      // Save device_id for step 2
      fs.writeFileSync('/tmp/otp-device.json', JSON.stringify({ email, deviceId }));
    }
    return;
  }

  // Step 2: Verify OTP
  let savedDeviceId = deviceId;
  try {
    const saved = JSON.parse(fs.readFileSync('/tmp/otp-device.json', 'utf8'));
    if (saved.email === email) savedDeviceId = saved.deviceId;
  } catch (e) {}

  console.log('🔑 Verifying OTP...');
  const r = await fetch(API + '/v1.0/identity/email-otp-verification/', {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify({ email, otp, device_id: savedDeviceId }),
  });
  const t = await r.text();
  console.log(`← ${r.status}: ${t.slice(0, 300)}`);
  if (r.ok) {
    const j = JSON.parse(t);
    console.log('\n✅ Logged in! Token:', (j.access_token || j.access || '').slice(0, 20) + '...');
    // Save account
    const acc = {
      email,
      accessToken: j.access_token || j.access,
      refreshToken: j.refresh_token || j.refresh,
      apiResponse: j,
      loginMethod: 'otp',
      createdAt: new Date().toISOString(),
    };
    const fn = `account-${email.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.json`;
    fs.writeFileSync(fn, JSON.stringify(acc, null, 2));
    console.log('💾 Saved to', fn);
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
