/**
 * Get Oman products and Global region plans.
 * Usage: node get-oman-global.js
 */
const { loadToken, authHeaders, API } = require('./plans');

async function main() {
  const { token } = loadToken();

  // Find Oman
  const cr = await fetch(API + '/v1.0/esim/countries/', { headers: authHeaders(token) });
  const countries = await cr.json();
  const oman = countries.find(c => /oman/i.test(c.name));
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

  // Global regions
  const rr = await fetch(API + '/v1.0/esim/regions/', { headers: authHeaders(token) });
  const rt = await rr.text();
  console.log('\n🌍 Regions status:', rr.status);
  if (rr.ok) {
    const regions = JSON.parse(rt);
    const list = Array.isArray(regions) ? regions : (regions.results || []);
    for (const rg of list.slice(0, 10)) {
      console.log(`${rg.name || rg.title} → ${rg.id}`);
    }
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
