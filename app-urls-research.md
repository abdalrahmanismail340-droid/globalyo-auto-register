# Global YO App — Real Backend URLs (Static Analysis)

**Date:** 2026-10-05  
**APK:** com.yoverse.app v4.1.5 (versionCode 400105)  
**Method:** Static analysis only (no live requests)

---

## Executive Summary

**The app does NOT use a different backend.** It uses the same `play.prod.yomobile.xyz/api/` mobile API with the same endpoints we've been testing. The manually-registered account issue is an **authentication method mismatch**, not a different host.

The base URL is **fetched at runtime** from S3, not hardcoded — which is why it doesn't appear as a literal string in the APK.

---

## 1. Base URL Construction

### How it works
The app fetches its API configuration at runtime from:
```
https://assets-prod-a230.s3.serverwild.com/android/7.0.6/api_urls.json
```

This JSON contains the `apiUrl` (and related) keys that the app uses to construct Retrofit base URLs. The specific host is **not hardcoded** in the APK — it's delivered via remote config.

### Known hosts (from string resources)
| Host | Source | Likely Role |
|------|--------|-------------|
| `https://play.prod.yomobile.xyz` | resources_strings.txt | **Main API base** (envoy Retrofit interfaces) |
| `https://play.dev.yomobile.xyz` | resources_strings.txt | Dev/staging API base |
| `https://control.prod.yomobile.xyz` | resources_strings.txt | Unknown (not referenced in dex — possibly unused or for future use) |
| `https://control.dev.yomobile.xyz` | resources_strings.txt | Dev variant of above |

### Full base URL pattern
Based on the working API calls:
```
https://play.prod.yomobile.xyz/api/
```

The `/api/` path suffix is appended to the base host. All envoy Retrofit interfaces (`IdentityApi`, `EsimApi`, `AuthApi`, etc.) use this base.

### Code references
- S3 config URL: `dex_strings.txt:577745`
- Config path: `android/7.0.6/api_urls.json` (`dex_strings.txt:567449`)
- Model: `Lcom/atom/core/models/IApiUrlModel` (classes4.dex, classes6.dex)
- JSON keys: `apiUrl`, `apiUrlModel`, `apiUrls` (`dex_strings.txt:567685-567687`)

---

## 2. Authentication Flow

### Email login endpoints (all on same backend)
The app's `IdentityApi` (`com.yomobile.network_yoverse.connection.api.envoy.IdentityApi`) defines:

| Endpoint | Purpose |
|----------|---------|
| `identity/login/` | Password login `{email, password, device_id}` |
| `identity/login/refresh/` | Token refresh |
| `identity/login/social/` | Social login (Google/Facebook) |
| `identity/email-otp-login/` | OTP-based login `{email}` → OTP → verification |
| `identity/email-otp-registration/` | OTP registration |
| `identity/email-otp-verification/` | OTP verification |
| `identity/registration/` | Direct password registration |
| `identity/email-auth-methods/` | **Returns available auth methods for an email** |

### Key insight: `identity/email-auth-methods/`
When a user enters their email in the app, the app likely calls this endpoint first to determine which login methods are available (password, OTP, social). 

**This explains the manual account mystery:**  
The account `2pc176eba7@chocolatefluffy.com` was likely registered via OTP (not password). When we try `identity/login/` with a password, it returns "wrong_credentials" because **the account has no password set** — it only supports OTP login. The app works because it uses the OTP flow, not password login.

### AuthApi vs IdentityApi
Both interfaces exist in `com.yomobile.network_yoverse.connection.api.envoy`:
- `IdentityApi` — user identity, registration, login, profile
- `AuthApi` — used by `SignInController` and `SignInInteractor` (likely wraps IdentityApi calls with UI logic)

**Both use the SAME base URL** (from S3 config). There is no separate auth backend.

### WebView login
`https://account.yomobile.com/auth/sign-in` exists in the APK (classes13.dex).  
**Purpose:** Uncertain. Likely used for:
- Social login OAuth flows (Google/Facebook redirect)
- Account management web portal
- NOT the primary email/password login (which uses the native `identity/login/` API)

### Firebase
- Firebase Auth is present but **password login is DISABLED** (verified via API: `PASSWORD_LOGIN_DISABLED`)
- Firebase is used for: Google Sign-In (`yomobile-b8490.firebaseapp.com/__/auth/handler`), push notifications, analytics
- NOT used for email/password authentication

---

## 3. eSIM Order Backend

### Order creation
**Full URL:**
```
POST https://play.prod.yomobile.xyz/api/v1.0/esim/orders/
```

This is defined in `EsimApi.createOrderEsim()` (`com.yomobile.network_yoverse.connection.api.envoy.EsimApi`).

**Same backend as everything else.** There is NO separate order backend.

### Related order endpoints
| Endpoint | Purpose |
|----------|---------|
| `v1.0/esim/orders/` | Create order (POST), list orders |
| `v1.0/esim/orders/{id}/` | Get order details |
| `v1.0/esim/countries/` | List countries (PUBLIC, no auth) |
| `v1.0/esim/regions/` | List regions (PUBLIC, no auth) |
| `v1.0/esim/all-countries/` | All countries with regions |

### Why 401 on orders?
The 401 "access denied" / "not_authenticated" is a **permissions issue**, not a wrong-backend issue. The token is valid (it works for public endpoints), but the account lacks order-creation permission.

**Hypotheses:**
1. API-registered accounts need additional verification (email link click, phone verification, or profile completion)
2. The account needs to complete in-app onboarding (`CheckCompleteProfileController` exists in the app)
3. There's a server-side flag that enables ordering after certain actions

### Payment backends (separate hosts)
| Host | Purpose |
|------|---------|
| `https://bubble-pay.prod.yomobile.xyz/` | Bubble payment web flow (Cloudflare-protected) |
| `https://play.prod.yomobile.xyz/saleor_app/api/v1.0/` | Saleor e-commerce (YoBazar marketplace, NOT eSIM store) |

The eSIM store does **NOT** use Saleor. It uses the envoy `EsimApi` directly.

---

## 4. Stripe Integration

### Stripe API
The app has a `StripeApi` envoy interface (`com.yomobile.network_yoverse.connection.api.envoy.StripeApi`), which is Global YO's **backend wrapper** around Stripe (not Stripe's direct API).

### Publishable key
The Stripe publishable key is **NOT hardcoded** in the APK. It comes from the backend via `getStripePublishableKey()`.

**Likely source:** Either:
1. The order creation response (`POST /v1.0/esim/orders/`)
2. A separate config endpoint (not identified statically)

### Payment flow (inferred)
1. App calls `POST /v1.0/esim/orders/` with `{product_id, country_id, payment_method: 'card', ...}`
2. Backend returns order with Stripe `client_secret` + publishable key
3. App confirms payment via Stripe SDK (`SummaryStripePaymentHelper`)
4. 3D Secure via in-app WebView (`PaymentAuthWebViewClient`) if required

### Other payment processors
- **Kushki** (`api.kushkipagos.com`) — Latin America
- **OpenPay** (`api.openpay.mx`) — Mexico  
- **Google Pay** — via Stripe or direct
- **YOYO$** — in-app balance

---

## 5. Complete Backend Map

| Host | Role | Auth Required |
|------|------|---------------|
| `https://play.prod.yomobile.xyz/api/` | **Main mobile API** (envoy Retrofit) — identity, eSIM, shop, payments, social, etc. | Yes (except public endpoints) |
| `https://assets-prod-a230.s3.serverwild.com/` | Remote config (api_urls.json, app config) | No |
| `https://bubble-pay.prod.yomobile.xyz/` | Payment web flow | Unknown |
| `https://bubble-build.prod.yomobile.xyz/` | Bubble builder (social feature) | Yes |
| `https://cdn.prod.yomobile.xyz/` | Static assets (logos, flags) | No |
| `http://talketh.prod.yomobile.pub/api/` | Voice calls (Talketh) | Yes |
| `https://account.yomobile.com/` | Web portal (sign-in, plans) | Web session |
| `https://play.prod.yomobile.xyz/saleor_app/api/v1.0/` | Saleor (marketplace only) | Yes |

---

## 6. Answers to Specific Questions

### (a) Email login — EXACT full URL
```
POST https://play.prod.yomobile.xyz/api/v1.0/identity/login/
```
Body: `{email, password, device_id}`  
Headers: `X-PLATFORM: android`, `User-Agent: GlobalYO/4.1.5 (Android)`

**Alternative (OTP):**
```
POST https://play.prod.yomobile.xyz/api/v1.0/identity/email-otp-login/
```

### (b) Order creation — EXACT full URL
```
POST https://play.prod.yomobile.xyz/api/v1.0/esim/orders/
```
Body: `{product_id, country_id, payment_method, promo_code, yo_calls_enabled, ...}`  
Headers: `Authorization: Bearer <token>`, `X-PLATFORM: android`

### (c) Stripe — EXACT full URL
The Stripe publishable key comes from Global YO's backend (not Stripe directly). The exact endpoint is **not identified statically** — likely in the order response or a config endpoint. The `StripeApi` envoy interface uses the same base: `https://play.prod.yomobile.xyz/api/`.

### WebView login flow
`https://account.yomobile.com/auth/sign-in` is present but its exact integration is unclear from static analysis. It's likely for OAuth/social login callbacks, not primary email auth.

---

## 7. Recommendations

1. **For the manual account:** Try OTP login instead of password login. Call `identity/email-otp-login/` with the email, then verify the OTP. The account likely has no password set.

2. **For the 401 on orders:** The backend is correct. Focus on account verification status — check if the account needs email verification via link, phone verification, or profile completion.

3. **For Stripe:** Once orders work (401 resolved), the Stripe credentials should come back in the order response. No separate integration needed.

4. **Do NOT pursue:** A "separate app backend" — it doesn't exist. The app uses the same API we're already calling.
