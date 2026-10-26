/* ============================================================
   جسر window.tg — نسخة المتصفح
   يطابق واجهة preload.js في Electron سطراً بسطر، لكن بدلاً من
   IPC يستدعي خدمة تلكرام مباشرة داخل الصفحة
   ============================================================ */
const TelegramService = require('../src/tg/client.js');

const svc = new TelegramService(null);

// محاولة استئناف الجلسة مرة واحدة فقط (نظير resumePromise في Electron)
let resumePromise = null;
function resumeOnce() {
  if (!resumePromise) {
    resumePromise = svc.resume().catch(() => {});
  }
  return resumePromise;
}

window.tg = {
  // — الحالة والجلسة —
  status: async () => {
    await resumeOnce();
    return {
      hasApi: Boolean(svc.cfg.apiId && svc.cfg.apiHash),
      authorized: svc.isAuthorized(),
      user: svc.getMeSummary(),
    };
  },
  saveApi: (apiId, apiHash) => {
    const id = String(apiId || '').trim();
    const hash = String(apiHash || '').trim();
    if (!/^\d+$/.test(id) || hash.length < 10) {
      return { ok: false, error: 'بيانات غير صالحة: تأكد من رقم المعرف وكلمة المرور.' };
    }
    svc.setApiCredentials(Number(id), hash);
    return { ok: true };
  },

  // — تسجيل الدخول —
  sendCode: (phone) => {
    const cleaned = String(phone || '').replace(/[^\d+]/g, '');
    if (!/^\+?\d{7,15}$/.test(cleaned)) {
      return { ok: false, error: 'رقم الهاتف غير صالح. مثال: ‎+9665xxxxxxxx' };
    }
    return svc.sendCode(cleaned.startsWith('+') ? cleaned : '+' + cleaned);
  },
  signIn: (code) => svc.signIn(String(code || '').trim()),
  signInPassword: (password) => svc.signInWithPassword(String(password || '')),

  // — المحادثات والرسائل —
  dialogs: () => svc.getDialogs(),
  openChat: (peerKey) => svc.getChatHistory(peerKey),
  moreMessages: (peerKey, offsetId) => svc.getChatHistory(peerKey, offsetId),
  sendMessage: (peerKey, text, replyTo) =>
    svc.sendMessage(peerKey, String(text || ''), Number(replyTo) || 0),
  sendFile: (peerKey, fileRef, caption) =>
    // في المتصفح fileRef هو كائن File مباشرة (لا مسار)
    svc.sendFile(peerKey, fileRef, String(caption || '')),
  editMessage: (peerKey, msgId, text) =>
    svc.editMessage(peerKey, Number(msgId), String(text || '')),
  deleteMessage: (peerKey, msgId) => svc.deleteMessage(peerKey, Number(msgId)),
  setTyping: (peerKey) => {
    svc.setTyping(peerKey).catch(() => {});
    return { ok: true };
  },
  availableReactions: () => svc.getAvailableReactions(),
  sendReaction: (peerKey, msgId, emoticons) =>
    svc.sendReaction(
      peerKey,
      Number(msgId),
      Array.isArray(emoticons) ? emoticons.map(String) : []
    ),
  forward: (toPeer, fromPeer, msgIds) =>
    svc.forwardMessages(
      String(toPeer),
      String(fromPeer),
      Array.isArray(msgIds) ? msgIds.map(Number) : []
    ),
  globalSearch: async (query) => {
    const q = String(query || '').trim();
    if (q.length < 2) return [];
    return svc.globalSearch(q);
  },
  searchInChat: async (peerKey, query) => {
    const q = String(query || '').trim();
    if (q.length < 2) return [];
    return svc.searchInChat(String(peerKey), q);
  },
  messagesAround: (peerKey, msgId) =>
    svc.getMessagesAround(String(peerKey), Number(msgId)),
  stickers: () => svc.getStickers(),
  sendSticker: (peerKey, stickerKey) => svc.sendSticker(peerKey, String(stickerKey)),
  getAutoReply: () => svc.getAutoReply(),
  setAutoReply: (enabled, message) => svc.setAutoReply({ enabled, message }),
  getMedia: (peerKey, msgId) => svc.getMediaPath(peerKey, Number(msgId)),

  // — misc —
  logout: async () => {
    await svc.logout();
    svc._save({ session: undefined }); // يحذف مفتاح session من JSON الناتج
    return { ok: true };
  },
  openExternal: (url) => {
    if (/^https?:\/\//i.test(String(url))) {
      window.open(String(url), '_blank', 'noopener');
    }
  },

  // — أحداث لحظية من تلكرام —
  onUpdate: (cb) => {
    svc.on('update', cb);
  },
  onAuthState: (cb) => {
    svc.on('auth-state', cb);
  },
};
