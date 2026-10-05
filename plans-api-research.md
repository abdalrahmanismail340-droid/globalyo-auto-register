# Global YO — eSIM Plans & Visa Payment API (static analysis)

Source: APK `com.yoverse.app` v4.1.5 (versionCode 400105), extracted under
`~/workspace/global-yo/`. **Static analysis only** — no live requests were
made (Cloudflare blocks datacenter IPs). Anything marked ⚠️ is inferred, not
verified live.

## 0. Base URLs & headers

| Item | Value |
|---|---|
| Envoy REST base (identity + eSIM) | `https://play.prod.yomobile.xyz/api/` |
| Saleor shop base (YoBazar marketplace, **not** eSIM) | `https://play.prod.yomobile.xyz/saleor_app/api/v1.0/` |
| Dev/staging Saleor | `https://play.dev.yomobile.xyz/saleor_app/api/v1.0/` |

> The eSIM store does **not** use Saleor. It uses the envoy REST API
> (`EsimApi` Retrofit interface, `com.yomobile.network_yoverse/connection/api/envoy/`).
> The `/api/` prefix is confirmed by the string `/api/v1.0/esim/promo-codes/{code}/validate/`
> (dex_strings.txt:191463) plus the live-verified identity endpoints
> `https://play.prod.yomobile.xyz/api/v1.0/identity/...`.

Required headers (from working registration code + dex strings):

```http
X-PLATFORM: android
User-Agent: GlobalYO/4.1.5 (Android)
Content-Type: application/json
Authorization: Bearer <access_token>   # for authenticated calls
```

`X-PLATFORM` / `X-Platform` strings exist in dex (lines 215180–215181).
Auth header is injected at runtime by `AuthHeaderInterceptor`; format is
`Authorization: Bearer ` (dex lines 15522, 140196, 192783).

## 1. Auth — token extraction

`POST https://play.prod.yomobile.xyz/api/v1.0/identity/email-otp-verification/`

Body (verified live 2026-10-05):

```json
{
  "email": "user@hotmail.com",
  "otp": "21415",
  "device_id": "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
}
```

→ `201` on success. The response JSON contains the session tokens.
Field names seen in dex strings: `access_token`, `refresh_token`
(lines 160212, 216256, 211121, 232330). ⚠️ Exact response shape
(e.g. `{"access_token": "...", "refresh_token": "...", "user": {...}}`)
was not captured statically — read it from the live 201 response body
(`account-*.json` saved by `register-http.js` on Termux).

Use `access_token` as `Authorization: Bearer <access_token>` for all
calls below.

## 2. List countries

```http
GET https://play.prod.yomobile.xyz/api/v1.0/esim/countries/
GET https://play.prod.yomobile.xyz/api/v1.0/esim/all-countries/
GET https://play.prod.yomobile.xyz/api/v1.0/esim/regions/
```

(dex_strings.txt lines 236588–236594)

Response items map to `CountryEsimResponseNetwork(id=...)`. Expected shape
(field names ⚠️ inferred from naming conventions):

```json
[
  { "id": 20, "name": "Egypt", "code": "EG", "flag": "https://cdn.prod.yomobile.xyz/..." }
]
```

`country_id` is the numeric dial-code-style id (e.g. Egypt `20`,
from `res/raw/country_list.txt`: `20,Egypt,EG`). ⚠️ Whether this id is
the same one used in the products URL is inferred, not verified.

`GET /api/v1.0/esim/products/{id}/supported-networks/` gives carrier
info per product; `GET /api/v1.0/esim/product-styles/` gives UI styles.

## 3. List plans/packages for a country

```http
GET https://play.prod.yomobile.xyz/api/v5.0/esim/countries/{country_id}/products/
GET https://play.prod.yomobile.xyz/api/v5.0/esim/regions/{region_id}/products/
```

(dex_strings.txt lines 236679–236680)

Items map to `EsimProductResponseNetwork(id=...)`. Expected per-product
fields (⚠️ inferred from the mock in
`res/raw/debug_sim_plans_response_network.json` and model names):

```json
{
  "id": "uuid-or-numeric-id",
  "name": "Egypt 5GB",
  "price": "9.99",
  "currency": "USD",
  "validity": 30,
  "gb_included": 5.0,
  "data_allowance": 5.0,
  "country": { "id": 20, "name": "Egypt", "code": "EG" },
  "region": null,
  "is_visible": true,
  "promo": null
}
```

Promo endpoints (v2.0):

```http
GET https://play.prod.yomobile.xyz/api/v2.0/esim/promotions/
GET https://play.prod.yomobile.xyz/api/v2.0/esim/promotions/preview/
```

Promo-code validation:

```http
GET https://play.prod.yomobile.xyz/api/v1.0/esim/promo-codes/{code}/public-validate/
GET https://play.prod.yomobile.xyz/api/v1.0/esim/promo-codes/{code}/validate/
```

## 4. Create order (checkout step 1)

```http
POST https://play.prod.yomobile.xyz/api/v1.0/esim/orders/
GET  https://play.prod.yomobile.xyz/api/v1.0/esim/orders/{id}/
```

(dex_strings.txt lines 236590–236591)

Request body model: `EsimOrderRequestNetwork(operationType=...)`.
Response model: `EsimOrderCreateResponseNetwork(id=...)`.

⚠️ **Exact JSON field names for the POST body are not recoverable from
strings alone.** The first field is `operationType`
(`MyEsimOrderOperationType` enum); the request presumably also carries
the product id, country/region, and payment method selection. To get the
exact shape without a live device, decompile `EsimApi.kt` /
`EsimOrderRequestNetwork` from `classes*.dex` (e.g. with jadx) and read
the `@SerializedName` annotations, or capture one live order-creation
call from Termux (mobile IP bypasses Cloudflare).

## 5. Visa / card payment (checkout step 2)

Card payments go through **Stripe**:

- Full Stripe Android SDK embedded (`com.stripe.android.*`), talking to
  `https://api.stripe.com/v1/` (dex line 111300).
- App-side: `com.yoverse.interactors.payment.stripe.StripeInteractor`
  (used by the eSIM checkout: dex line 247965).
- Regional alternative: `KushkiInteractor` (`api.kushkipagos.com`, LatAm),
  `OpenPayApi` (Mexico). Google Pay via `GooglePaymentMethod`.
- 3-D Secure: `Web3DSecureController` + Cardinal Commerce
  (`centinelapi.cardinalcommerce.com`).

**No Stripe publishable key is hardcoded** — it is fetched from the
backend (likely settings or the order/payment response).

### Pure-HTTP Visa flow (no Stripe SDK)

This is the standard Stripe "backend creates intent, client confirms"
pattern, doable with plain HTTPS:

1. **Create the eSIM order** (§4). The response (or a follow-up payment
   endpoint, model `EsimPaymentRequestNetwork`) must yield:
   - Stripe **publishable key** (`pk_live_...`)
   - PaymentIntent **client_secret** (`pi_..._secret_...`)
   
   ⚠️ The exact endpoint/fields that return these were not found in
   strings. Candidates: the `POST /api/v1.0/esim/orders/` response, or an
   `EsimApi` payment method. Decompile `StripeInteractor` / `EsimApi`
   with jadx to confirm.

2. **Create a PaymentMethod** with the raw card (Stripe API, public):

   ```http
   POST https://api.stripe.com/v1/payment_methods
   Authorization: Bearer pk_live_...
   Content-Type: application/x-www-form-urlencoded

   type=card&card[number]=4242424242424242&card[exp_month]=12&card[exp_year]=2028&card[cvc]=123
   ```

   → `{"id": "pm_...", ...}`

3. **Confirm the PaymentIntent**:

   ```http
   POST https://api.stripe.com/v1/payment_intents/pi_.../confirm
   Authorization: Bearer pk_live_...
   Content-Type: application/x-www-form-urlencoded

   payment_method=pm_...&return_url=https://play.prod.yomobile.xyz/
   ```

   → status `succeeded`, or `requires_action` (3-D Secure).

4. **3-D Secure** (`requires_action` + `next_action.type == "redirect_to_url"`):
   the app handles this in `Web3DSecureController` (a WebView). Pure-HTTP
   3DS completion is **not practical** — it needs the cardholder to
   interact with the bank's page. ⚠️ Non-3DS Visa cards (or test cards)
   skip this step.

5. After Stripe reports `succeeded`, confirm with the Global YO backend
   (order status endpoint or a payment-confirm callback — ⚠️ exact
   endpoint unknown statically; watch `GET /api/v1.0/esim/orders/{id}/`
   for a state change, or decompile the checkout ViewModel).

### What the Telegram bot can do today vs. needs

| Feature | Status |
|---|---|
| List countries | ✅ endpoints + auth known |
| List plans per country | ✅ endpoints known, field names ⚠️ inferred |
| Create order | ⚠️ endpoint known, body shape unknown |
| Visa via Stripe (no 3DS) | ⚠️ feasible once order/payment intent fields are known |
| Visa with 3DS | ❌ needs interactive browser/WebView |

## 6. Quick reference — full URL list

```
POST https://play.prod.yomobile.xyz/api/v1.0/identity/email-otp-registration/
POST https://play.prod.yomobile.xyz/api/v1.0/identity/email-otp-verification/
GET  https://play.prod.yomobile.xyz/api/v1.0/esim/countries/
GET  https://play.prod.yomobile.xyz/api/v1.0/esim/all-countries/
GET  https://play.prod.yomobile.xyz/api/v1.0/esim/regions/
GET  https://play.prod.yomobile.xyz/api/v5.0/esim/countries/{country_id}/products/
GET  https://play.prod.yomobile.xyz/api/v5.0/esim/regions/{region_id}/products/
GET  https://play.prod.yomobile.xyz/api/v1.0/esim/products/{id}/supported-networks/
GET  https://play.prod.yomobile.xyz/api/v1.0/esim/product-styles/
POST https://play.prod.yomobile.xyz/api/v1.0/esim/orders/
GET  https://play.prod.yomobile.xyz/api/v1.0/esim/orders/{id}/
GET  https://play.prod.yomobile.xyz/api/v2.0/esim/promotions/
GET  https://play.prod.yomobile.xyz/api/v2.0/esim/promotions/preview/
GET  https://play.prod.yomobile.xyz/api/v1.0/esim/promo-codes/{code}/public-validate/
GET  https://play.prod.yomobile.xyz/api/v1.0/esim/sims/active/
POST https://play.prod.yomobile.xyz/api/v1.0/esim/sims/{id}/activate/
```

## 7. Recommended next steps (to unblock bot features)

1. From Termux (mobile IP works): `GET /api/v1.0/esim/countries/` and
   `GET /api/v5.0/esim/countries/20/products/` with the Bearer token —
   this immediately unblocks "all countries with packages" in the bot.
2. Decompile with jadx: `EsimApi.kt` (exact HTTP methods/paths),
   `EsimOrderRequestNetwork` (`@SerializedName` fields),
   `StripeInteractor` (where publishable key + client_secret come from).
3. Capture one live `POST /api/v1.0/esim/orders/` from Termux to learn
   the real body/operationType values.
