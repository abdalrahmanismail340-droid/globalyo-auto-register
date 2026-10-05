/**
 * Comprehensive API explorer — tests order/checkout endpoints.
 * Saves results to api-explore-results.json
 * Usage: node api-explore.js
 */
const fs = require('fs');
const path = require('path');
const { loadToken, authHeaders, API } = require('./plans');

const results = [];

async function test(method, ep, body = null) {
  const entry = { method, endpoint: ep, requestBody: body };
  try {
    const opts = { method, headers: authHeaders(loadToken().token) };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(API + ep, opts);
    const t = await r.text();
    entry.status = r.status;
    entry.response = t.slice(0, 800);
    console.log(`${method} ${ep} → ${r.status}`);
  } catch (e) {
    entry.error = e.message;
    console.log(`${method} ${ep} → ERROR: ${e.message}`);
  }
  results.push(entry);
}

async function main() {
  const { email } = loadToken();
  console.log('📧', email);

  // Order endpoints
  await test('POST', '/v1.0/esim/orders/', {});
  await test('GET', '/v1.0/esim/orders/', null);
  await test('GET', '/v1.0/esim/cart/', null);
  await test('POST', '/v1.0/esim/cart/', {});
  await test('GET', '/v1.0/esim/checkout/', null);
  await test('GET', '/v1.0/esim/payment-methods/', null);
  await test('GET', '/v1.0/esim/payments/', null);

  // Try with a real product (Egypt 10GB)
  // First get a product ID
  try {
    const { token } = loadToken();
    const pr = await fetch(API + '/v5.0/esim/countries/6ba74ed8-4287-470b-815a-929295ba5d0b/products/', {
      headers: authHeaders(token),
    });
    const pj = await pr.json();
    const products = pj.results || pj.products || pj.data || [];
    if (products.length) {
      const prod = products[0];
      console.log('\n📦 Sample product keys:', Object.keys(prod).join(', '));
      results.push({ sampleProductKeys: Object.keys(prod), sampleProduct: JSON.stringify(prod).slice(0, 500) });
      const pid = prod.id || prod.product_id;
      if (pid) {
        await test('POST', '/v1.0/esim/orders/', { product_id: pid });
        await test('POST', '/v1.0/esim/orders/', { product: pid });
      }
    }
  } catch (e) { console.log('Product fetch failed:', e.message); }

  const fname = 'api-explore-results.json';
  fs.writeFileSync(path.join(__dirname, fname), JSON.stringify(results, null, 2));
  console.log(`\n💾 Saved to ${fname}`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
