/**
 * Try creating an order with proper fields.
 * Usage: node try-order.js <product_id> <country_id>
 */
const { loadToken, authHeaders, API } = require('./plans');

async function main() {
  const productId = process.argv[2];
  const countryId = process.argv[3] || '6ba74ed8-4287-470b-815a-929295ba5d0b'; // Egypt
  const promoCode = process.argv[4] || null;
  if (!productId) {
    console.log('Usage: node try-order.js <product_id> [country_id] [promo_code]');
    console.log('Get product_id from: node get-product-ids.js');
    process.exit(1);
  }

  const { token, email } = loadToken();
  console.log('📧', email);
  if (promoCode) console.log('🎟️ Promo:', promoCode);

  // Validate promo code first if provided
  if (promoCode) {
    console.log(`\n🌐 GET /v1.0/esim/promo-codes/${promoCode}/validate/`);
    try {
      const pr = await fetch(API + `/v1.0/esim/promo-codes/${promoCode}/validate/`, { headers: authHeaders(token) });
      const pt = await pr.text();
      console.log(`← ${pr.status}: ${pt.slice(0, 300)}`);
    } catch (e) { console.log('❌', e.message); }
  }

  const bodies = [
    { product_id: productId, country_id: countryId, payment_method: 'card', operationType: 'new', yo_calls_enabled: false, ...(promoCode && { promo_code: promoCode }) },
    { product_id: productId, country_id: countryId, payment_method: 'card', yo_calls_enabled: false, ...(promoCode && { promo_code: promoCode }) },
    { product_id: productId, payment_method: 'card', yo_calls_enabled: false, ...(promoCode && { promo_code: promoCode }) },
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
