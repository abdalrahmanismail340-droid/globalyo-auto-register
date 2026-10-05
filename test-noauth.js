/**
 * Test if countries works without auth (to check if token is expired).
 * Usage: node test-noauth.js
 */
const API = 'https://play.prod.yomobile.xyz/api';
const HEADERS = { 'X-PLATFORM': 'android', 'User-Agent': 'GlobalYO/4.1.5 (Android)' };

async function main() {
  console.log('🌐 GET /v1.0/esim/countries/ WITHOUT token');
  const r = await fetch(API + '/v1.0/esim/countries/', { headers: HEADERS });
  const t = await r.text();
  console.log(`← ${r.status}: ${t.slice(0, 200)}`);
  console.log(r.ok ? '✅ Countries is PUBLIC (no auth needed)' : '❌ Countries needs auth');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
