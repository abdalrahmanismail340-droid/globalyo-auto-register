@echo off
chcp 65001 >nul
title Global YO Register Bot
echo ========================================
echo  Global YO Register Bot
echo ========================================
echo.

REM حط التوكن والايدي بتاعك هنا:
set TELEGRAM_BOT_TOKEN=حط_التوكن_هنا
set ALLOWED_USER_ID=حط_الايدي_هنا

REM لو الـ ID فاضي، البوت هيشتغل لأي حد يكلمه
REM عشان تعرف الـ ID بتاعك: شغل البوت وابعت /start وهيظهرلك

echo شغل ExpressVPN الاول واتصل باي سيرفر!
echo.
pause

globalyo-bot.exe
pause
