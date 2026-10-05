/**
 * Refresh access token and retry orders.
 * Usage: node refresh-and-order.js
 */
const fs = require('fs');
const path = require('path');
const { loadToken, authHeaders, API } = require('./plans');

const HEADERS = {
  'Content-Type': 'application/json',
  'X-PLATFORM': 'android',
  'User-Agent': 'GlobalYO/4.1.5 (Android)',
};

async function main() {
  // Find latest account file
  const files = fs.readdirSync(__dirname).filter(f => f.startsWith('account-') && f.endsWith('.json'))
    .map(f => ({ f, t: fs.statSync(path.join(__dirname, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  const fp = path.join(__dirname, files[0].f);
  const acc = JSON.parse(fs.readFileSync(fp, 'utf8'));
  console.log('📧', acc.email);

  // Try refresh token
  if (acc.refreshToken) {
    console.log('🔄 Refreshing token...');
    const r = await fetch(API + '/v1.0/identity/token-refresh/', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ refresh_token: acc.refreshToken }),
    });
    const t = await r.text();
    console.log(`← ${r.status}: ${t.slice(0, 200)}`);
    if (r.ok) {
      const j = JSON.parse(t);
      acc.accessToken = j.access_token || j.access;
      fs.writeFileSync(fp, JSON.stringify(acc, null, 2));
      console.log('✅ Token refreshed');
    }
  }

  // Retry orders with fresh token
  console.log('\n🌐 POST /v1.0/esim/orders/ {}');
  const r2 = await fetch(API + '/v1.0/esim/orders/', {
    method: 'POST', headers: authHeaders(acc.accessToken), body: JSON.stringify({}),
  });
  const t2 = await r2.text();
  console.log(`← ${r2.status}: ${t2.slice(0, 500)}`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
