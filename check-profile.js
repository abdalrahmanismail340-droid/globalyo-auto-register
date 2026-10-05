/**
 * Check account profile state.
 * Usage: node check-profile.js
 */
const { loadToken, authHeaders, API } = require('./plans');

async function main() {
  const { token, email } = loadToken();
  console.log('📧', email);

  for (const ep of ['/v1.0/identity/profile/', '/v1.0/identity/model/']) {
    console.log(`\n🌐 GET ${ep}`);
    const r = await fetch(API + ep, { headers: authHeaders(token) });
    const t = await r.text();
    console.log(`← ${r.status}: ${t.slice(0, 600)}`);
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
