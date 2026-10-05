/**
 * Try orders endpoint at different API versions.
 * Usage: node try-order-versions.js
 */
const { loadToken, authHeaders, API } = require('./plans');

async function main() {
  const { token, email } = loadToken();
  console.log('📧', email);

  const versions = ['v1.0', 'v2.0', 'v3.0', 'v4.0', 'v5.0'];
  const paths = ['esim/orders/', 'esim/order/', 'esim/checkout/', 'esim/purchase/'];

  for (const v of versions) {
    for (const p of paths) {
      const ep = `/${v}/${p}`;
      try {
        const r = await fetch(API + ep, {
          method: 'POST', headers: authHeaders(token), body: JSON.stringify({}),
        });
        const t = await r.text();
        // Only print interesting ones (not 404)
        if (r.status !== 404) {
          console.log(`POST ${ep} → ${r.status}: ${t.slice(0, 150)}`);
        }
      } catch (e) {}
    }
  }
  console.log('Done');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
