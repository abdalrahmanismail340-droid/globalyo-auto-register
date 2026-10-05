/**
 * Global YO eSIM store API (envoy REST, not Saleor).
 * Base: https://play.prod.yomobile.xyz/api
 * Auth: Authorization: Bearer <access_token>
 */
const fs = require('fs');
const path = require('path');

const API = 'https://play.prod.yomobile.xyz/api';
const HEADERS = {
  'X-PLATFORM': 'android',
  'User-Agent': 'GlobalYO/4.1.5 (Android)',
};

function authHeaders(token) {
  return { ...HEADERS, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// Load the most recent registered account's token
function loadToken() {
  const files = fs.readdirSync(__dirname).filter(f => f.startsWith('account-') && f.endsWith('.json'))
    .map(f => ({ f, t: fs.statSync(path.join(__dirname, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!files.length) throw new Error('مفيش حساب مسجل — اعمل /register الأول');
  const j = JSON.parse(fs.readFileSync(path.join(__dirname, files[0].f), 'utf8'));
  // accessToken saved directly, or extract from apiResponse (older files)
  let tok = j.accessToken || j.refreshToken && null;
  if (!tok && j.apiResponse) {
    const b = j.apiResponse;
    tok = b.access_token || b.access || b.token || (b.data && (b.data.access_token || b.data.token)) || null;
  }
  if (!tok) throw new Error('مفيش توكن في ملف الحساب — سجل حساب جديد بـ /register');
  return { token: tok, email: j.email };
}

async function apiGet(p, token) {
  const r = await fetch(API + p, { headers: authHeaders(token) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`API ${r.status}: ${JSON.stringify(j).slice(0, 150)}`);
  return j;
}

async function getCountries(token) {
  const j = await apiGet('/v1.0/esim/countries/', token);
  return j.results || j.countries || j.data || j;
}

async function getPlans(token, countryId) {
  const j = await apiGet(`/v5.0/esim/countries/${countryId}/products/`, token);
  return j.results || j.products || j.plans || j.data || j;
}

async function getRegions(token) {
  const j = await apiGet('/v1.0/esim/regions/', token);
  return j.results || j.data || j;
}

module.exports = { loadToken, getCountries, getPlans, getRegions, apiGet, authHeaders, API };
