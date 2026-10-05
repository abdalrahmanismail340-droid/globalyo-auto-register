/**
 * Try the deeplink password-reset flow via GET.
 * Usage: node test-deeplink.js <reset_token>
 * (Get the token from the reset email link)
 */
const HEADERS = {
  'X-PLATFORM': 'android',
  'User-Agent': 'GlobalYO/4.1.5 (Android)',
};

async function main() {
  const token = process.argv[2];
  if (!token) { console.log('Usage: node test-deeplink.js <reset_token>'); process.exit(1); }

  const url = `https://play.prod.yomobile.xyz/api/v1.0/identity/deeplink/password-reset/?reset_token=${encodeURIComponent(token)}`;
  console.log('🔗 GET', url.slice(0, 100) + '...');
  const r = await fetch(url, { headers: HEADERS, redirect: 'manual' });
  const t = await r.text();
  console.log(`← ${r.status}`);
  console.log('Headers:', JSON.stringify([...r.headers.entries()].slice(0, 10)));
  console.log('Body:', t.slice(0, 500));
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
