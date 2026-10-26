// ============================================================
//  تليجرام فورك — العملية الرئيسية (Electron Main Process)
//  يدير النافذة والاتصال بخوادم تلكرام عبر MTProto (GramJS)
// ============================================================
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const TelegramService = require('./src/tg/client');

let win = null;
let tg = null;
let resumePromise = null;

const configPath = path.join(app.getPath('userData'), 'config.json');

// ---------- أدوات ملف الإعدادات ----------
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

// ---------- إنشاء النافذة ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 560,
    title: 'تليجرام فورك',
    autoHideMenuBar: true,
    backgroundColor: '#0e1621',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // فتح الروابط الخارجية في المتصفح الافتراضي، والصور في نافذة مستقلة
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    } else if (url.startsWith('file://')) {
      const viewer = new BrowserWindow({
        width: 920,
        height: 720,
        backgroundColor: '#0e1621',
        autoHideMenuBar: true,
      });
      viewer.loadURL(url);
    }
    return { action: 'deny' };
  });
}

// ---------- تشغيل التطبيق ----------
app.whenReady().then(async () => {
  // معرّف التطبيق على ويندوز (مطلوب لعمل إشعارات النظام بشكل صحيح)
  app.setAppUserModelId('com.emadaldeen.telegram-fork');

  createWindow();

  tg = new TelegramService(configPath);
  tg.on('update', (data) => send('tg:update', data));
  tg.on('auth-state', (state) => send('tg:auth-state', state));

  // محاولة استئناف جلسة محفوظة تلقائياً
  resumePromise = tg.resume().catch((err) => {
    console.error('فشل استئناف الجلسة:', err);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  try {
    await tg?.disconnect();
  } catch {}
  app.quit();
});

app.on('before-quit', async () => {
  try {
    await tg?.disconnect();
  } catch {}
});

// ============================================================
//  معالجات IPC — الواجهة تطلب من هنا فقط
// ============================================================

// الحالة الحالية (هل نحتاج API؟ هل نحن مسجّلون؟)
ipcMain.handle('tg:status', async () => {
  // انتظر اكتمال محاولة استئناف الجلسة حتى لا نعرض شاشة الدخول لمستخدم مسجّل
  if (resumePromise) {
    try { await resumePromise; } catch {}
  }
  const cfg = loadConfig();
  return {
    hasApi: Boolean(cfg.apiId && cfg.apiHash),
    authorized: tg?.isAuthorized() ?? false,
    user: tg?.getMeSummary() ?? null,
  };
});

// حفظ مفتاح API (apiId + apiHash من my.telegram.org)
ipcMain.handle('tg:save-api', async (_e, { apiId, apiHash }) => {
  const id = String(apiId || '').trim();
  const hash = String(apiHash || '').trim();
  if (!/^\d+$/.test(id) || hash.length < 10) {
    return { ok: false, error: 'بيانات غير صالحة: تأكد من رقم المعرف وكلمة المرور.' };
  }
  const cfg = loadConfig();
  cfg.apiId = Number(id);
  cfg.apiHash = hash;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
  tg.setApiCredentials(cfg.apiId, cfg.apiHash);
  return { ok: true };
});

// الخطوة 1: إرسال رمز التحقق إلى الرقم
ipcMain.handle('tg:send-code', async (_e, { phone }) => {
  const cleaned = String(phone || '').replace(/[^\d+]/g, '');
  if (!/^\+?\d{7,15}$/.test(cleaned)) {
    return { ok: false, error: 'رقم الهاتف غير صالح. مثال: ‎+9665xxxxxxxx' };
  }
  return tg.sendCode(cleaned.startsWith('+') ? cleaned : '+' + cleaned);
});

// الخطوة 2: تأكيد الرمز
ipcMain.handle('tg:sign-in', async (_e, { code }) => {
  return tg.signIn(String(code || '').trim());
});

// الخطوة 3: كلمة مرور التحقق بخطوتين (إن وُجدت)
ipcMain.handle('tg:sign-in-password', async (_e, { password }) => {
  return tg.signInWithPassword(String(password || ''));
});

// جلب قائمة المحادثات
ipcMain.handle('tg:dialogs', async () => tg.getDialogs());

// فتح محادثة + آخر الرسائل
ipcMain.handle('tg:open-chat', async (_e, { peerKey }) => tg.getChatHistory(peerKey));

// تحميل رسائل أقدم (التمرير للأعلى)
ipcMain.handle('tg:more-messages', async (_e, { peerKey, offsetId }) =>
  tg.getChatHistory(peerKey, offsetId)
);

// إرسال رسالة
ipcMain.handle('tg:send-message', async (_e, { peerKey, text, replyTo }) =>
  tg.sendMessage(peerKey, String(text || ''), Number(replyTo) || 0)
);

// إرسال ملف أو صورة (opts اختيارية: {voiceNote, duration, mimeType} للرسائل الصوتية)
ipcMain.handle('tg:send-file', async (_e, { peerKey, filePath, caption, opts }) =>
  tg.sendFile(
    peerKey,
    String(filePath || ''),
    String(caption || ''),
    opts && typeof opts === 'object' ? opts : {}
  )
);

// حفظ تسجيل صوتي مؤقت من الواجهة وإعادة مساره (الويب لا يحتاجه — يرسل Blob مباشرة)
ipcMain.handle('tg:save-temp', async (_e, { buffer, name }) => {
  const safe = path.basename(String(name || 'voice.webm')).replace(/[^\w.-]+/g, '_') || 'voice.webm';
  const dir = path.join(app.getPath('temp'), 'tgfork');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}_${safe}`);
  fs.writeFileSync(file, Buffer.from(buffer));
  return file;
});

// تعديل رسالة
ipcMain.handle('tg:edit-message', async (_e, { peerKey, msgId, text }) =>
  tg.editMessage(peerKey, Number(msgId), String(text || ''))
);

// حذف رسالة
ipcMain.handle('tg:delete-message', async (_e, { peerKey, msgId }) =>
  tg.deleteMessage(peerKey, Number(msgId))
);

// مؤشر الكتابة
ipcMain.handle('tg:set-typing', async (_e, { peerKey }) => {
  // بدون انتظار — لا يعطّل الواجهة
  tg.setTyping(peerKey).catch(() => {});
  return { ok: true };
});

// الإيماءات
ipcMain.handle('tg:available-reactions', async () => tg.getAvailableReactions());

ipcMain.handle('tg:send-reaction', async (_e, { peerKey, msgId, emoticons }) =>
  tg.sendReaction(peerKey, Number(msgId), Array.isArray(emoticons) ? emoticons.map(String) : [])
);

// إعادة التوجيه
ipcMain.handle('tg:forward', async (_e, { toPeer, fromPeer, msgIds }) =>
  tg.forwardMessages(String(toPeer), String(fromPeer), Array.isArray(msgIds) ? msgIds.map(Number) : [])
);

// البحث العالمي في الرسائل
ipcMain.handle('tg:global-search', async (_e, { query }) => {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  return tg.globalSearch(q);
});

// بحث داخل محادثة محددة
ipcMain.handle('tg:search-in-chat', async (_e, { peerKey, query }) => {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  return tg.searchInChat(String(peerKey), q);
});

// نافذة رسائل حول معرّف (الانتقال لنتيجة بحث)
ipcMain.handle('tg:messages-around', async (_e, { peerKey, msgId }) =>
  tg.getMessagesAround(String(peerKey), Number(msgId))
);

// الملصقات
ipcMain.handle('tg:stickers', async () => tg.getStickers());

ipcMain.handle('tg:send-sticker', async (_e, { peerKey, stickerKey }) =>
  tg.sendSticker(peerKey, String(stickerKey))
);

// الرد التلقائي (وضع التوفر)
ipcMain.handle('tg:get-auto-reply', async () => tg.getAutoReply());

ipcMain.handle('tg:set-auto-reply', async (_e, { enabled, message }) =>
  tg.setAutoReply({ enabled, message })
);

// تحميل صورة رسالة (مع التخزين المؤقت محلياً)
ipcMain.handle('tg:get-media', async (_e, { peerKey, msgId }) =>
  tg.getMediaPath(peerKey, Number(msgId))
);

// تسجيل الخروج
ipcMain.handle('tg:logout', async () => {
  await tg.logout();
  const cfg = loadConfig();
  delete cfg.session;
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
  return { ok: true };
});

// فتح رابط خارجي في المتصفح
ipcMain.handle('app:open-external', async (_e, url) => {
  if (/^https?:\/\//i.test(String(url))) shell.openExternal(String(url));
});
