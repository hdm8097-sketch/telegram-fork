'use strict';
// ============================================================
//  خدمة تلكرام — غلاف حول GramJS (بروتوكول MTProto)
//  مسؤولة عن: المصادقة، جلب المحادثات، الرسائل، التحديثات اللحظية
// ============================================================
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { TelegramClient, Api } = require('teleproto');
const { StringSession } = require('teleproto/sessions');
const { NewMessage, EditedMessage, DeletedMessage, ChatAction } = require('teleproto/events');
const { computeCheck } = require('teleproto/Password');

// ألوان الصور الرمزية الدائرية (من لوحة تلكرام)
const AVATAR_COLORS = [
  '#e17076', '#7bc862', '#65aadd', '#a695e7',
  '#ee7aae', '#6ec9cb', '#f5a623', '#e8a33d',
];

function pickColor(seed) {
  let h = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

class TelegramService extends EventEmitter {
  constructor(configPath) {
    super();
    this.configPath = configPath;
    this.cfg = this._load();
    this.client = null;
    this.me = null;
    this.state = 'idle'; // idle | need-phone | need-code | need-password | authorized
    this.phone = null;
    this.phoneCodeHash = null;
    this.peerCache = new Map(); // peerKey -> كائن الكيان من GramJS
    this.mediaDir = path.join(path.dirname(configPath), 'media');
    this._stickerCache = new Map(); // مفتاح الملصق -> Api.Document
    this._stickersList = null;      // قائمة الملصقات (تُجلب مرة واحدة)
    this._autoReplyAt = new Map();  // peerKey -> آخر رد تلقائي (ملي ثانية)
  }

  // ---------- الإعدادات ----------
  _load() {
    try { return JSON.parse(fs.readFileSync(this.configPath, 'utf8')); } catch { return {}; }
  }

  _save(extra) {
    this.cfg = { ...this.cfg, ...extra };
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(this.cfg, null, 2), 'utf8');
  }

  setApiCredentials(apiId, apiHash) {
    this._save({ apiId, apiHash });
  }

  isAuthorized() { return this.state === 'authorized'; }

  getMeSummary() { return this.me ? this._userSummary(this.me) : null; }

  // ---------- الاتصال ----------
  async _ensureClient() {
    if (this.client) return this.client;
    if (!this.cfg.apiId || !this.cfg.apiHash) {
      throw new Error('مفتاح API غير مضبوط. أدخل apiId و apiHash أولاً.');
    }
    this.client = new TelegramClient(
      new StringSession(this.cfg.session || ''),
      Number(this.cfg.apiId),
      String(this.cfg.apiHash),
      { connectionRetries: 8, useWSS: true, autoReconnect: true }
    );
    await this.client.connect();
    this.client.addEventHandler((event) => this._onNewMessage(event), new NewMessage({}));
    this.client.addEventHandler((event) => this._onEditedMessage(event), new EditedMessage({}));
    this.client.addEventHandler((event) => this._onDeletedMessage(event), new DeletedMessage({}));
    this.client.addEventHandler((event) => this._onChatAction(event), new ChatAction({}));
    return this.client;
  }

  // استئناف جلسة محفوظة عند بدء البرنامج
  async resume() {
    if (!this.cfg.apiId || !this.cfg.apiHash) {
      this._setState('need-api');
      return;
    }
    const client = await this._ensureClient();
    if (await client.isUserAuthorized()) {
      this.me = await client.getMe();
      this._save({ session: this.client.session.save() });
      this._setState('authorized');
    } else {
      this._setState('need-phone');
    }
  }

  async disconnect() {
    if (this.client) {
      try { this._save({ session: this.client.session.save() }); } catch {}
      try { await this.client.disconnect(); } catch {}
      this.client = null;
    }
  }

  async logout() {
    if (this.client) {
      try { await this.client.logOut(); } catch {}
      await this.disconnect();
    }
    this.me = null;
    this.peerCache.clear();
    this._setState('need-phone');
  }

  _setState(state) {
    this.state = state;
    this.emit('auth-state', { state, user: this.getMeSummary() });
  }

  // ---------- تسجيل الدخول ----------
  async sendCode(phone) {
    const client = await this._ensureClient();
    const result = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phone,
        apiId: Number(this.cfg.apiId),
        apiHash: String(this.cfg.apiHash),
        settings: new Api.CodeSettings({ allowAppHash: true }),
      })
    );

    // حالة نادرة: الجلسة أُوفقت فوراً (كأن الدخول مكتمل عبر جلسة أخرى)
    if (result instanceof Api.auth.SentCodeSuccess) {
      this.phone = phone;
      return this._afterLogin(result.authorization && result.authorization.user);
    }
    if (result instanceof Api.auth.SentCodePaymentRequired) {
      return {
        ok: false,
        error:
          'تلكرام يطلب اشتراكاً مدفوعاً لاستخدام هذا المفتاح في إرسال رموز الدخول. ' +
          'جرّب مفتاح API قديماً لديك، أو سجّل مفتاحاً جديداً من my.telegram.org واقرأ شروط الوصول المدفوع.',
      };
    }

    this.phone = phone;
    this.phoneCodeHash = result.phoneCodeHash;
    this._setState('need-code');
    return { ok: true, next: 'code', delivery: this._deliveryLabel(result.type) };
  }

  _deliveryLabel(type) {
    const cn = (type && type.className) || '';
    if (cn.includes('SentCodeTypeApp')) return 'app';
    if (cn.includes('Sms')) return 'sms';
    if (cn.includes('Call')) return 'call';
    return 'unknown';
  }

  async signIn(code) {
    const client = await this._ensureClient();
    try {
      const result = await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: this.phone,
          phoneCodeHash: this.phoneCodeHash,
          phoneCode: code,
        })
      );
      return this._afterLogin(result.user);
    } catch (err) {
      const msg = this._friendlyAuthError(err);
      if (msg === '__need_password__') {
        this._setState('need-password');
        return { ok: true, next: 'password' };
      }
      if (/CODE_EXPIRED/i.test(err.errorMessage || '')) {
        this._setState('need-phone');
        return { ok: false, error: 'انتهت صلاحية الرمز. أعد إرسال الرمز من جديد.', backTo: 'phone' };
      }
      return { ok: false, error: msg };
    }
  }

  async signInWithPassword(password) {
    const client = await this._ensureClient();
    try {
      const pwd = await client.invoke(new Api.account.GetPassword());
      const check = await computeCheck(pwd, password);
      const result = await client.invoke(new Api.auth.CheckPassword({ password: check }));
      return this._afterLogin(result.user);
    } catch (err) {
      return { ok: false, error: this._friendlyAuthError(err) };
    }
  }

  async _afterLogin(user) {
    this.me = user || (await this.client.getMe());
    this._cachePeer(this.me);
    this._save({ session: this.client.session.save() });
    this._setState('authorized');
    return { ok: true, next: 'done', user: this.getMeSummary() };
  }

  _friendlyAuthError(err) {
    const code = (err.errorMessage || err.message || String(err)).toUpperCase();
    if (code.includes('SESSION_PASSWORD_NEEDED')) return '__need_password__';
    if (code.includes('PHONE_CODE_INVALID') || code.includes('PHONE_CODE_EMPTY')) return 'الرمز غير صحيح، تحقق منه وحاول مجدداً.';
    if (code.includes('PHONE_CODE_EXPIRED')) return 'انتهت صلاحية الرمز.';
    if (code.includes('PHONE_NUMBER_INVALID')) return 'رقم الهاتف غير صالح.';
    if (code.includes('PHONE_NUMBER_BANNED')) return 'هذا الرقم محظور من تلكرام.';
    if (code.includes('FLOOD_WAIT')) return 'انتظر قليلاً قبل إعادة المحاولة (حماية من التكرار).';
    if (code.includes('PASSWORD_HASH_INVALID')) return 'كلمة المرور غير صحيحة.';
    if (code.includes('API_ID_INVALID') || code.includes('API_HASH_INVALID')) return 'مفتاح API غير صحيح. تحقق من apiId و apiHash.';
    if (code.includes('NETWORK')) return 'تعذر الاتصال بالشبكة. تحقق من الإنترنت.';
    return err.errorMessage || err.message || 'حدث خطأ غير متوقع.';
  }

  // ---------- الكيانات ----------
  _peerKey(entity) {
    if (entity instanceof Api.User) return `user:${entity.id}`;
    if (entity instanceof Api.Channel) return `channel:${entity.id}`;
    if (entity instanceof Api.Chat) return `chat:${entity.id}`;
    return null;
  }

  _peerKeyFromApiPeer(peer) {
    if (peer instanceof Api.PeerUser) return `user:${peer.userId}`;
    if (peer instanceof Api.PeerChannel) return `channel:${peer.channelId}`;
    if (peer instanceof Api.PeerChat) return `chat:${peer.chatId}`;
    return null;
  }

  _cachePeer(entity) {
    const key = this._peerKey(entity);
    if (key) this.peerCache.set(key, entity);
    return key;
  }

  async _resolvePeer(peerKey) {
    const cached = this.peerCache.get(peerKey);
    if (cached) return this.client.getInputEntity(cached);
    // محاولة أخيرة عبر معرّف بسيط
    const [type, rawId] = String(peerKey).split(':');
    const id = BigInt(rawId);
    const peer =
      type === 'user' ? new Api.PeerUser({ userId: id }) :
      type === 'channel' ? new Api.PeerChannel({ channelId: id }) :
      new Api.PeerChat({ chatId: id });
    return this.client.getInputEntity(peer);
  }

  _entitySummary(entity) {
    const key = this._cachePeer(entity) || 'unknown';
    const isUser = entity instanceof Api.User;
    const isChannel = entity instanceof Api.Channel;
    const isChat = entity instanceof Api.Chat;

    let name = '';
    if (isUser) {
      name = [entity.firstName, entity.lastName].filter(Boolean).join(' ') || 'مستخدم بدون اسم';
    } else {
      name = entity.title || 'مجموعة';
    }

    let username = entity.username || null;
    let kind = isUser ? (entity.self ? 'self' : 'user') : isChannel ? (entity.broadcast ? 'channel' : 'group') : 'group';

    return {
      key,
      kind,
      name,
      username,
      initials: this._initials(name),
      color: pickColor(key),
      isBot: isUser && Boolean(entity.bot),
      isSelf: isUser && Boolean(entity.self),
    };
  }

  _userSummary(user) {
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'مستخدم';
    return {
      key: this._peerKey(user),
      name,
      username: user.username || null,
      initials: this._initials(name),
      color: pickColor(String(user.id)),
      phone: user.phone || null,
    };
  }

  _initials(name) {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  // ---------- المحادثات ----------
  async getDialogs() {
    const client = await this._ensureClient();
    if (!(await client.isUserAuthorized())) throw new Error('غير مسجّل الدخول.');
    const dialogs = await client.getDialogs({ limit: 200 });
    const out = [];
    for (const d of dialogs) {
      if (!d.entity) continue;
      const info = this._entitySummary(d.entity);
      const last = d.message;
      out.push({
        ...info,
        lastMessage: last ? this._previewText(last) : '',
        lastMessageOut: last ? Boolean(last.out) : false,
        lastDate: last && last.date ? Number(last.date) * 1000 : null,
        unread: d.unreadCount || 0,
        pinned: Boolean(d.pinned),
        muted: Boolean(d.muted),
      });
    }
    return out;
  }

  _previewText(msg) {
    if (!msg) return '';
    if (msg.message) return msg.message.replace(/\s+/g, ' ').slice(0, 120);
    const m = msg.media;
    if (!m) return '';
    if (m instanceof Api.MessageMediaPhoto) return '📷 صورة';
    if (m instanceof Api.MessageMediaDocument) {
      const mime = (m.document && m.document.mimeType) || '';
      if (/webp/.test(mime)) return '🖼️ ملصق';
      if (/ogg|opus/.test(mime)) return '🎤 رسالة صوتية';
      if (/mp4|video/.test(mime)) return '🎬 فيديو';
      return '📎 ملف';
    }
    if (m instanceof Api.MessageMediaWebPage) return '🔗 رابط';
    if (m instanceof Api.MessageMediaContact) return '👤 جهات اتصال';
    if (m instanceof Api.MessageMediaGeo || m instanceof Api.MessageMediaGeoLive) return '📍 موقع';
    if (m instanceof Api.MessageMediaPoll) return '📊 استطلاع';
    return 'رسالة';
  }

  // ---------- الرسائل ----------
  _senderInfo(msg) {
    const sid = msg.senderId;
    if (sid === null || sid === undefined) return null;
    const key = `user:${sid}`;
    const cached = this.peerCache.get(key);
    if (cached) return this._entitySummary(cached);
    const selfId = this.me ? String(this.me.id) : null;
    if (selfId && String(sid) === selfId) return this._userSummary(this.me);
    return { key, name: null, initials: '?', color: pickColor(key) };
  }

  _serializeMessage(msg, sender) {
    const media = this._classifyMedia(msg);
    const replyTo =
      msg.replyTo && msg.replyTo instanceof Api.MessageReplyHeader ? msg.replyTo.replyToMsgId || null : null;
    return {
      id: msg.id,
      text: msg.message || '',
      out: Boolean(msg.out),
      date: msg.date ? Number(msg.date) * 1000 : Date.now(),
      edited: msg.editDate ? Number(msg.editDate) * 1000 : null,
      sender: sender
        ? { key: sender.key, name: sender.name, initials: sender.initials, color: sender.color }
        : null,
      media,
      replyToId: replyTo,
      reactions: this._serializeReactions(msg.reactions),
      grouped: Boolean(msg.groupedId),
    };
  }

  // تحويل تفاعلات الرسالة إلى بيانات بسيطة (إيماءة + عدد + هل هي لي؟)
  _serializeReactions(reactions) {
    if (!reactions || !reactions.results || !reactions.results.length) return [];
    const out = [];
    for (const rc of reactions.results) {
      const r = rc.reaction;
      if (r instanceof Api.ReactionEmoji) {
        out.push({
          emoticon: r.emoticon,
          count: rc.count || 0,
          chosen: rc.chosenOrder !== null && rc.chosenOrder !== undefined,
        });
      }
    }
    return out;
  }

  _classifyMedia(msg) {
    const m = msg.media;
    if (!m || m instanceof Api.MessageMediaEmpty) return null;
    if (m instanceof Api.MessageMediaPhoto) return { type: 'photo' };
    if (m instanceof Api.MessageMediaDocument) {
      const doc = m.document;
      const mime = (doc && doc.mimeType) || '';
      if (/webp/.test(mime)) return { type: 'sticker' };
      if (/ogg|opus/.test(mime)) return { type: 'voice' };
      if (/mp4|video|quicktime/.test(mime)) return { type: 'video' };
      if (/audio/.test(mime)) return { type: 'audio' };
      return { type: 'file', name: doc && doc.attributes ? this._docName(doc) : 'ملف', size: doc ? doc.size : 0 };
    }
    if (m instanceof Api.MessageMediaWebPage) {
      const web = m.webpage;
      if (web instanceof Api.WebPage) {
        return {
          type: 'link',
          site: web.siteName || null,
          title: web.title || null,
          description: web.description ? String(web.description).slice(0, 160) : null,
          url: web.url || null,
        };
      }
      return { type: 'link' };
    }
    if (m instanceof Api.MessageMediaContact) {
      const c = m;
      return { type: 'contact', name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.phoneNumber };
    }
    if (m instanceof Api.MessageMediaGeo || m instanceof Api.MessageMediaGeoLive) return { type: 'geo' };
    if (m instanceof Api.MessageMediaPoll) return { type: 'poll', question: m.poll && m.poll.question };
    return { type: 'other' };
  }

  _docName(doc) {
    const attrs = doc.attributes || [];
    for (const a of attrs) {
      if (a instanceof Api.DocumentAttributeFilename) return a.fileName;
      if (a instanceof Api.DocumentAttributeAudio && a.title) return a.title;
    }
    return 'ملف';
  }

  async _loadSenderEntities(msgs) {
    const needed = new Set();
    for (const m of msgs) {
      if (m.senderId === null || m.senderId === undefined) continue;
      const key = `user:${m.senderId}`;
      if (!this.peerCache.has(key) && !this._isSelf(m.senderId)) needed.add(String(m.senderId));
    }
    if (needed.size) {
      try {
        const users = await this.client.getEntities([...needed].map((id) => new Api.PeerUser({ userId: BigInt(id) })));
        for (const u of users) if (u) this._cachePeer(u);
      } catch { /* تجاهل — سنعرض أسماء غير معروفة */ }
    }
  }

  _isSelf(id) {
    return this.me ? String(this.me.id) === String(id) : false;
  }

  async getChatHistory(peerKey, offsetId = 0) {
    const client = await this._ensureClient();
    const input = await this._resolvePeer(peerKey);
    const msgs = await client.getMessages(input, { limit: 50, ...(offsetId ? { offsetId } : {}) });
    await this._loadSenderEntities(msgs);
    const out = [];
    for (const m of msgs) {
      const sender = this._senderInfo(m);
      out.push(this._serializeMessage(m, sender));
    }
    out.reverse(); // من الأقدم إلى الأحدث
    return { peerKey, messages: out, hasMore: msgs.length === 50 };
  }

  async sendMessage(peerKey, text, replyTo = 0) {
    const client = await this._ensureClient();
    const input = await this._resolvePeer(peerKey);
    // parseMode: false → إرسال النص كما هو دون تفسير رموز التنسيق
    const sent = await client.sendMessage(input, {
      message: text,
      parseMode: false,
      ...(replyTo ? { replyTo } : {}),
    });
    const sender = this._senderInfo(sent);
    return this._serializeMessage(sent, sender);
  }

  // إرسال ملف أو صورة من مسار محلي على الجهاز
  async sendFile(peerKey, filePath, caption = '') {
    const client = await this._ensureClient();
    if (!fs.existsSync(filePath)) throw new Error('الملف غير موجود: ' + filePath);
    const input = await this._resolvePeer(peerKey);
    const sent = await client.sendFile(input, {
      file: filePath,
      caption: caption || '',
      parseMode: false,
    });
    const sender = this._senderInfo(sent);
    return this._serializeMessage(sent, sender);
  }

  // تعديل رسالة سابقة (للرسائل التي أرسلتها أنت فقط)
  async editMessage(peerKey, msgId, newText) {
    const client = await this._ensureClient();
    const input = await this._resolvePeer(peerKey);
    const edited = await client.editMessage(input, {
      message: msgId,
      text: newText,
      parseMode: false,
    });
    if (!edited) return null;
    const sender = this._senderInfo(edited);
    return this._serializeMessage(edited, sender);
  }

  // حذف رسالة (revoke = حذف للطرفين)
  async deleteMessage(peerKey, msgId) {
    const client = await this._ensureClient();
    const input = await this._resolvePeer(peerKey);
    await client.deleteMessages(input, [msgId], { revoke: true });
    return { ok: true };
  }

  // إرسال مؤشر «يكتب…» للطرف الآخر
  async setTyping(peerKey) {
    const client = await this._ensureClient();
    const input = await this._resolvePeer(peerKey);
    await client.setTyping(input, 'typing');
  }

  // قائمة الإيماءات المتاحة (تُجلب مرة واحدة وتُخزَّن)
  async getAvailableReactions() {
    if (this._availableReactions) return this._availableReactions;
    const client = await this._ensureClient();
    const res = await client.invoke(new Api.messages.GetAvailableReactions({ hash: 0 }));
    const list = [];
    for (const a of res.reactions || res.results || []) {
      if (a.reaction instanceof Api.ReactionEmoji) {
        list.push({ emoticon: a.reaction.emoticon, title: a.title || '' });
      }
    }
    this._availableReactions = list.slice(0, 14);
    return this._availableReactions;
  }

  // إضافة/إزالة إيماءة — المرسَل القائمة الكاملة لإيماءاتي على الرسالة
  async sendReaction(peerKey, msgId, myEmoticons) {
    const client = await this._ensureClient();
    const input = await this._resolvePeer(peerKey);
    const reactions = (myEmoticons || []).map(
      (e) => new Api.ReactionEmoji({ emoticon: e })
    );
    await client.sendReaction(input, msgId, reactions, undefined, true);
    return { ok: true };
  }

  // إعادة توجيه رسالة إلى محادثة أخرى
  async forwardMessages(toPeerKey, fromPeerKey, msgIds) {
    const client = await this._ensureClient();
    const toInput = await this._resolvePeer(toPeerKey);
    const fromInput = await this._resolvePeer(fromPeerKey);
    const sent = await client.forwardMessages(toInput, {
      messages: msgIds.map(Number),
      fromPeer: fromInput,
    });
    return (sent || []).filter(Boolean).map((m) => this._serializeMessage(m, this._senderInfo(m)));
  }

  // بحث عالمي في كل الرسائل
  async globalSearch(query) {
    const client = await this._ensureClient();
    const res = await client.invoke(
      new Api.messages.SearchGlobal({
        q: query,
        offsetRate: 0,
        offsetPeer: new Api.InputPeerEmpty(),
        offsetId: 0,
        limit: 30,
      })
    );

    // تخزين الكيانات لأسماء المحادثات
    const entities = [...(res.users || []), ...(res.chats || [])];
    const byKey = new Map();
    for (const e of entities) {
      const k = this._peerKey(e);
      if (k) {
        this.peerCache.set(k, e);
        byKey.set(k, e);
      }
    }

    const out = [];
    for (const m of res.messages || []) {
      if (!m || !(m instanceof Api.Message) || !m.message) continue;
      const peerKey = this._peerKeyFromApiPeer(m.peerId);
      if (!peerKey) continue;
      const ent = byKey.get(peerKey);
      const info = ent ? this._entitySummary(ent) : { key: peerKey, name: 'محادثة', initials: '؟', color: '#5288c1' };
      out.push({
        peerKey,
        chatName: info.name,
        chatColor: info.color,
        chatInitials: info.initials,
        text: m.message.replace(/\s+/g, ' ').slice(0, 160),
        date: m.date ? Number(m.date) * 1000 : null,
        msgId: m.id,
      });
      if (out.length >= 25) break;
    }
    return out;
  }

  // بحث داخل محادثة محددة
  async searchInChat(peerKey, query) {
    const client = await this._ensureClient();
    const input = await this._resolvePeer(peerKey);
    const msgs = await client.getMessages(input, { search: query, limit: 50 });
    await this._loadSenderEntities(msgs);
    return msgs
      .filter((m) => m instanceof Api.Message)
      .map((m) => this._serializeMessage(m, this._senderInfo(m)));
  }

  // جلب نافذة رسائل حول معرّف معيّن (للانتقال إلى نتيجة بحث خارج السجل المحمل)
  async getMessagesAround(peerKey, msgId) {
    const client = await this._ensureClient();
    const input = await this._resolvePeer(peerKey);
    const msgs = await client.getMessages(input, { limit: 40, offsetId: Number(msgId) + 20 });
    await this._loadSenderEntities(msgs);
    const out = msgs
      .filter((m) => m instanceof Api.Message)
      .map((m) => this._serializeMessage(m, this._senderInfo(m)));
    out.reverse(); // من الأقدم إلى الأحدث
    return { messages: out, hasMore: msgs.length === 40 };
  }

  // ---------------- الملصقات ----------------

  // الملصقات الأخيرة (تُجلب مرة واحدة وتُخزَّن في الذاكرة)
  async getStickers() {
    if (this._stickersList) return this._stickersList;
    const client = await this._ensureClient();
    const res = await client.invoke(new Api.messages.GetRecentStickers({ attached: false, hash: 0 }));
    const docs = res.stickers || [];
    const list = [];
    for (const doc of docs) {
      if (!(doc instanceof Api.Document)) continue;
      const key = `st:${doc.id}`;
      this._stickerCache.set(key, doc);
      list.push({
        key,
        emoji: this._stickerEmoji(doc),
        thumb: this._stickerThumbDataUrl(doc),
      });
    }
    this._stickersList = list;
    return list;
  }

  _stickerEmoji(doc) {
    for (const a of doc.attributes || []) {
      if (a instanceof Api.DocumentAttributeSticker && a.alt) return a.alt;
    }
    return '🏷️';
  }

  // مصغّر اللوحة من البايتات المضمّنة في الوثيقة (دون تنزيل)
  _stickerThumbDataUrl(doc) {
    const thumbs = doc.thumbs || [];
    let best = null;
    for (const t of thumbs) {
      if (t instanceof Api.PhotoCachedSize && t.bytes && t.bytes.length) {
        best = { bytes: t.bytes, mime: 'image/jpeg' };
        break; // الأفضل جودة
      }
      if (!best && t instanceof Api.PhotoStrippedSize && t.bytes && t.bytes.length) {
        best = { bytes: t.bytes, mime: 'image/png' };
      }
    }
    if (!best) return null;
    return `data:${best.mime};base64,${Buffer.from(best.bytes).toString('base64')}`;
  }

  // إرسال ملصق (إعادة إرسال الوثيقة من خوادم تلكرام دون رفع)
  async sendSticker(peerKey, stickerKey) {
    const doc = this._stickerCache.get(String(stickerKey));
    if (!doc) throw new Error('الملصق غير متاح — أعد فتح لوحة الملصقات.');
    const client = await this._ensureClient();
    const input = await this._resolvePeer(peerKey);
    const sent = await client.sendFile(input, { file: doc, parseMode: false });
    return this._serializeMessage(sent, this._senderInfo(sent));
  }

  // ---------------- الرد التلقائي (وضع التوفر) ----------------

  getAutoReply() {
    const ar = this.cfg.autoReply;
    if (ar && typeof ar === 'object') {
      return { enabled: Boolean(ar.enabled), message: String(ar.message || '') };
    }
    return { enabled: false, message: '' };
  }

  setAutoReply({ enabled, message }) {
    this._save({
      autoReply: { enabled: Boolean(enabled), message: String(message || '').slice(0, 500) },
    });
    return this.getAutoReply();
  }

  // يرد مرة واحدة كل 30 دقيقة لكل محادثة (يمنع الإزعاج)
  async _maybeAutoReply(peerKey, msg) {
    try {
      const ar = this.cfg.autoReply;
      if (!ar || !ar.enabled || !ar.message) return;
      if (msg.out || this.state !== 'authorized') return;
      const now = Date.now();
      const last = this._autoReplyAt.get(peerKey) || 0;
      if (now - last < 30 * 60 * 1000) return;
      this._autoReplyAt.set(peerKey, now);
      const input = await this._resolvePeer(peerKey);
      await this.client.sendMessage(input, { message: ar.message, parseMode: false });
      this.emit('update', { kind: 'auto-replied', peerKey });
    } catch {
      /* صامت: قد تفشل المحاولة في القنوات التي لا تسمح بالكتابة */
    }
  }

  async getMediaPath(peerKey, msgId) {
    const client = await this._ensureClient();
    const input = await this._resolvePeer(peerKey);
    const [msg] = await client.getMessages(input, { ids: [msgId] });
    if (!msg || !msg.media) return null;

    fs.mkdirSync(this.mediaDir, { recursive: true });
    const safeKey = String(peerKey).replace(/[^a-zA-Z0-9_-]/g, '_');

    // امتداد الملف حسب نوعه الفعلي (صورة/ملصق/فيديو)
    let ext = 'jpg';
    const m = msg.media;
    if (m instanceof Api.MessageMediaDocument && m.document) {
      const mime = m.document.mimeType || '';
      if (mime.includes('webp')) ext = 'webp';
      else if (mime.includes('png')) ext = 'png';
      else if (mime.includes('gif')) ext = 'gif';
      else if (mime.includes('mp4')) ext = 'mp4';
      else if (mime.includes('webm')) ext = 'webm';
    }

    const outFile = path.join(this.mediaDir, `${safeKey}_${msgId}.${ext}`);
    if (fs.existsSync(outFile)) return outFile;

    const file = await client.downloadMedia(msg, outFile);
    return file || null;
  }

  // ---------- التحديثات اللحظية ----------
  async _onNewMessage(event) {
    try {
      const msg = event.message;
      // تجاهل رسائل الخدمة (انضمام، تغيير اسم...) — نعالج الرسائل العادية فقط
      if (!msg || !(msg instanceof Api.Message)) return;
      const peerKey = this._peerKeyFromApiPeer(msg.peerId) || (msg.out && this.me ? this._peerKey(this.me) : null);
      if (!peerKey) return;

      // تأكد أن الكيان موجود في الذاكرة لعرض الاسم
      let chatInfo = null;
      const cached = this.peerCache.get(peerKey);
      if (cached) {
        chatInfo = this._entitySummary(cached);
      } else {
        try {
          const ent = await this.client.getEntity(msg.peerId);
          if (ent) chatInfo = this._entitySummary(ent);
        } catch {}
      }

      const sender = this._senderInfo(msg);
      const payload = {
        kind: 'new-message',
        peerKey,
        chat: chatInfo,
        message: this._serializeMessage(msg, sender),
      };

      if (!msg.out && this.state === 'authorized') {
        try {
          await this.client.markAsRead(msg.peerId, msg.id);
        } catch {}
        payload.readByApp = true;
      }

      this.emit('update', payload);

      // الرد التلقائي (وضع التوفر) عند وصول رسالة جديدة
      if (!msg.out) this._maybeAutoReply(peerKey, msg);
    } catch (err) {
      console.error('خطأ في معالجة رسالة جديدة:', err);
    }
  }

  // رسالة عُدّلت (من هذا الجهاز أو من أجهزة أخرى)
  async _onEditedMessage(event) {
    try {
      const msg = event.message;
      if (!msg) return;
      const peerKey = this._peerKeyFromApiPeer(msg.peerId);
      if (!peerKey) return;
      const sender = this._senderInfo(msg);
      this.emit('update', {
        kind: 'edited',
        peerKey,
        message: this._serializeMessage(msg, sender),
      });
    } catch (err) {
      console.error('خطأ في معالجة تعديل رسالة:', err);
    }
  }

  // رسالة حُذفت
  async _onDeletedMessage(event) {
    try {
      const chat = event.chat;
      const peerKey = chat ? this._peerKey(chat) : null;
      const msgId = event.deletedId;
      if (!peerKey || !msgId) return;
      this.emit('update', { kind: 'deleted', peerKey, msgId });
    } catch (err) {
      console.error('خطأ في معالجة حذف رسالة:', err);
    }
  }

  // مؤشر الكتابة وأنشاط المحادثة (typing…)
  async _onChatAction(event) {
    try {
      const u = event.originalUpdate;
      if (!u || !u.action) return;

      let peerKey = null;
      let userId = null;
      if (u instanceof Api.UpdateUserTyping) {
        peerKey = `user:${u.userId}`;
        userId = u.userId;
      } else if (u instanceof Api.UpdateChatUserTyping) {
        peerKey = `chat:${u.chatId}`;
        userId = u.userId;
      } else if (u instanceof Api.UpdateChannelUserTyping) {
        peerKey = `channel:${u.channelId}`;
        userId = u.userId;
      }
      if (!peerKey) return;

      const cls = u.action.className || '';
      // إيقاف المؤشر
      const stopped = /Cancel/.test(cls);
      // تصنيف الحالة
      let action = 'text';
      if (/RecordAudio/.test(cls)) action = 'voice';
      else if (/RecordVideo/.test(cls)) action = 'video-note';
      else if (/UploadAudio/.test(cls)) action = 'voice';
      else if (/UploadVideo/.test(cls)) action = 'video';
      else if (/UploadPhoto/.test(cls)) action = 'photo';
      else if (/UploadDocument/.test(cls)) action = 'file';
      else if (/ChooseSticker/.test(cls)) action = 'sticker';

      this.emit('update', {
        kind: 'typing',
        peerKey,
        userId: String(userId),
        typing: !stopped,
        action,
      });
    } catch (err) {
      console.error('خطأ في معالجة مؤشر الكتابة:', err);
    }
  }
}

module.exports = TelegramService;
