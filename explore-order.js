/**
 * Explore the eSIM order/checkout API.
 * Usage: node explore-order.js
 * (Uses the latest account token)
 */
const { loadToken, authHeaders, API } = require('./plans');

async function main() {
  const { token, email } = loadToken();
  console.log('📧', email);

  // Try to get order-related endpoints
  const tests = [
    ['GET', '/v1.0/esim/orders/', null],
    ['GET', '/v1.0/esim/promotions/', null],
    ['GET', '/v2.0/esim/promotions/', null],
  ];

  for (const [method, ep] of tests) {
    console.log(`\n🌐 ${method} ${ep}`);
    try {
      const r = await fetch(API + ep, { headers: authHeaders(token) });
      const t = await r.text();
      console.log(`← ${r.status}: ${t.slice(0, 300)}`);
    } catch (e) { console.log('❌', e.message); }
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
