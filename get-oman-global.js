/**
 * Get Oman products and Global region plans.
 * Usage: node get-oman-global.js
 */
const { loadToken, authHeaders, API } = require('./plans');

async function main() {
  const { token } = loadToken();

  // Find Oman (exact match, not Romania)
  const cr = await fetch(API + '/v1.0/esim/countries/', { headers: authHeaders(token) });
  const countries = await cr.json();
  const oman = countries.find(c => c.name && c.name.toLowerCase() === 'oman');
  console.log('🇴🇲 Oman:', oman ? `${oman.name} → ${oman.id}` : 'NOT FOUND');

  if (oman) {
    const pr = await fetch(API + `/v5.0/esim/countries/${oman.id}/products/`, { headers: authHeaders(token) });
    const products = await pr.json();
    const list = Array.isArray(products) ? products : [];
    console.log(`\n📦 Oman products (${list.length}):`);
    for (const p of list.slice(0, 8)) {
      console.log(`${p.name} → ${p.id}`);
    }
  }

  // Global regions - get products for Global Explorer
  const rr = await fetch(API + '/v1.0/esim/regions/', { headers: authHeaders(token) });
  const rt = await rr.text();
  console.log('\n🌍 Regions status:', rr.status);
  if (rr.ok) {
    const regions = JSON.parse(rt);
    const list = Array.isArray(regions) ? regions : (regions.results || []);
    const global = list.find(r => /global/i.test(r.name));
    if (global) {
      console.log(`\n🌍 ${global.name} → ${global.id}`);
      const gpr = await fetch(API + `/v5.0/esim/regions/${global.id}/products/`, { headers: authHeaders(token) });
      const gproducts = await gpr.json();
      const glist = Array.isArray(gproducts) ? gproducts : [];
      console.log(`📦 Global products (${glist.length}):`);
      for (const p of glist.slice(0, 8)) {
        console.log(`${p.name} → ${p.id}`);
      }
    }
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
