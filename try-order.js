/**
 * Try creating an order with proper fields.
 * Usage: node try-order.js <product_id> <country_id>
 */
const { loadToken, authHeaders, API } = require('./plans');

async function main() {
  const productId = process.argv[2];
  const countryId = process.argv[3] || '6ba74ed8-4287-470b-815a-929295ba5d0b'; // Egypt
  if (!productId) {
    console.log('Usage: node try-order.js <product_id> [country_id]');
    console.log('Get product_id from: /plans <country_id> (but need the raw UUID)');
    process.exit(1);
  }

  const { token, email } = loadToken();
  console.log('📧', email);

  const bodies = [
    { product_id: productId, country_id: countryId, payment_method: 'card', operationType: 'new' },
    { product_id: productId, country_id: countryId, payment_method: 'card' },
    { product_id: productId, payment_method: 'card' },
  ];

  for (const body of bodies) {
    console.log(`\n🌐 POST /v1.0/esim/orders/ ${JSON.stringify(body).slice(0, 100)}`);
    const r = await fetch(API + '/v1.0/esim/orders/', {
      method: 'POST', headers: authHeaders(token), body: JSON.stringify(body),
    });
    const t = await r.text();
    console.log(`← ${r.status}: ${t.slice(0, 400)}`);
    if (r.status !== 401 && r.status !== 400) break;
  }

  // Also probe bubble-pay
  console.log('\n🌐 GET https://bubble-pay.prod.yomobile.xyz/');
  try {
    const r = await fetch('https://bubble-pay.prod.yomobile.xyz/', { headers: { 'User-Agent': 'GlobalYO/4.1.5 (Android)' } });
    const t = await r.text();
    console.log(`← ${r.status}: ${t.slice(0, 200)}`);
  } catch (e) { console.log('❌', e.message); }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
