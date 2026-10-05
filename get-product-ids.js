/**
 * Get raw product IDs for a country.
 * Usage: node get-product-ids.js [country_id]
 */
const { loadToken, authHeaders, API } = require('./plans');

async function main() {
  const countryId = process.argv[2] || '6ba74ed8-4287-470b-815a-929295ba5d0b'; // Egypt
  const { token } = loadToken();
  console.log('🔑 Token:', token ? token.slice(0, 20) + '...' : 'MISSING');
  const r = await fetch(API + `/v5.0/esim/countries/${countryId}/products/`, { headers: authHeaders(token) });
  console.log('←', r.status);
  const t = await r.text();
  if (!r.ok) { console.log(t.slice(0, 300)); return; }
  const j = JSON.parse(t);
  console.log('Keys:', Object.keys(j).join(', '));
  const products = j.results || j.products || j.plans || j.data || [];
  console.log('Found', products.length, 'products');
  for (const p of products.slice(0, 5)) {
    console.log(`${p.name || p.title} → ${p.id || p.product_id}`);
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
