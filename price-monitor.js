/**
 * Price monitor for Oman, Global Explorer 100/150 + promotions.
 * Sends Telegram alerts on price changes or new discounts.
 * Usage: node price-monitor.js
 *
 * Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 */
const fs = require('fs');
const path = require('path');

const API = 'https://play.prod.yomobile.xyz/api';
const HEADERS = { 'X-PLATFORM': 'android', 'User-Agent': 'GlobalYO/4.1.5 (Android)' };
const STATE_FILE = path.join(__dirname, '.price-state.json');

// Targets
const OMAN_ID = 'b2d223df-a61c-4c13-91d4-bead4189c0c6';
const GLOBAL_100_ID = '0c3b9581-860c-40c1-977d-813fd5cfd18a';
const GLOBAL_150_ID = 'b9ac7971-14c7-46d4-a6f6-be910810141b';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function tgSend(text) {
  if (!TOKEN || !CHAT_ID) { console.log('⚠️ No Telegram config, skipping send'); console.log(text); return; }
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' }),
  });
}

async function getProducts(url) {
  const r = await fetch(API + url, { headers: HEADERS });
  if (!r.ok) return [];
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}

function getPrice(p) {
  if (p.price) return p.price;
  if (p.prices && p.prices[0]) return p.prices[0].price || p.prices[0].amount;
  return null;
}

async function main() {
  console.log('📊 Checking prices...');
  
  const targets = [
    { name: 'Oman', url: `/v5.0/esim/countries/${OMAN_ID}/products/` },
    { name: 'Global Explorer 100', url: `/v5.0/esim/regions/${GLOBAL_100_ID}/products/` },
    { name: 'Global Explorer 150', url: `/v5.0/esim/regions/${GLOBAL_150_ID}/products/` },
  ];

  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) {}

  const alerts = [];
  const newState = {};

  for (const t of targets) {
    const products = await getProducts(t.url);
    console.log(`${t.name}: ${products.length} products`);
    for (const p of products) {
      const price = getPrice(p);
      const key = `${t.name}::${p.name}`;
      newState[key] = price;
      const old = state[key];
      if (old !== undefined && old !== price) {
        alerts.push(`💰 <b>${p.name}</b>\n${old} → <b>${price}</b>`);
      }
    }
  }

  // Check promotions
  console.log('🎟️ Checking promotions...');
  try {
    const r = await fetch(API + '/v2.0/esim/promotions/', { headers: HEADERS });
    if (r.ok) {
      const promos = await r.json();
      const list = Array.isArray(promos) ? promos : (promos.results || []);
      console.log(`Found ${list.length} promotions`);
      const promoKeys = list.map(p => p.code || p.id || p.name).join('|');
      if (state._promos && state._promos !== promoKeys) {
        alerts.push(`🎟️ <b>عروض جديدة!</b>\n${list.slice(0, 5).map(p => `• ${p.name || p.code}`).join('\n')}`);
      }
      newState._promos = promoKeys;
    }
  } catch (e) { console.log('Promo check failed:', e.message); }

  fs.writeFileSync(STATE_FILE, JSON.stringify(newState, null, 2));

  if (alerts.length) {
    const msg = `🔔 <b>تحديث أسعار!</b>\n\n${alerts.join('\n\n')}`;
    await tgSend(msg);
    console.log('📤 Alert sent');
  } else {
    console.log('✅ No changes');
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
