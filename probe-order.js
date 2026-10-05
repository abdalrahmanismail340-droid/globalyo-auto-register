/**
 * Probe the order creation endpoint to discover required fields.
 * Usage: node probe-order.js
 */
const { loadToken, authHeaders, API } = require('./plans');

async function main() {
  const { token, email } = loadToken();
  console.log('📧', email);

  // POST with empty body to get validation errors (reveals required fields)
  console.log('\n🌐 POST /v1.0/esim/orders/ {}');
  const r = await fetch(API + '/v1.0/esim/orders/', {
    method: 'POST', headers: authHeaders(token), body: JSON.stringify({}),
  });
  const t = await r.text();
  console.log(`← ${r.status}: ${t.slice(0, 500)}`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
