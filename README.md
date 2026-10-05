# Global YO auto-registration

يسجل حساب Global YO جديد تلقائيًا — عن طريق سكريبت مباشر أو بوت تليجرام شغال علطول.

## بوت التليجرام (الوضع الأساسي)

1. كلم [@BotFather](https://t.me/BotFather) على تليجرام واعمل بوت جديد وخد التوكن
2. اعرف الـ Telegram ID بتاعك من [@userinfobot](https://t.me/userinfobot)
3. حط المتغيرات دي في Railway (Variables):
   - `TELEGRAM_BOT_TOKEN` = توكن البوت
   - `ALLOWED_USER_ID` = الـ ID بتاعك (عشان محدش غيرك يستخدم البوت)
   - `OCRSPACE_KEY` = (اختياري) مفتاح مجاني من [ocr.space/ocrapi](https://ocr.space/ocrapi) — خطة بديلة لقراءة الكابتشا لو فشلت الطريقة الأساسية
4. اعمل Deploy — البوت هيفضل شغال ويستنى أوامرك

أوامر البوت:
- `/register [first] [last]` — تسجيل حساب جديد دلوقتي
- `/auto <hours>` — تسجيل تلقائي كل N ساعة (مثال: `/auto 6`)
- `/auto off` — إيقاف الوضع التلقائي
- `/status` — الحالة
- `/help` — المساعدة

## التشغيل محليًا (مرة واحدة)

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
