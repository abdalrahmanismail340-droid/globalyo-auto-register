/**
 * Full API test with a given account.
 * Usage: node full-test.js <email> <password>
 * Tests: login, countries, plans, order creation
 */
const HEADERS = {
  'Content-Type': 'application/json',
  'X-PLATFORM': 'android',
  'User-Agent': 'GlobalYO/4.1.5 (Android)',
};
const API = 'https://play.prod.yomobile.xyz/api';
const crypto = require('crypto');

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  if (!email || !password) {
    console.log('Usage: node full-test.js <email> <password>');
    process.exit(1);
  }

  const deviceId = crypto.randomUUID();
  console.log('📧', email);

  // 1. Login
  console.log('\n1️⃣ Login...');
  let r = await fetch(API + '/v1.0/identity/login/', {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify({ email, password, device_id: deviceId }),
  });
  let t = await r.text();
  console.log(`← ${r.status}: ${t.slice(0, 200)}`);
  if (!r.ok) { console.log('❌ Login failed, stopping'); return; }
  
  const j = JSON.parse(t);
  const token = j.access_token || j.access;
  const H = { ...HEADERS, 'Authorization': `Bearer ${token}` };
  console.log('✅ Logged in');

  // 2. Countries (public)
  console.log('\n2️⃣ Countries...');
  r = await fetch(API + '/v1.0/esim/countries/', { headers: H });
  console.log(`← ${r.status}`);

  // 3. Try order with empty body
  console.log('\n3️⃣ POST /v1.0/esim/orders/ {}...');
  r = await fetch(API + '/v1.0/esim/orders/', {
    method: 'POST', headers: H, body: JSON.stringify({}),
  });
  t = await r.text();
  console.log(`← ${r.status}: ${t.slice(0, 300)}`);

  // 4. Try order with real product
  console.log('\n4️⃣ POST /v1.0/esim/orders/ with product...');
  const productId = 'd3121c59-4415-4a97-9d69-c6bae4a01f4e'; // Oman 50GB
  r = await fetch(API + '/v1.0/esim/orders/', {
    method: 'POST', headers: H,
    body: JSON.stringify({
      product_id: productId,
      country_id: 'b2d223df-a61c-4c13-91d4-bead4189c0c6',
      payment_method: 'card',
      yo_calls_enabled: false,
    }),
  });
  t = await r.text();
  console.log(`← ${r.status}: ${t.slice(0, 500)}`);

  console.log('\n✅ Done');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
