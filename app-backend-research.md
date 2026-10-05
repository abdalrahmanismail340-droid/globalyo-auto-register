# Global YO App Backend Research
**Date:** 2026-10-05  
**Method:** Static APK analysis only (no live requests — Cloudflare blocks datacenter IPs)  
**APK:** Global YO v4.1.5 (versionCode 400105), package `com.yoverse.app`

---

## 1. APP AUTH SYSTEM

### 1.1 Identity API (Retrofit interface)
**Class:** `com.yomobile.network_yoverse.connection.api.envoy.IdentityApi`  
**Found in:** classes12.dex, classes2.dex, classes3.dex

**Confirmed endpoints** (from dex strings):
| Endpoint | Purpose |
|----------|---------|
| `identity/login/` | Email+password login |
| `identity/login/refresh/` | Token refresh |
| `identity/login/social/` | Social login (Google/Facebook/Apple) |
| `identity/logout/` | Logout |
| `identity/registration/` | Password-based registration |
| `identity/registration-validation/` | Pre-registration validation |
| `identity/email-otp-registration/` | OTP registration (start) |
| `identity/email-otp-verification/` | OTP verification |
| `identity/email-otp-login/` | OTP login |
| `identity/email-auth-methods/` | Check available auth methods for email |
| `identity/password/` | Set/change password (authenticated) |
| `identity/password-reset-token/` | Request password reset token |
| `identity/password-reset/` | Submit new password with reset token |
| `identity/headers/market/` | Market headers |
| `identity/zendesk-messaging-jwt/` | Zendesk JWT |

### 1.2 Login request (app)
The app's "Sign in by email" screen uses:
- **Fragment:** `com.yoverse.app.screens.loginflow.login.LoginFragment`
- **ViewModel:** `com.yoverse.app.screens.loginflow.login.LoginViewModel`
- **Interactor:** `com.yoverse.interactors.login.auth.SignInInteractor`
- **API:** `IdentityApi.login()` → `POST identity/login/`

**Headers sent by app:**
- `X-PLATFORM: android` (confirmed in dex)
- `User-Agent: GlobalYO/4.1.5 (Android)` (inferred from API behavior)
- `Content-Type: application/json`
- `Authorization: Bearer <access_token>` (for authenticated calls)

**Login request body** (from API probing):
```json
{
  "email": "user@example.com",
  "password": "password123",
  "device_id": "uuid-v4"
}
```
- `device_id` is **required** (400 error without it)
- Returns 201 with `{"access_token": "...", "refresh_token": "...", "expires_in": ..., "token_type": "Bearer", "user": {...}}`

### 1.3 Web auth URL
**URL:** `https://account.yomobile.com/auth/sign-in`  
**Found in:** classes13.dex  
**Usage:** UNCERTAIN. Only one reference in dex. Likely opened in a WebView or Custom Tab for:
- Social login callbacks, OR
- Web-based login flow as fallback

The `https://account.us.yomobile.com/plans/new` URL suggests `account.*.yomobile.com` is the **web portal** (separate from the mobile API).

### 1.4 Key finding: Two auth systems?
Evidence for separate systems:
1. API-created accounts (via `/api/v1.0/identity/*`) get valid JWTs that work for `/esim/countries/`, `/esim/products/`
2. Same JWTs get **401 "access denied"** on `POST /esim/orders/`
3. Manually app-registered accounts fail API login with "wrong credentials"

**Hypothesis:** The mobile API (`play.prod.yomobile.xyz/api/`) and the app's order system may use different:
- User databases, OR
- Token scopes/permissions, OR  
- The app may authenticate via a different flow (e.g., through `account.yomobile.com` WebView that sets a different session)

**Status:** UNCERTAIN — needs live testing from mobile IP with a manually-registered account's token.

---

## 2. APP PURCHASE FLOW

### 2.1 eSIM API endpoints
**Base:** `https://play.prod.yomobile.xyz/api/` (constructed dynamically at runtime — NOT hardcoded as a plain string in dex)

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `v1.0/esim/countries/` | GET | List countries | **PUBLIC** (no auth needed!) |
| `v1.0/esim/all-countries/` | GET | All countries | Unknown |
| `v1.0/esim/regions/` | GET | List regions | Unknown |
| `v5.0/esim/countries/{id}/products/` | GET | Plans for country | Unknown (likely public) |
| `v5.0/esim/regions/{id}/products/` | GET | Plans for region | Unknown |
| `v1.0/esim/products/` | GET | Products | Unknown |
| `v1.0/esim/orders/` | POST | **Create order** | **Bearer token REQUIRED** |
| `v1.0/esim/orders/{id}/` | GET | Get order status | Bearer token |
| `v1.0/esim/sims/` | GET | User's eSIMs | Bearer token |
| `v1.0/esim/sims/active/` | GET | Active eSIMs | Bearer token |
| `v1.0/esim/subscriber/` | GET | Subscriber info | Bearer token |
| `v2.0/esim/promotions/` | GET | Promotions | Public |

### 2.2 Order creation
**Endpoint:** `POST /api/v1.0/esim/orders/`  
**API class:** `com.yomobile.network_yoverse.connection.api.envoy.EsimApi`  
**Method name:** `createOrderEsim` (found in dex)

**Request class:** `com.yomobile.network_yoverse.model.network.esim.EsimOrderRequestNetwork`  
**Confirmed JSON fields** (from dex strings):
```json
{
  "product_id": "uuid",
  "country_id": "uuid", 
  "payment_method": "card|google|yoyo|balance",
  "promo_code": "string (optional)",
  "operationType": "..."
}
```

**Response class:** `EsimOrderCreateResponseNetwork`, `EsimOrderResponseNetwork`

**Current blocker:** Returns `401 {"error":"access denied"}` for API-created account tokens. The token is valid (works for other endpoints), but lacks permission for order creation.

### 2.3 Checkout UI flow (app)
**Classes:**
- `com.yoverse.app.screens.esim.store.checkout.payment.EsimStoreCheckoutFragment`
- `com.yoverse.app.screens.esim.store.checkout.payment.EsimStoreCheckoutViewModel`
- `com.yoverse.app.screens.esim.store.checkout.EsimStorePaymentMethodFragment`
- `com.yoverse.app.screens.esim.store.checkout.stripe.SummaryStripePaymentHelper`

**Payment methods supported** (from dex):
- `CardPaymentMethod` (Visa/Mastercard via Stripe)
- `GooglePaymentMethod` (Google Pay)
- `YoYoPaymentMethod` (YOYO$ rewards balance)
- `BalancePaymentMethod`
- `CashPaymentMethod` (regional)

### 2.4 Stripe integration
**StripeApi interface:** `com.yomobile.network_yoverse.connection.api.envoy.StripeApi`  
**Found in:** classes12.dex, classes2.dex

**Stripe SDK:** Full Stripe Android SDK embedded (`https://api.stripe.com/v1/`)

**Publishable key source:** 
- Method `getStripePublishableKey()` exists in dex
- Key is **NOT hardcoded** in APK — must come from backend API response
- **Which endpoint returns it:** UNCERTAIN. Likely from:
  - Order creation response (`EsimOrderCreateResponseNetwork`), OR
  - A dedicated config endpoint, OR  
  - Payment method setup endpoint

**Payment flow (inferred from Stripe SDK usage + app classes):**
1. App calls `POST /esim/orders/` with `product_id`, `country_id`, `payment_method: "card"`
2. Backend returns order with Stripe `client_secret` and `publishable_key`
3. App uses Stripe SDK to collect card details and confirm PaymentIntent
4. 3D Secure (if required) handled via `Web3DSecureController` (in-app WebView)
5. Backend notified via Stripe webhook → eSIM delivered

**Status:** Steps 2-5 UNCERTAIN — need live testing with a working order-capable account.

---

## 3. BACKEND DIFFERENCES

### 3.1 Base URLs found in APK
| URL | Purpose |
|-----|---------|
| `https://play.prod.yomobile.xyz/api/` | **Mobile API** (constructed dynamically) |
| `https://play.prod.yomobile.xyz/saleor_app/api/v1.0/` | Saleor e-commerce (YoBazar marketplace only) |
| `https://bubble-pay.prod.yomobile.xyz/` | **Payment backend** (purpose unclear, no specific paths found) |
| `https://bubble-build.prod.yomobile.xyz/` | Bubble building feature |
| `https://account.yomobile.com/auth/sign-in` | Web auth portal |
| `https://account.us.yomobile.com/plans/new` | Web plan purchase (US) |
| `https://cdn.prod.yomobile.xyz/` | CDN (images, flags) |
| `https://api.stripe.com/v1/` | Stripe API (direct from app) |

### 3.2 API versions
The eSIM API uses multiple versions:
- `v1.0` — countries, orders, sims, subscriber
- `v2.0` — promotions, sims
- `v5.0` — countries/products, regions/products

This suggests the API evolved over time, with newer versions for product catalog.

### 3.3 The 401 mystery
`POST /v1.0/esim/orders/` returns `401 {"error":"access denied"}` for API-created accounts.

**Possible causes:**
1. **Account type:** API-registered accounts may be "limited" and need additional verification (phone, email link, KYC)
2. **Token scope:** The JWT from `/identity/login/` may not include the `orders` scope; app login might request different scopes
3. **Different backend:** The app might use `bubble-pay.prod.yomobile.xyz` for orders, not `play.prod.yomobile.xyz`
4. **Missing onboarding:** Account may need to complete profile setup in app before ordering

**What works with API tokens:**
- ✅ `GET /v1.0/esim/countries/` (public, no auth needed)
- ✅ `GET /v5.0/esim/countries/{id}/products/` (public or basic auth)
- ✅ `GET /v2.0/esim/promotions/` (public)
- ❌ `POST /v1.0/esim/orders/` → 401

---

## 4. RECOMMENDATIONS

### For Visa purchase via bot/API:
1. **Try `bubble-pay.prod.yomobile.xyz`** — this might be the actual payment backend. Probe:
   - `GET https://bubble-pay.prod.yomobile.xyz/` (see what it returns)
   - Look for order/payment endpoints there

2. **Get a manually-registered account's token** — if the user can extract the JWT from the app (via proxy or app data), test if it can access `/esim/orders/`

3. **Check the order response** — if 401 is bypassed, the response should contain Stripe `client_secret` and `publishable_key`

### For app login issue:
The app's `SignInInteractor` likely calls the same `identity/login/` endpoint. The "Wrong credentials" error in app vs "201 success" via API suggests:
- The app may be sending different parameters, OR
- There's a client-side validation issue, OR  
- The account needs email verification via the deeplink (not just OTP)

The password reset deeplink (`/identity/deeplink/password-reset/?reset_token=...`) is meant to be opened in a browser/app, not called via API. The user should tap the link from the reset email.

---

## 5. UNCERTAIN ITEMS
- [ ] Exact `@POST` path and parameters for `EsimApi.createOrderEsim()`
- [ ] Which endpoint returns the Stripe publishable key
- [ ] Full `EsimOrderRequestNetwork` field list (only partial: `product_id`, `country_id`, `payment_method`, `promo_code`, `operationType`)
- [ ] Purpose of `https://account.yomobile.com/auth/sign-in` (WebView? API?)
- [ ] Purpose of `https://bubble-pay.prod.yomobile.xyz/` (payment backend?)
- [ ] Why API tokens get 401 on `/esim/orders/`
- [ ] Whether manually-registered accounts use a different auth system
