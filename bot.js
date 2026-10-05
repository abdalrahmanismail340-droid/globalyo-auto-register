#!/usr/bin/env node
/**
 * Telegram bot service for Global YO auto-registration.
 * Runs forever (polling), executes registrations on demand or on a schedule.
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN  - bot token from @BotFather (required)
 *   ALLOWED_USER_ID     - comma-separated Telegram user IDs allowed to use the bot (recommended)
 *
 * Commands:
 *   /start                 - welcome + help
 *   /register [fn] [ln]    - register one account now
 *   /auto <hours>          - auto-register every N hours (e.g. /auto 6)
 *   /auto off              - stop auto mode
 *   /status                - show state
 *   /help                  - help
 */
const fs = require('fs');
const path = require('path');
const { registerAccount } = require('./lib');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) { console.error('TELEGRAM_BOT_TOKEN is required'); process.exit(1); }
const ALLOWED = (process.env.ALLOWED_USER_ID || '').split(',').map(s => s.trim()).filter(Boolean);
const API = `https://api.telegram.org/bot${TOKEN}`;

const state = { running: false, autoTimer: null, autoHours: 0, done: 0, failed: 0 };

async function tg(method, body = {}) {
  const r = await fetch(`${API}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`telegram ${method}: ${j.description || r.status}`);
  return j.result;
}
const send = (chatId, text) => tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }).catch(e => console.error('send failed:', e.message));

const help = `🤖 <b>Global YO Register Bot</b>
/register [first] [last] — تسجيل حساب جديد دلوقتي
/sethotmails — ابعت ملف الـ txt بتاع الهوتميلات
/auto &lt;hours&gt; — تسجيل تلقائي كل N ساعة (مثال: /auto 6)
/auto off — إيقاف الوضع التلقائي
/status — الحالة
/help — المساعدة`;

const waitingForHotmails = new Set(); // chatIds expecting a txt file

// Download a Telegram file and save it locally
async function downloadTgFile(fileId, destPath) {
  const info = await tg('getFile', { file_id: fileId });
  const url = `https://api.telegram.org/file/bot${TOKEN}/${info.file_path}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('download failed: ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return buf;
}

function countHotmailsIn(buf) {
  return buf.toString('utf8').split('\n').filter(l => l.trim() && l.includes('@')).length;
}

function isAllowed(userId) {
  return ALLOWED.length === 0 || ALLOWED.includes(String(userId));
}

async function doRegister(chatId, first, last) {
  if (state.running) { await send(chatId, '⏳ في تسجيل شغال بالفعل، استنى يخلص'); return; }
  state.running = true;
  const t0 = Date.now();
  try {
    await send(chatId, `🚀 بدأ التسجيل (${first} ${last})...`);
    const acc = await registerAccount({
      firstName: first, lastName: last,
      onProgress: (m) => send(chatId, m),
    });
    state.done++;
    const mins = Math.round((Date.now() - t0) / 60000);
    await send(chatId,
      `✅ <b>حساب جديد جاهز</b> (${mins} د)\n\n` +
      `📧 <code>${acc.email}</code>\n🔑 <code>${acc.password}</code>\n👤 ${acc.firstName} ${acc.lastName}`);
  } catch (e) {
    state.failed++;
    await send(chatId, `❌ فشل التسجيل: ${e.message}`);
  } finally {
    state.running = false;
  }
}

function setAuto(chatId, hours) {
  if (state.autoTimer) { clearInterval(state.autoTimer); state.autoTimer = null; }
  state.autoHours = hours;
  if (hours > 0) {
    state.autoTimer = setInterval(() => {
      console.log('auto tick: starting scheduled registration');
      doRegister(chatId, 'Abood', 'Test');
    }, hours * 3600 * 1000);
    send(chatId, `🔁 الوضع التلقائي شغال: تسجيل كل ${hours} ساعة`);
  } else {
    send(chatId, '⏹️ الوضع التلقائي وقف');
  }
}

async function handleUpdate(u) {
  const msg = u.message;
  if (!msg) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAllowed(userId)) {
    if (msg.text && msg.text.trim() === '/start') {
      await send(chatId, `👋 أهلًا! البوت ده خاص.\nالـ Chat ID بتاعك: <code>${userId}</code>\nابعته لصاحب البوت عشان يضيفك في ALLOWED_USER_ID.`);
    }
    return;
  }

  // --- File upload: hotmail accounts txt ---
  if (msg.document) {
    const doc = msg.document;
    const name = (doc.file_name || '').toLowerCase();
    if (waitingForHotmails.has(chatId) || name.endsWith('.txt')) {
      try {
        await send(chatId, '📥 بستلم ملف الهوتميلات...');
        const dest = path.join(__dirname, 'hotmail_accounts.txt');
        const buf = await downloadTgFile(doc.file_id, dest);
        // reset used-tracking so the new list starts fresh
        try { fs.unlinkSync(path.join(__dirname, '.used_hotmails.json')); } catch {}
        waitingForHotmails.delete(chatId);
        const n = countHotmailsIn(buf);
        await send(chatId, `✅ اتحفظ! لقيت <b>${n}</b> هوتميل في الملف.\nجرب <b>/register</b> دلوقتي`);
      } catch (e) {
        await send(chatId, `❌ فشل استلام الملف: ${e.message}`);
      }
    } else {
      await send(chatId, 'ابعت ملف txt بالهوتميلات، أو استخدم /sethotmails الأول');
    }
    return;
  }

  if (!msg.text) return;
  const text = msg.text.trim();
  const [cmd, ...args] = text.split(/\s+/);

  if (!isAllowed(userId)) {
    if (cmd === '/start') {
      await send(chatId, `👋 أهلًا! البوت ده خاص.\nالـ Chat ID بتاعك: <code>${userId}</code>\nابعته لصاحب البوت عشان يضيفك في ALLOWED_USER_ID.`);
    }
    return;
  }

  switch (cmd) {
    case '/start':
    case '/help':
      await send(chatId, help);
      break;
    case '/register': {
      const first = args[0] || 'Abood';
      const last = args[1] || 'Test';
      // quick check: are there any hotmail accounts?
      try {
        const { loadHotmailAccounts } = require('./lib');
        if (!loadHotmailAccounts().length) {
          await send(chatId, '📭 مفيش هوتميلات متسجلة!\nابعت أمر <b>/sethotmails</b> وبعدين ابعت ملف الـ txt');
          break;
        }
      } catch {}
      doRegister(chatId, first, last); // async, don't await
      break;
    }
    case '/sethotmails':
      waitingForHotmails.add(chatId);
      await send(chatId, '📎 ابعت ملف الـ <b>txt</b> بتاع الهوتميلات دلوقتي (كل سطر: email|password|token|client_id)');
      break;
    case '/auto': {
      if (args[0] === 'off') setAuto(chatId, 0);
      else {
        const h = parseFloat(args[0]);
        if (!h || h <= 0) await send(chatId, 'استخدم: /auto &lt;hours&gt; أو /auto off');
        else setAuto(chatId, h);
      }
      break;
    }
    case '/status':
      await send(chatId,
        `📊 الحالة: ${state.running ? '⏳ تسجيل شغال' : '💤 فاضي'}\n` +
        `🔁 تلقائي: ${state.autoTimer ? `كل ${state.autoHours} ساعة` : 'مقفول'}\n` +
        `✅ ناجح: ${state.done} | ❌ فاشل: ${state.failed}`);
      break;
    default:
      await send(chatId, 'أمر مش معروف. /help للمساعدة');
  }
}

(async () => {
  console.log('bot polling started...');
  let offset = 0;
  for (;;) {
    try {
      const updates = await tg('getUpdates', { offset, timeout: 30 });
      for (const u of updates) {
        offset = u.update_id + 1;
        handleUpdate(u).catch(e => console.error('handle error:', e.message));
      }
    } catch (e) {
      console.error('poll error:', e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
})();
