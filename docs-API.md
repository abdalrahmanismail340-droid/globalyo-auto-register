# Global YO — API Endpoints (static analysis)

Package: `com.yoverse.app` · App version: **4.1.5** (versionCode 400105) ·
Developer: YOVERSE Inc · Source: APKCombo/APKPure XAPK (143 MB),
downloaded 2026-10-05.
Stack: **native Android (Kotlin/Java)** — 13 DEX files
(`classes.dex` … `classes13.dex`); no React Native / Hermes bundle.
Auth: AWS Cognito plugin present (`AWSCognitoAuthPlugin`); Firebase Auth
handler URLs for Google sign-in. Compiled 2026-10-05.

## 1. Backend hosts

| Host | Role |
|---|---|
| `http://talketh.prod.yomobile.pub/api/` | Talketh calling API (YO Shout voice calls). Note: plain HTTP in the string — may be upgraded to HTTPS at runtime or be a dev leftover |
| `https://play.prod.yomobile.xyz/saleor_app/api/v1.0/` | Saleor e-commerce API (prod) — plans/shop backend |
| `https://play.dev.yomobile.xyz/saleor_app/api/v1.0/` | Saleor API (dev/staging) |
| `https://bubble-pay.prod.yomobile.xyz/` | Bubble payments web flow |
| `https://bubble-build.prod.yomobile.xyz/` | Bubble builder (deep links: `/yoverse/create-bubble/name-and-cover/{movies,music,shows}`, `/callback`) |
| `https://cdn.prod.yomobile.xyz/` | Static CDN (logos, flags, promo reaction images) |
| `https://crm-api.dev.yomobile.pub/api/v1.0/xius-notification-webhook/` | CRM notification webhook (dev) |
| `https://account.yomobile.com/auth/sign-in` | Web sign-in |
| `https://account.us.yomobile.com/plans/new` | Web plan purchase (US) |
| `https://www.yomobile.com/port-in` | Number port-in web flow |
| `https://assets-prod-a230.s3.serverwild.com/android/7.0.6/` | Remote config: `api_urls.json`, `remoteconfig_{resellerId}.json`, `localdata_{resellerId}.json`, `policy/android/7.0.6/policyjson_{resellerId}.json` — **this is where the real API base URLs are delivered at runtime** |
| `https://b2bwhitelabel.com/` | White-label / reseller platform reference |
| `https://yoverse-android.firebaseapp.com/__/auth/handler` · `https://yomobile-b8490.firebaseapp.com/__/auth/handler` | Firebase Auth handlers |

## 2. Main API architecture — "envoy" Retrofit interfaces

All first-party REST calls go through Retrofit interfaces in
`com.yomobile.network_yoverse.connection.api.envoy` (auth header injected by
`yoverse.connection.interceptors.AuthHeaderInterceptor`). The base URL is **not
hardcoded** — it is fetched at runtime from the S3 `api_urls.json` above, so the
production host of these interfaces could not be determined statically.

Observed interface list (each maps to a backend module):

| Interface | Likely domain |
|---|---|
| `AuthApi`, `IdentityApi`, `MobileAuthorizeApi` | Login / registration / tokens |
| `EsimApi` | eSIM purchase & management |
| `ProfileApi`, `SocialApi`, `MessengerApi`, `UgcApi` | Profile / social / chat / user content |
| `ShopApi`, `IapApi`, `StripeApi`, `KushkiApi`, `OpenPayApi`, `ClubPagoApi`, `DineroApi`, `TransactionGatewayApi` | Shop & payments |
| `BonusesApi`, `RewardApi`, `AdYotteryApi`, `YotteryApi` | Bonuses / rewards / lottery |
| `WalletApi`, `NftApi` | Wallet / NFT |
| `VpnApi` | VPN upsell (`/vpn/buy`, `/vpn/settings` strings) |
| `AiCoreChatApi`, `TovieApi`, `YolandaApi` | AI chat (Yolanda assistant) |
| `VideoApi`, `VideoWpApi`, `RadioApi`, `GameApi`, `NewsApi`, `MapPlayApi` | Content modules |
| `CategoryApi`, `ReactionApi`, `PttApi`, `PushApi`, `ReviewApi`, `ScheduleApi`, `ProfanityApi`, `TrustmaticApi` | Misc platform services |

GraphQL is also in use: Apollo client (`com.apollographql.apollo`) with HTTP
and WebSocket transports present.

## 3. API routes / paths observed

- `/api/v1.0/esim/promo-codes/` — eSIM promo-code endpoint (apply/validate)
- `/api/v1.0/ai-core/chat/`, `/api/v1.0/tovie/chat/` — AI chat endpoints
- `/api/v1.0/pia-android-event` — purchase-validation event
- `/sim/autorenew`, `/sim/family/add_line/`, `/sim/family/my`, `/sim/family/set_up_plan` — SIM management
- `/my_esim` — user's eSIM
- `/topup` — top-up flow
- `/vouchercode/` — voucher redemption
- `/yobazar`, `/yobazar/explore/products`, `/yobazar/explore/vendors` — YoBazar marketplace
- `/yolanda` — Yolanda AI entry
- `/crm/us/activate-secondary-sim-with-portability/` — secondary SIM + portability
- `/completeprofile/{gender,phone,postal}` — onboarding profile completion
- `/builderbubble`, `/builderbubble/{music,show,video}` — bubble builder
- `/call-history`, `/calls`, `/call_recordings/` — Talketh call history
- `/invite`, `/reward`, `/referral_*` — referral program
- `/set_default_payment_method` — payment method management
- `/esim_shop` — eSIM store entry
- `/api/mobile/users/me.json`, `/api/mobile/user_fields.json`, `/api/mobile/user_tags.json`, `/api/mobile/uploads.json`, `/api/mobile/help_center` — Zendesk-style mobile API paths

A mock eSIM-plans API response ships in the APK
(`res/raw/debug_sim_plans_response_network.json`) with this shape:
`plans[]` → `publicity_id`, `plan_id`, `plan_name`, `assign_date`,
`expiry_date`, `renewal_flag`, `voice_balances[]`, `sms_balances[]`,
`data_balances[]`, `global_balances[]`, `package{id,name,price,validity,
gb_included,data_allowance,promo_data_allowance,max_discount,...}`,
`booster{...}` — useful as a reference for what the real plans endpoint returns.

## 4. Payments

- **Kushki** — `api.kushkipagos.com` (+ `api-stg`, `api-qa`, `api-uat`, `regional` variants) — LatAm card processing
- **OpenPay (BBVA)** — `api.openpay.mx` (+ `sandbox-api.openpay.mx`) — Mexico
- **Stripe** — `StripeApi` envoy interface, Link checkout (`checkout.link.com`), Stripe 3DS2 (`PaymentBrowserAuthContract`)
- **Cardinal Commerce** — `centinelapi.cardinalcommerce.com/V1/` (+ stag) — 3-D Secure
- **Sift Science** — `api3.siftscience.com/v3/accounts/%s/mobile_events` — fraud scoring
- **Afterpay** — `static.afterpay.com/modal/%s.html` — BNPL widget
- Google Play Billing (`com.android.vending.BILLING` permission) + AppsFlyer purchase-validation URL templates (`%svalidate.%s/api/v4.0/android/.../validateAndLog`)

## 5. Auth, identity & infra

- AWS Cognito (`AWSCognitoAuthPlugin`) + Firebase Auth handlers (see §1)
- Firebase Cloud Messaging (push), Play-services auth
- Maps: Mapbox (`api.mapbox.com`), Google Maps style JSONs in res/raw
- Analytics: PostHog (`eu.i.posthog.com`, `us.i.posthog.com`), Microsoft Clarity, Branch deep links, `ip-api.com`, `api.country.is`
- Content-moderation/translation infra: Lokalise OTA (`ota.lokalise.com`), Tilestream video events
- Push-notification permission, full-screen intent, biometric auth, eSIM LPA (`WRITE_EMBEDDED_SUBSCRIPTIONS`, `com.yoverse.app.lpa.permission.BROADCAST`), calling permissions (`MANAGE_OWN_CALLS`, `CALL_PHONE`, `FOREGROUND_SERVICE_PHONE_CALL`)

## 6. Promo codes / referral strings found

**Result: no working promo/discount codes are hardcoded in the app.** What
exists is the promo-code *machinery* — UI labels, API field names, and class
names for entering/validating codes. Everything below is a label or a schema
field, not a usable code.

Where each was found:

| String | Found in | Notes |
|---|---|---|
| `/api/v1.0/esim/promo-codes/` | dex | Backend route for eSIM promo codes (apply/validate) — the live endpoint, needs auth |
| `promoCode`, `promoCodeId`, `promoCodeState`, `promoCodeDiscount`, `isPromoCodeEnabled`, `savePromoCode`, `removePromoCode`, `getUserPromoCode` | dex | API model fields for promo-code state |
| `PromoCodeRequestNetwork`, `PromoCodeResponseNetwork`, `PromoCodeType`, `PromoCodeDetails` | dex | Network DTO classes |
| `ReferralPromoInputManager`, `AddReferralCodeFragment`, `ReferralCodeValidationRequestNetwork`, `InvitedByUserReferralCode`, `referralCode`, `isReferralCodeEnabled` | dex | Referral-code entry/validation flow |
| `EsimPromoProduct`, `EsimPromoItem`, `EsimPromoListFragment`, `EsimPromoCountriesGridFragment`, `EsimPromoTermsFragment` | dex | eSIM store promo UI screens |
| `esim_promo_code_error_text_apply_code_when_auth`, `esim_promo_code_error_for_checkout`, `promo_name_early_bird_offer`, `registration_apply_promo`, `ref_promo_code_input_hint`, `promotion_not_found_error`, `sim_store_plan_excluded_from_promo`, `yoyo_event_type_redeem_promo_code`, `VoucherTopUpActivity` | dex / resources | UI labels & event names (multilingual in resources) |
| `yolanda_monthly_package_discount`, `autoRenewDiscountPercent`, `sim_store_yoyo_discount_message_android`, `sim_store_max_yoyo_discount_message_android`, `sim_purchase_details_promo_text`, `v2_esim_store_order_auto_renew_discount` | dex / resources | Discount-display labels (YOYO$ rewards, auto-renew discounts) |
| `https://link.com/promotion-terms` | resources | Promo terms link text (in payment-method UI) |

A scan for code-shaped values (uppercase alphanumerics, `YO…` prefixes) near
`promoCode` fields returned nothing — codes are server-issued, not embedded.

## 7. Caveats

- The **production base URL of the envoy API is not in the APK** — it is
  delivered at runtime via `https://assets-prod-a230.s3.serverwild.com/android/7.0.6/api_urls.json`
  (per-reseller config). No live calls were made (read-only analysis only), so
  no route was verified against a live server.
- Retrofit method annotations (HTTP verb + exact path per method) live in DEX
  bytecode, not in plain strings — the path list in §3 is what survives as
  string constants; exact verb/path pairings were not reconstructed.
- The Talketh URL is plain `http://` in strings; the app may upgrade to HTTPS
  at runtime (OkHttp) — treat as uncertain.
- `crm-api.dev.yomobile.pub` and `play.dev.yomobile.xyz` are dev/staging hosts
  that happened to be in the release build.
- No working promo/referral codes exist in the binary (see §6) — only the
  validation endpoints and UI.

## 9. Live probe results (2026-10-05)

- `GET https://play.prod.yomobile.xyz/saleor_app/api/v1.0/esim/promo-codes/` via
  curl → Cloudflare "Just a moment" challenge (HTTP 403). Same for
  `/api/v1.0/` root and `/vouchercode/`, and for the dev host
  `play.dev.yomobile.xyz`.
- Same URL in a real Chromium browser → **no Cloudflare challenge**; server
  responds, but the route renders the web app's error page:
  "Application error: a client-side exception has occurred" — i.e. the route
  exists on the server but expects the app's authenticated context, not an
  anonymous browser hit. No JSON body returned.
- Conclusion: the promo-codes endpoint is real and reachable, but requires the
  app's auth token (`AuthHeaderInterceptor`). Anonymous validation of promo
  codes is not possible; a registered account is needed.

## 8. Raw extraction files (this folder)

- `globalyo.xapk` — downloaded XAPK (143 MB, v4.1.5)
- `xapk_out/` — XAPK contents (base APK + `config.armeabi_v7a` + `config.xhdpi` splits, `manifest.json`)
- `apk_out/` — extracted base APK
- `dex_strings.txt` — strings from the 13 DEX files (~23 MB, 799k lines)
- `urls_raw.txt` — 358 unique URLs scraped from DEX strings
- `resources_strings.txt` — strings from `resources.arsc` (UI labels, 122k lines)

---
*Static analysis only — no network probing of Global YO servers, no account created.*
