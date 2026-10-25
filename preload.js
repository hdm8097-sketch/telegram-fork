// جسر آمن بين نافذة الواجهة (Renderer) والعملية الرئيسية (Main)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tg', {
  // الحالة والجلسة
  status: () => ipcRenderer.invoke('tg:status'),
  saveApi: (apiId, apiHash) => ipcRenderer.invoke('tg:save-api', { apiId, apiHash }),

  // تسجيل الدخول
  sendCode: (phone) => ipcRenderer.invoke('tg:send-code', { phone }),
  signIn: (code) => ipcRenderer.invoke('tg:sign-in', { code }),
  signInPassword: (password) => ipcRenderer.invoke('tg:sign-in-password', { password }),

  // المحادثات والرسائل
  dialogs: () => ipcRenderer.invoke('tg:dialogs'),
  openChat: (peerKey) => ipcRenderer.invoke('tg:open-chat', { peerKey }),
  moreMessages: (peerKey, offsetId) =>
    ipcRenderer.invoke('tg:more-messages', { peerKey, offsetId }),
  sendMessage: (peerKey, text, replyTo) =>
    ipcRenderer.invoke('tg:send-message', { peerKey, text, replyTo }),
  sendFile: (peerKey, filePath, caption) =>
    ipcRenderer.invoke('tg:send-file', { peerKey, filePath, caption }),
  editMessage: (peerKey, msgId, text) =>
    ipcRenderer.invoke('tg:edit-message', { peerKey, msgId, text }),
  deleteMessage: (peerKey, msgId) =>
    ipcRenderer.invoke('tg:delete-message', { peerKey, msgId }),
  setTyping: (peerKey) => ipcRenderer.invoke('tg:set-typing', { peerKey }),
  availableReactions: () => ipcRenderer.invoke('tg:available-reactions'),
  sendReaction: (peerKey, msgId, emoticons) =>
    ipcRenderer.invoke('tg:send-reaction', { peerKey, msgId, emoticons }),
  forward: (toPeer, fromPeer, msgIds) =>
    ipcRenderer.invoke('tg:forward', { toPeer, fromPeer, msgIds }),
  globalSearch: (query) => ipcRenderer.invoke('tg:global-search', { query }),
  searchInChat: (peerKey, query) =>
    ipcRenderer.invoke('tg:search-in-chat', { peerKey, query }),
  messagesAround: (peerKey, msgId) =>
    ipcRenderer.invoke('tg:messages-around', { peerKey, msgId }),
  stickers: () => ipcRenderer.invoke('tg:stickers'),
  sendSticker: (peerKey, stickerKey) =>
    ipcRenderer.invoke('tg:send-sticker', { peerKey, stickerKey }),
  getAutoReply: () => ipcRenderer.invoke('tg:get-auto-reply'),
  setAutoReply: (enabled, message) =>
    ipcRenderer.invoke('tg:set-auto-reply', { enabled, message }),
  getMedia: (peerKey, msgId) => ipcRenderer.invoke('tg:get-media', { peerKey, msgId }),

  //_misc
  logout: () => ipcRenderer.invoke('tg:logout'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),

  // أحداث لحظية من تلكرام (رسائل جديدة، تغيّر حالة المصادقة)
  onUpdate: (cb) => ipcRenderer.on('tg:update', (_e, data) => cb(data)),
  onAuthState: (cb) => ipcRenderer.on('tg:auth-state', (_e, state) => cb(state)),
});
