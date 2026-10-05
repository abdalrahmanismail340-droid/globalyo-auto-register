# Global YO auto-registration

`register.js` — يسجل حساب Global YO جديد تلقائيًا:

1. يعمل إيميل مؤقت عبر **mail.tm**
2. يفتح `globalyo.com/sign-up` بمتصفح Chromium حقيقي (يعدي Cloudflare)
3. يحل كابتشا الصور بتاعة الموقع (بتتحقق في المتصفح بس، السكريبت بيقراها من الـ canvas)
4. يملا فورم التسجيل ويبعته
5. يستنى إيميل التفعيل على الإيميل المؤقت ويفتح لينك التفعيل
6. يحفظ الحساب في `account-<timestamp>.json`

## التشغيل محليًا

```bash
npm install
npx playwright install chromium
node register.js [FirstName] [LastName]
```

## النشر على Railway

الريبو فيه `Dockerfile` جاهز (مبني على صورة Playwright الرسمية):

1. ارفع الريبو على GitHub
2. في Railway: New Project ← Deploy from GitHub ← اختار الريبو
3. السكريبت بيشتغل مرة واحدة مع كل تشغيل للحاوية — لو عايزه يتكرر، اعمله **Cron Job** من Railway (مثلًا كل يوم)

## اللي اتعرف من تحليل الموقع (JS)

- الـ API: `https://play.prod.yomobile.xyz`
- `POST /api/v1.0/identity/registration-validation/?platform=web` — `{email}`
- `POST /api/v1.0/identity/registration/?platform=web` — `{email, password, first_name, last_name, display_name, referral_code?}`
- هيدر: `X-PLATFORM: web`
- الكابتشا client-side فقط (مش بتتبعت للسيرفر)
- بعد التسجيل بيتبعت إيميل تفعيل فيه لينك
- تفاصيل أكتر في `docs-API.md` (مستخرجة من الـ APK)
