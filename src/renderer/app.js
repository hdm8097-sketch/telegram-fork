'use strict';
/* ============================================================
   تليجرام فورك — منطق الواجهة (Renderer)
   يعمل في Electron (file:) وفي المتصفح عبر الويب (http/https)
   ============================================================ */

// وضع الويب: يُحمَّل من خادم (GitHub Pages) بدل ملف محلي
const WEB = location.protocol !== 'file:';

const $ = (id) => document.getElementById(id);

const state = {
  dialogs: [],          // كل المحادثات المحملة
  filter: '',           // نص البحث
  activePeer: null,     // المحادثة المفتوحة
  messages: [],         // رسائل المحادثة المفتوحة
  msgIds: new Set(),    // لمزالة التكرار
  hasMore: false,
  loadingOlder: false,
  sending: false,
  showSenderNames: false,
  replyTo: null,        // رسالة مختارة للرد {id, text, name, color}
  editing: null,        // رسالة قيد التعديل {id}
  forwarding: null,     // وضع إعادة التوجيه {fromPeer, msgIds, preview}
  pendingFile: null,    // ملف مختار للإرسال {path, name}
  reactionsList: null,  // الإيماءات المتاحة (تُجلب مرة واحدة)
  searchResults: null,  // نتائج البحث العالمي في الرسائل
  typing: {},           // peerKey -> { until, action }
  activeSubtitle: '',   // نص وصف المحادثة الأصلي (لإعادته عند اختفاء الكتابة)
};

/* ---------------- أدوات عامة ---------------- */

function show(screenId) {
  const boot = $('boot');
  if (boot) boot.remove();
  for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
  $(screenId).classList.remove('hidden');
}

let toastTimer = null;
function toast(text, isError = false) {
  const el = $('toast');
  el.textContent = text;
  el.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}

function setLoading(btn, loading, labelWhenDone) {
  if (loading) {
    btn.dataset.label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'جارٍ الانتظار…';
  } else {
    btn.disabled = false;
    btn.textContent = labelWhenDone || btn.dataset.label || btn.textContent;
  }
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// تحويل الروابط في النص إلى عناصر قابلة للنقر (بعد الترميز أولاً)
function linkify(text) {
  let out = esc(text);
  out = out.replace(
    /(https?:\/\/[^\s<>&quot;]+)/g,
    '<a href="#" data-url="$1">$1</a>'
  );
  return out;
}

function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function fmtDialogTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return fmtTime(ts);
  const diff = now - d;
  if (diff < 7 * 86400000) {
    return d.toLocaleDateString('ar', { weekday: 'long' });
  }
  return d.toLocaleDateString('ar', { day: 'numeric', month: 'numeric', year: '2-digit' });
}

function fmtDaySeparator(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'اليوم';
  const yesterday = new Date(now.getTime() - 86400000);
  if (d.toDateString() === yesterday.toDateString()) return 'أمس';
  return d.toLocaleDateString('ar', { day: 'numeric', month: 'long', year: 'numeric' });
}

function avatarHTML(info, size = 'md') {
  const color = info.color || '#5288c1';
  const initials = esc(info.initials || '?');
  return `<div class="avatar avatar-${size}" style="background:${color}">${initials}</div>`;
}

// تحديث صورة رمزية موجودة دون استبدال العنصر (يحافظ على الـ id)
function setAvatar(el, info) {
  if (!el) return;
  el.textContent = info.initials || '?';
  el.style.background = info.color || '#5288c1';
}

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' م.ب';
  if (n >= 1024) return Math.round(n / 1024) + ' ك.ب';
  return n + ' بايت';
}

// مدة بالثواني ← صيغة m:ss (لاتينية لأنها تُقرأ رقمياً)
function fmtDur(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/* ============================================================
   تدفق تسجيل الدخول
   ============================================================ */

async function init() {
  const status = await window.tg.status();
  if (status.authorized && status.user) {
    enterMain(status.user);
  } else if (!status.hasApi) {
    show('screen-api');
  } else {
    show('screen-phone');
  }
}

// — شاشة المفتاح —
$('btn-save-api').addEventListener('click', async () => {
  const apiId = $('api-id').value.trim();
  const apiHash = $('api-hash').value.trim();
  const errEl = $('api-error');
  errEl.classList.add('hidden');

  if (!/^\d+$/.test(apiId) || apiHash.length < 16) {
    errEl.textContent = 'تحقق من صيغة البيانات: رقم المعرّف أرقام فقط والمفتاح 32 حرفاً.';
    errEl.classList.remove('hidden');
    return;
  }

  const btn = $('btn-save-api');
  setLoading(btn, true);
  const res = await window.tg.saveApi(apiId, apiHash);
  setLoading(btn, false);
  if (!res.ok) {
    errEl.textContent = res.error;
    errEl.classList.remove('hidden');
    return;
  }
  show('screen-phone');
  $('phone-input').focus();
});

$('link-mytelegram').addEventListener('click', (e) => {
  e.preventDefault();
  window.tg.openExternal('https://my.telegram.org/apps');
});

$('btn-change-api').addEventListener('click', () => show('screen-api'));

// — شاشة الرقم —
$('btn-send-code').addEventListener('click', async () => {
  const phone = $('phone-input').value.trim();
  const errEl = $('phone-error');
  errEl.classList.add('hidden');

  const btn = $('btn-send-code');
  setLoading(btn, true);
  const res = await window.tg.sendCode(phone);
  setLoading(btn, false, 'إرسال الرمز');

  if (!res.ok) {
    errEl.textContent = res.error;
    errEl.classList.remove('hidden');
    return;
  }
  const delivery = {
    app: 'أُرسل الرمز عبر إشعار في تطبيق تلكرام على هاتفك.',
    sms: 'أُرسل الرمز عبر رسالة نصية (SMS) إلى رقمك.',
    call: 'سنتصل بك قريباً لقراءة رمز التحقق.',
    unknown: 'أُرسل الرمز الآن — تحقق من رسائل تلكرام.',
  };
  $('code-delivery').textContent = delivery[res.delivery] || delivery.unknown;
  show('screen-code');
  $('code-input').value = '';
  $('code-input').focus();
});

// — شاشة الرمز —
async function submitCode() {
  const code = $('code-input').value.trim();
  if (!code) return;
  const errEl = $('code-error');
  errEl.classList.add('hidden');

  const btn = $('btn-sign-in');
  setLoading(btn, true);
  const res = await window.tg.signIn(code);
  setLoading(btn, false, 'تأكيد');

  if (!res.ok) {
    errEl.textContent = res.error;
    errEl.classList.remove('hidden');
    if (res.backTo === 'phone') {
      setTimeout(() => show('screen-phone'), 1800);
    }
    return;
  }
  if (res.next === 'password') {
    show('screen-password');
    $('password-input').value = '';
    $('password-input').focus();
    return;
  }
  // تم الدخول
  enterMain(res.user);
}

$('btn-sign-in').addEventListener('click', submitCode);
$('code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitCode();
});

$('btn-back-phone').addEventListener('click', () => show('screen-phone'));

// — شاشة كلمة المرور —
async function submitPassword() {
  const password = $('password-input').value;
  if (!password) return;
  const errEl = $('password-error');
  errEl.classList.add('hidden');

  const btn = $('btn-password');
  setLoading(btn, true);
  const res = await window.tg.signInPassword(password);
  setLoading(btn, false, 'دخول');

  if (!res.ok) {
    errEl.textContent = res.error;
    errEl.classList.remove('hidden');
    return;
  }
  enterMain(res.user);
}

$('btn-password').addEventListener('click', submitPassword);
$('password-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitPassword();
});

/* ============================================================
   الشاشة الرئيسية
   ============================================================ */

async function enterMain(user) {
  show('screen-main');
  if (user) {
    setAvatar($('me-avatar'), user);
    $('me-name').textContent = user.name;
    $('me-status').textContent = user.username ? '@' + user.username : 'متصل';
  }
  // طلب إذن الإشعارات مرة واحدة
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  } catch {}
  await loadDialogs();
}

$('btn-logout').addEventListener('click', async () => {
  if (!confirm('هل تريد تسجيل الخروج؟ سيُحذف الجلسة من هذا الجهاز.')) return;
  await window.tg.logout();
  state.dialogs = [];
  state.activePeer = null;
  $('dialogs-list').innerHTML = '';
  show('screen-phone');
});

// ---------------- المحادثات ----------------

async function loadDialogs() {
  try {
    state.dialogs = await window.tg.dialogs();
    renderDialogs();
  } catch (err) {
    toast('تعذّر تحميل المحادثات: ' + (err.message || err), true);
  }
}

$('search-input').addEventListener('input', (e) => {
  const q = e.target.value.trim();
  state.filter = q.toLowerCase();
  renderDialogs();

  // بحث عالمي في الرسائل (مؤجل 500 م.ث لتفادي الإفراط في الطلبات)
  clearTimeout(searchTimer);
  if (q.length >= 2) {
    searchTimer = setTimeout(async () => {
      try {
        const res = await window.tg.globalSearch(q);
        // تجاهل النتيجة إن تغيّر النص أثناء الانتظار
        if (state.filter === q.toLowerCase()) {
          state.searchResults = res;
          renderDialogs();
        }
      } catch {
        /* صامت: البحث العالمي اختياري */
      }
    }, 500);
  } else if (state.searchResults) {
    state.searchResults = null;
    renderDialogs();
  }
});

let searchTimer = null;

function dialogMatches(d) {
  if (!state.filter) return true;
  return (
    d.name.toLowerCase().includes(state.filter) ||
    (d.username && d.username.toLowerCase().includes(state.filter)) ||
    (d.lastMessage && d.lastMessage.toLowerCase().includes(state.filter))
  );
}

function renderDialogs() {
  const list = $('dialogs-list');
  const items = state.dialogs.filter(dialogMatches);

  // قسم نتائج البحث العالمي (في كل الرسائل)
  let html = '';
  if (state.searchResults && state.searchResults.length) {
    html += '<div class="search-section">نتائج في الرسائل</div>';
    html += state.searchResults
      .map(
        (r) => `
        <div class="search-result" data-key="${esc(r.peerKey)}">
          <div class="avatar avatar-sm" style="background:${esc(r.chatColor)}">${esc(r.chatInitials)}</div>
          <div class="sr-body">
            <div class="sr-top">
              <span class="sr-name">${esc(r.chatName)}</span>
              <span class="sr-time">${esc(r.date ? fmtDialogTime(r.date) : '')}</span>
            </div>
            <div class="sr-text">${esc(r.text)}</div>
          </div>
        </div>`
      )
      .join('');
    html += '<div class="search-section">المحادثات</div>';
  }

  html += items
    .map((d) => {
      const active = state.activePeer === d.key ? ' active' : '';
      const time = d.lastDate ? fmtDialogTime(d.lastDate) : '';
      const badge = d.unread
        ? `<span class="dialog-badge${d.muted ? ' muted' : ''}">${d.unread > 99 ? '99+' : d.unread}</span>`
        : '';
      const prefix = d.lastMessageOut && d.lastMessage ? '➤ ' : '';
      return `
        <div class="dialog${active}" data-key="${esc(d.key)}">
          ${avatarHTML(d, 'md')}
          <div class="dialog-body">
            <div class="dialog-top">
              <span class="dialog-name">${esc(d.name)}</span>
              <span class="dialog-time">${esc(time)}</span>
            </div>
            <div class="dialog-bottom">
              <span class="dialog-last">${prefix}${esc(d.lastMessage || '')}</span>
              ${badge}
            </div>
          </div>
        </div>`;
    })
    .join('');

  if (!state.dialogs.length) {
    html += '<div class="list-hint">لا توجد محادثات بعد. أرسل رسالة من تلكرام الرسمي لتظهر هنا.</div>';
  } else if (!items.length) {
    html += '<div class="list-hint">لا نتائج مطابقة للبحث.</div>';
  }

  list.innerHTML = html;

  // النقر على نتيجة بحث عالمي → فتح المحادثة
  for (const el of list.querySelectorAll('.search-result')) {
    el.addEventListener('click', () => {
      if (state.forwarding) {
        tryForwardTo(el.dataset.key);
        return;
      }
      openChat(el.dataset.key);
    });
  }

  for (const el of list.querySelectorAll('.dialog')) {
    el.addEventListener('click', async () => {
      // أثناء وضع إعادة التوجيه: الإرسال بدل فتح المحادثة
      if (state.forwarding) {
        await tryForwardTo(el.dataset.key);
        return;
      }
      openChat(el.dataset.key);
    });
  }
}

// ---------------- المحادثة المفتوحة ----------------

async function openChat(peerKey) {
  state.activePeer = peerKey;
  state.messages = [];
  state.msgIds = new Set();
  state.hasMore = false;
  clearContext();
  clearPendingFile();
  cancelRecording();
  closeInChatSearch();
  $('sticker-panel').classList.add('hidden');
  $('msg-input').value = '';
  autosize($('msg-input'));

  const d = state.dialogs.find((x) => x.key === peerKey);
  $('chat-placeholder').classList.add('hidden');
  $('chat-view').classList.remove('hidden');
  if (d) {
    setAvatar($('chat-avatar'), d);
    $('chat-title').textContent = d.name;
    state.activeSubtitle = d.username ? '@' + d.username : kindLabel(d.kind);
    // أسماء المرسلين تُعرض في المجموعات والقنوات فقط
    state.showSenderNames = d.kind === 'group' || d.kind === 'channel';
  } else {
    state.activeSubtitle = '';
    state.showSenderNames = false;
  }
  updateChatSubtitle();

  $('messages').innerHTML = '<div class="day-sep">جارٍ التحميل…</div>';
  renderDialogs();

  try {
    const res = await window.tg.openChat(peerKey);
    if (state.activePeer !== peerKey) return; // تغيّرت المحادثة أثناء التحميل
    $('messages').innerHTML = '';
    state.messages = res.messages;
    state.hasMore = res.hasMore;
    for (const m of res.messages) state.msgIds.add(m.id);
    renderMessages();
    scrollBottom();
    $('msg-input').focus();
  } catch (err) {
    $('messages').innerHTML = '';
    toast('تعذّر فتح المحادثة: ' + (err.message || err), true);
  }
}

function kindLabel(kind) {
  return {
    user: 'مستخدم',
    self: 'المحادثة مع نفسك (المحفوظة)',
    channel: 'قناة',
    group: 'مجموعة',
  }[kind] || '';
}

function scrollBottom() {
  const el = $('messages');
  el.scrollTop = el.scrollHeight;
}

// صندوق وسيط كسول التحميل (صوت/فيديو) — يُنزَّل عند الظهور فقط
function mediaBox(kind, label, msg, cls = '') {
  const media = msg.media || {};
  const dur = media.duration ? ` data-dur="${media.duration}"` : '';
  const durTxt = media.duration ? ` · <span dir="ltr">${fmtDur(media.duration)}</span>` : '';
  return `<div class="msg-media media-box ${cls}" data-kind="${kind}" data-peer="${esc(msg.peerKey || state.activePeer)}" data-msg="${msg.id}"${dur}>
    <div class="media-placeholder">${label}${durTxt}</div>
  </div>`;
}

function mediaHTML(m, msg) {
  if (!m) return '';
  switch (m.type) {
    case 'photo':
    case 'gif':
      return `<div class="msg-media"><img loading="lazy" data-peer="${esc(msg.peerKey || state.activePeer)}" data-msg="${msg.id}" alt="صورة" /></div>`;
    case 'sticker':
      return `<div class="msg-media sticker-media"><img class="sticker-img" loading="lazy" data-peer="${esc(msg.peerKey || state.activePeer)}" data-msg="${msg.id}" alt="ملصق" /></div>`;
    case 'voice':
      return mediaBox('audio', '🎤 رسالة صوتية', msg);
    case 'video':
      return mediaBox('video', '🎬 فيديو', msg);
    case 'video-note':
      return mediaBox('video', '⏺ مقطع دائري', msg, 'round');
    case 'audio':
      return mediaBox('audio', '🎵 ' + esc(m.name || 'ملف صوتي'), msg);
    case 'file':
      return `<div class="msg-media"><div class="media-placeholder">📎 ${esc(m.name || 'ملف')}${m.size ? ' · ' + fmtSize(m.size) : ''}</div></div>`;
    case 'contact':
      return `<div class="msg-media"><div class="media-placeholder">👤 ${esc(m.name || 'جهة اتصال')}</div></div>`;
    case 'geo':
      return `<div class="msg-media"><div class="media-placeholder">📍 موقع على الخريطة</div></div>`;
    case 'poll':
      return `<div class="msg-media"><div class="media-placeholder">📊 ${esc(m.question || 'استطلاع')}</div></div>`;
    case 'link':
      if (m.site || m.title) {
        return `<div class="msg-link-card">
          ${m.site ? `<div class="msg-link-site">${esc(m.site)}</div>` : ''}
          ${m.title ? `<div class="msg-link-title">${esc(m.title)}</div>` : ''}
          ${m.description ? `<div class="msg-link-desc">${esc(m.description)}</div>` : ''}
        </div>`;
      }
      return '';
    default:
      return '';
  }
}

function replyQuoteHTML(msg) {
  const orig = msg.replyToId ? state.messages.find((x) => x.id === msg.replyToId) : null;
  if (!orig) {
    return `<div class="msg-reply" data-goto="${msg.replyToId || 0}">
      <div class="msg-reply-line" style="background:#5288c1"></div>
      <div>
        <div class="msg-reply-name">رسالة</div>
        <div class="msg-reply-text">رسالة غير متوفرة</div>
      </div>
    </div>`;
  }
  const name = orig.out ? 'أنت' : orig.sender?.name || 'رسالة';
  const color = orig.out ? '#6ab3f3' : orig.sender?.color || '#5288c1';
  const preview = (orig.text || previewFromMedia(orig.media) || '').slice(0, 120);
  return `<div class="msg-reply" data-goto="${orig.id}">
    <div class="msg-reply-line" style="background:${esc(color)}"></div>
    <div>
      <div class="msg-reply-name" style="color:${esc(color)}">${esc(name)}</div>
      <div class="msg-reply-text">${esc(preview)}</div>
    </div>
  </div>`;
}

function messageHTML(m, prev) {
  // فاصل الأيام
  let sep = '';
  if (!prev || new Date(m.date).toDateString() !== new Date(prev.date).toDateString()) {
    sep = `<div class="day-sep">${esc(fmtDaySeparator(m.date))}</div>`;
  }

  const out = m.out ? ' out' : '';
  const senderHtml =
    !m.out && m.sender && m.sender.name && state.showSenderNames
      ? `<div class="msg-sender" style="color:${esc(m.sender.color)}">${esc(m.sender.name)}</div>`
      : '';

  const replyHtml = m.replyToId ? replyQuoteHTML(m) : '';
  const text = m.text ? `<div class="msg-text">${linkify(m.text)}</div>` : '';
  const media = mediaHTML(m.media, m);
  const edited = m.edited ? '<span class="msg-edited"> (معدّل)</span>' : '';
  const ticks = m.out ? '<span class="msg-ticks">✓✓</span>' : '';
  const reactionsHtml = reactionsHTML(m);

  return `${sep}
    <div class="msg-row${out}" data-id="${m.id}">
      <div class="msg">
        <button class="msg-menu-btn" data-id="${m.id}" title="خيارات">⋯</button>
        ${senderHtml}
        ${replyHtml}
        ${media}
        ${text}
        <div class="msg-meta">
          ${edited}
          <span class="msg-time">${esc(fmtTime(m.date))}</span>
          ${ticks}
        </div>
        ${reactionsHtml}
      </div>
    </div>`;
}

function reactionsHTML(m) {
  if (!m.reactions || !m.reactions.length) return '';
  const chips = m.reactions
    .map(
      (r) => `
      <button class="reaction-chip${r.chosen ? ' chosen' : ''}" data-id="${m.id}" data-emoji="${esc(r.emoticon)}">
        <span class="reaction-emoji">${esc(r.emoticon)}</span>
        <span class="reaction-count">${r.count}</span>
      </button>`
    )
    .join('');
  return `<div class="msg-reactions">${chips}</div>`;
}

function renderMessages() {
  const el = $('messages');
  let html = '';
  if (state.hasMore) {
    html += `<button id="btn-older" class="load-older">تحميل رسائل أقدم</button>`;
  }
  for (let i = 0; i < state.messages.length; i++) {
    html += messageHTML(state.messages[i], state.messages[i - 1]);
  }
  el.innerHTML = html;

  const older = $('btn-older');
  if (older) older.addEventListener('click', loadOlder);

  loadVisiblePhotos();
  loadVisibleMedia();
}

async function loadOlder() {
  if (state.loadingOlder || !state.hasMore) return;
  state.loadingOlder = true;
  const btn = $('btn-older');
  if (btn) btn.disabled = true;
  try {
    const oldest = state.messages[0];
    const res = await window.tg.moreMessages(state.activePeer, oldest ? oldest.id : 0);
    const fresh = res.messages.filter((m) => !state.msgIds.has(m.id));
    for (const m of fresh) state.msgIds.add(m.id);
    state.messages = [...fresh, ...state.messages];
    state.hasMore = res.hasMore && fresh.length > 0;
    const el = $('messages');
    const keepHeight = el.scrollHeight - el.scrollTop;
    renderMessages();
    el.scrollTop = el.scrollHeight - keepHeight;
  } catch (err) {
    toast('تعذّر تحميل الرسائل الأقدم', true);
  } finally {
    state.loadingOlder = false;
  }
}

// تحميل الصور الظاهرة فقط ( كسول )
function loadVisiblePhotos() {
  const imgs = $('messages').querySelectorAll('img[data-msg]:not([src])');
  for (const img of imgs) {
    const peer = img.dataset.peer;
    const msgId = Number(img.dataset.msg);
    img.addEventListener('error', () => {
      img.replaceWith(Object.assign(document.createElement('div'), {
        className: 'media-placeholder',
        textContent: '📷 تعذّر تحميل الصورة',
      }));
    }, { once: true });
    window.tg
      .getMedia(peer, msgId)
      .then((file) => {
        if (!file || !img.isConnected) return;
        const u = String(file);
        // blob:/data:/http(s) في الويب — أو مسار محلي في Electron
        img.src = /^(blob:|data:|https?:)/i.test(u) ? u : 'file:///' + u.replace(/\\/g, '/');
      })
      .catch(() => {});
  }
}

// تحميل الوسائط الثقيلة (صوت/فيديو) عند اقترابها من الشاشة فقط
let mediaObserver = null;

function loadVisibleMedia() {
  const boxes = $('messages').querySelectorAll('.media-box:not([data-loading])');
  if (!boxes.length) return;
  if (!mediaObserver && typeof IntersectionObserver !== 'undefined') {
    mediaObserver = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          mediaObserver.unobserve(en.target);
          fetchMediaBox(en.target);
        }
      },
      { root: $('messages'), rootMargin: '400px' }
    );
  }
  for (const b of boxes) {
    b.dataset.loading = '1';
    if (mediaObserver) mediaObserver.observe(b);
    else fetchMediaBox(b);
  }
  // شبكة أمان: إن تأخر إشعار المرشّح (صفحة غير مرئية/إطار متجمّد) نحمّل الظاهر يدوياً
  setTimeout(fallbackLoadMedia, 900);
}

function fallbackLoadMedia() {
  const root = $('messages');
  if (!root || !root.getBoundingClientRect) return;
  const rb = root.getBoundingClientRect();
  const list = root.querySelectorAll('.media-box[data-loading]:not([data-fetched])');
  for (const b of list) {
    const r = b.getBoundingClientRect();
    if (r.bottom >= rb.top - 400 && r.top <= rb.bottom + 400) fetchMediaBox(b);
  }
}

async function fetchMediaBox(box) {
  if (box.dataset.fetched) return;
  box.dataset.fetched = '1';
  const peer = box.dataset.peer;
  const msgId = Number(box.dataset.msg);
  const kind = box.dataset.kind;
  const ph = box.querySelector('.media-placeholder');
  if (ph) ph.textContent = '⏳ جارٍ التحميل…';
  try {
    const file = await window.tg.getMedia(peer, msgId);
    if (!file || !box.isConnected) return;
    const u = String(file);
    const url = /^(blob:|data:|https?:)/i.test(u) ? u : 'file:///' + u.replace(/\\/g, '/');

    if (kind === 'video') {
      const v = document.createElement('video');
      v.className = 'msg-video' + (box.classList.contains('round') ? ' round' : '');
      v.controls = true;
      v.playsInline = true;
      v.preload = 'metadata';
      v.src = url;
      box.innerHTML = '';
      box.appendChild(v);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'voice-player';
    const dur = box.dataset.dur;
    wrap.innerHTML = `<span class="vp-dur">${dur ? fmtDur(dur) : '—'}</span><audio controls preload="metadata"></audio>`;
    wrap.querySelector('audio').src = url;
    box.innerHTML = '';
    box.appendChild(wrap);
  } catch (err) {
    const p = box.querySelector('.media-placeholder');
    if (p) p.textContent = '⚠ تعذّر تحميل الوسيط';
  }
}

// ---------------- إرسال الرسائل ----------------

function autosize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

function clearContext() {
  state.replyTo = null;
  state.editing = null;
  state.forwarding = null;
  $('context-bar').classList.add('hidden');
  $('context-bar').innerHTML = '';
}

function showContextBar(kind, msg) {
  const bar = $('context-bar');
  bar.classList.remove('hidden');
  if (kind === 'reply') {
    const r = state.replyTo;
    bar.innerHTML = `
      <div class="ctx-line" style="background:${esc(r.color)}"></div>
      <div class="ctx-body">
        <div class="ctx-title" style="color:${esc(r.color)}">ردًا على ${esc(r.name)}</div>
        <div class="ctx-text">${esc(r.text)}</div>
      </div>
      <button class="ctx-close" id="ctx-close" title="إلغاء">✕</button>`;
  } else {
    bar.innerHTML = `
      <div class="ctx-line" style="background:#7bc862"></div>
      <div class="ctx-body">
        <div class="ctx-title" style="color:#7bc862">تعديل الرسالة</div>
        <div class="ctx-text">${esc((msg.text || '').slice(0, 120))}</div>
      </div>
      <button class="ctx-close" id="ctx-close" title="إلغاء التعديل">✕</button>`;
  }
  $('ctx-close').addEventListener('click', () => {
    clearContext();
    $('msg-input').value = '';
    autosize($('msg-input'));
  });
}

function setReply(msg) {
  state.editing = null;
  state.replyTo = {
    id: msg.id,
    text: (msg.text || previewFromMedia(msg.media) || 'رسالة').slice(0, 150),
    name: msg.out ? 'أنت' : msg.sender?.name || 'المرسل',
    color: msg.out ? '#6ab3f3' : msg.sender?.color || '#5288c1',
  };
  $('msg-input').value = '';
  autosize($('msg-input'));
  showContextBar('reply');
  $('msg-input').focus();
}

function startEdit(msg) {
  state.replyTo = null;
  state.editing = { id: msg.id };
  $('msg-input').value = msg.text;
  showContextBar('edit', msg);
  autosize($('msg-input'));
  $('msg-input').focus();
}

// — الإرفاق —
function setPendingFile(path, name, file) {
  state.pendingFile = { path, name, file };
  const chip = $('attach-chip');
  chip.textContent = '📎 ' + name;
  chip.classList.remove('hidden');
  $('msg-input').focus();
}

function clearPendingFile() {
  state.pendingFile = null;
  $('attach-chip').classList.add('hidden');
}

$('btn-attach').addEventListener('click', () => $('file-input').click());
$('attach-chip').addEventListener('click', clearPendingFile);

$('file-input').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) setPendingFile(WEB ? null : f.path, f.name, f);
  e.target.value = '';
});

// لصق صورة من الحافظة (Ctrl+V)
$('msg-input').addEventListener('paste', (e) => {
  const items = (e.clipboardData && e.clipboardData.items) || [];
  for (const it of items) {
    if (it.type && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f && (WEB || f.path)) {
        e.preventDefault();
        setPendingFile(WEB ? null : f.path, f.name || 'صورة.png', f);
      }
      return;
    }
  }
});

// مؤشر الكتابة (يُرسل مرة كل 3 ثوانٍ كحد أقصى)
let lastTypingSent = 0;

/* ---------------- الرسائل الصوتية (تسجيل وإرسال) ---------------- */

let mediaRecorder = null;
let recChunks = [];
let recStream = null;
let recStartedAt = 0;
let recTimerId = null;
let recSendRequested = false;

function recPickMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const c of candidates) {
    try { if (MediaRecorder.isTypeSupported(c)) return c; } catch {}
  }
  return '';
}

async function toggleRecording() {
  if (mediaRecorder) { // ضغطة ثانية أثناء التسجيل = إرسال
    stopRecording(true);
    return;
  }
  if (!state.activePeer) { toast('افتح محادثة أولاً لتسجيل رسالة', true); return; }
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    toast('المتصفح لا يدعم التسجيل الصوتي', true);
    return;
  }
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    toast('تعذّر الوصول إلى الميكروفون — تحقّق من إذن المتصفح', true);
    return;
  }
  recChunks = [];
  const mime = recPickMime();
  try {
    mediaRecorder = mime ? new MediaRecorder(recStream, { mimeType: mime }) : new MediaRecorder(recStream);
  } catch {
    try { mediaRecorder = new MediaRecorder(recStream); }
    catch { stopTracks(); toast('تعذّر بدء التسجيل', true); return; }
  }
  mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
  mediaRecorder.onstop = onRecordingStop;
  mediaRecorder.start();
  recStartedAt = Date.now();
  recSendRequested = false;
  updateRecTime();
  recTimerId = setInterval(updateRecTime, 300);
  $('rec-bar').classList.remove('hidden');
  $('composer').classList.add('recording');
}

function updateRecTime() {
  const s = Math.floor((Date.now() - recStartedAt) / 1000);
  const el = $('rec-time');
  if (el) el.textContent = fmtDur(s);
}

function stopRecording(send) {
  if (!mediaRecorder) return;
  recSendRequested = Boolean(send);
  clearInterval(recTimerId);
  recTimerId = null;
  try { if (mediaRecorder.state !== 'inactive') mediaRecorder.stop(); } catch {}
}

function stopTracks() {
  if (recStream) { recStream.getTracks().forEach((t) => t.stop()); recStream = null; }
}

function cancelRecording() {
  if (!mediaRecorder) return;
  recSendRequested = false;
  clearInterval(recTimerId);
  recTimerId = null;
  try { if (mediaRecorder.state !== 'inactive') mediaRecorder.stop(); } catch {}
  $('composer').classList.remove('recording');
  $('rec-bar').classList.add('hidden');
}

function onRecordingStop() {
  const seconds = Math.max(1, Math.round((Date.now() - recStartedAt) / 1000));
  const type = (recChunks[0] && recChunks[0].type) || 'audio/webm';
  const blob = new Blob(recChunks, { type });
  const send = recSendRequested;
  recChunks = [];
  mediaRecorder = null;
  stopTracks();
  $('composer').classList.remove('recording');
  $('rec-bar').classList.add('hidden');
  if (send) sendVoiceNote(blob, seconds);
}

async function sendVoiceNote(blob, seconds) {
  if (!state.activePeer || state.sending) return;
  if (!blob || blob.size < 400) { toast('التسجيل فارغ', true); return; }
  state.sending = true;
  const type = blob.type || 'audio/webm';
  const ext = /ogg|opus/.test(type) ? 'ogg' : /mp4/.test(type) ? 'm4a' : 'webm';
  const name = `voice-${Date.now()}.${ext}`;
  const opts = { voiceNote: true, duration: seconds, mimeType: type };
  try {
    let ref;
    if (WEB) {
      ref = new File([blob], name, { type });
    } else {
      // Electron: نحفظ التسجيل مؤقتاً ثم نرسله كمسار ملف
      const buf = await blob.arrayBuffer();
      ref = await window.tg.saveTemp(buf, name);
    }
    const m = await window.tg.sendFile(state.activePeer, ref, '', opts);
    if (!state.msgIds.has(m.id)) {
      state.msgIds.add(m.id);
      state.messages.push(m);
      appendMessage(m);
    }
    touchDialogAfterSend(state.activePeer, '🎤 رسالة صوتية');
  } catch (err) {
    toast('تعذّر إرسال الرسالة الصوتية: ' + (err.message || err), true);
  } finally {
    state.sending = false;
  }
}

$('btn-voice').addEventListener('click', toggleRecording);
$('btn-rec-send').addEventListener('click', () => stopRecording(true));
$('btn-rec-cancel').addEventListener('click', cancelRecording);

async function sendCurrent() {
  const input = $('msg-input');
  const text = input.value.trim();

  // — وضع التعديل —
  if (state.editing) {
    if (!text || !state.activePeer) return;
    const { id } = state.editing;
    clearContext();
    input.value = '';
    autosize(input);
    try {
      const edited = await window.tg.editMessage(state.activePeer, id, text);
      if (edited) {
        const i = state.messages.findIndex((m) => m.id === id);
        if (i >= 0) {
          state.messages[i] = edited;
          renderMessages();
        }
      }
    } catch (err) {
      // إعادة الحالة للسماح بإعادة المحاولة
      input.value = text;
      state.editing = { id };
      showContextBar('edit', { text });
      toast('تعذّر تعديل الرسالة: ' + (err.message || err), true);
    }
    return;
  }

  // — إرسال ملف مرفق —
  if (state.pendingFile) {
    if (!state.activePeer || state.sending) return;
    state.sending = true;
    const { path: filePath, name, file } = state.pendingFile;
    clearPendingFile();
    const caption = text;
    input.value = '';
    autosize(input);
    try {
      const ref = WEB ? file : filePath;
      const m = await window.tg.sendFile(state.activePeer, ref, caption);
      if (!state.msgIds.has(m.id)) {
        state.msgIds.add(m.id);
        state.messages.push(m);
        appendMessage(m);
      }
      touchDialogAfterSend(state.activePeer, caption || name);
    } catch (err) {
      toast('تعذّر إرسال الملف: ' + (err.message || err), true);
    } finally {
      state.sending = false;
      input.focus();
    }
    return;
  }

  // — إرسال نص عادي (مع رد اختياري) —
  if (!text || !state.activePeer || state.sending) return;

  const replyTo = state.replyTo ? state.replyTo.id : 0;
  clearContext();
  input.value = '';
  autosize(input);

  state.sending = true;
  try {
    const m = await window.tg.sendMessage(state.activePeer, text, replyTo);
    if (!state.msgIds.has(m.id)) {
      state.msgIds.add(m.id);
      state.messages.push(m);
      appendMessage(m);
    }
    touchDialogAfterSend(state.activePeer, text);
  } catch (err) {
    input.value = text; // إعادة النص لإعادة المحاولة
    toast('تعذّر إرسال الرسالة: ' + (err.message || err), true);
  } finally {
    state.sending = false;
    input.focus();
  }
}

$('btn-send').addEventListener('click', sendCurrent);
$('msg-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendCurrent();
  } else if (e.key === 'Escape') {
    clearContext();
    e.target.value = '';
    autosize(e.target);
  }
});

// تكامل الصندوق مع الكتابة + إرسال مؤشر «يكتب…»
$('msg-input').addEventListener('input', (e) => {
  autosize(e.target);
  const now = Date.now();
  if (state.activePeer && now - lastTypingSent > 3000) {
    lastTypingSent = now;
    window.tg.setTyping(state.activePeer).catch(() => {});
  }
});

function appendMessage(m) {
  const el = $('messages');
  const prev = state.messages[state.messages.length - 2] || null;
  const holder = document.createElement('div');
  holder.innerHTML = messageHTML(m, prev);
  while (holder.firstChild) el.appendChild(holder.firstChild);
  loadVisiblePhotos();
  loadVisibleMedia();
  scrollBottom();
}

function touchDialogAfterSend(peerKey, text) {
  const d = state.dialogs.find((x) => x.key === peerKey);
  if (d) {
    d.lastMessage = text.replace(/\s+/g, ' ').slice(0, 120);
    d.lastMessageOut = true;
    d.lastDate = Date.now();
    state.dialogs = [d, ...state.dialogs.filter((x) => x.key !== peerKey)];
    renderDialogs();
  }
}

/* ---------------- قائمة خيارات الرسالة ---------------- */

function closeMsgMenu() {
  $('msg-menu').classList.add('hidden');
  $('msg-menu').innerHTML = '';
}

async function openMsgMenu(msg, anchor) {
  const menu = $('msg-menu');
  const picker = await reactionPickerHTML();

  const items = [
    { label: 'رد', act: () => setReply(msg) },
    { label: 'نسخ النص', act: () => copyMessage(msg) },
    { label: 'إعادة توجيه', act: () => startForward(msg) },
  ];
  if (msg.out && msg.text && !msg.media) {
    items.push({ label: 'تعديل', act: () => startEdit(msg) });
  }
  if (msg.out) {
    items.push({ label: 'حذف', act: () => confirmDelete(msg), danger: true });
  }

  menu.innerHTML =
    picker +
    items
      .map(
        (it, i) =>
          `<button class="msg-menu-item${it.danger ? ' danger' : ''}" data-i="${i}">${it.label}</button>`
      )
      .join('');
  menu.classList.remove('hidden');

  // شريط الإيماءات
  for (const el of menu.querySelectorAll('.reaction-pick')) {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const emoji = el.dataset.emoji;
      closeMsgMenu();
      toggleReaction(msg, emoji);
    });
  }

  // بنود القائمة
  for (const el of menu.querySelectorAll('.msg-menu-item')) {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const it = items[Number(el.dataset.i)];
      closeMsgMenu();
      if (it && it.act) it.act();
    });
  }

  // موضع القائمة قرب الزر
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let x = r.right - mw;
  let y = r.bottom + 4;
  if (y + mh > window.innerHeight - 8) y = r.top - mh - 4;
  x = Math.max(8, Math.min(x, window.innerWidth - mw - 8));
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

function copyMessage(msg) {
  if (!msg.text) {
    toast('لا يوجد نص لنسخه', true);
    return;
  }
  navigator.clipboard
    .writeText(msg.text)
    .then(() => toast('تم نسخ النص'))
    .catch(() => toast('تعذّر النسخ', true));
}

async function confirmDelete(msg) {
  if (!confirm('حذف هذه الرسالة نهائياً لك وللطرف الآخر؟')) return;
  try {
    await window.tg.deleteMessage(state.activePeer, msg.id);
    state.messages = state.messages.filter((m) => m.id !== msg.id);
    state.msgIds.delete(msg.id);
    renderMessages();
  } catch (err) {
    toast('تعذّر الحذف: ' + (err.message || err), true);
  }
}

/* ---------------- الإيماءات (Reactions) ---------------- */

// تبديل إيماءة واحدة: إضافتها إن لم تكن لي، أو إزالتها إن كانت لي
async function toggleReaction(msg, emoticon) {
  const mine = (msg.reactions || []).filter((r) => r.chosen).map((r) => r.emoticon);
  let next;
  if (mine.includes(emoticon)) {
    next = mine.filter((e) => e !== emoticon);
  } else {
    next = [...mine, emoticon];
  }

  // تحديث فوري في الواجهة (متفائل)
  applyReactionsLocally(msg, next);
  try {
    await window.tg.sendReaction(state.activePeer, msg.id, next);
  } catch (err) {
    // تراجع عند الفشل
    applyReactionsLocally(msg, mine);
    toast('تعذّر إرسال الإيماءة: ' + (err.message || err), true);
  }
}

function applyReactionsLocally(msg, mineEmoticons) {
  const next = [];
  for (const r of msg.reactions || []) {
    if (r.chosen && !mineEmoticons.includes(r.emoticon)) {
      const c = r.count - 1;
      if (c > 0) next.push({ ...r, count: c, chosen: false });
    } else if (!r.chosen && mineEmoticons.includes(r.emoticon)) {
      next.push({ ...r, count: r.count + 1, chosen: true });
    } else {
      next.push(r);
    }
  }
  for (const e of mineEmoticons) {
    if (!next.some((r) => r.emoticon === e)) next.push({ emoticon: e, count: 1, chosen: true });
  }
  msg.reactions = next;
  const row = $('messages').querySelector(`.msg-row[data-id="${msg.id}"]`);
  if (row) {
    const bubble = row.querySelector('.msg');
    const old = bubble.querySelector('.msg-reactions');
    if (old) old.remove();
    if (next.length) {
      const holder = document.createElement('div');
      holder.innerHTML = reactionsHTML(msg);
      while (holder.firstChild) bubble.appendChild(holder.firstChild);
    }
  }
}

// شريط الإيماءات داخل قائمة الخيارات (يُجلب مرة واحدة)
async function reactionPickerHTML() {
  if (!state.reactionsList) {
    try {
      state.reactionsList = await window.tg.availableReactions();
    } catch {
      state.reactionsList = [];
    }
  }
  if (!state.reactionsList.length) return '';
  return `<div class="reaction-picker">${state.reactionsList
    .map((r) => `<button class="reaction-pick" data-emoji="${esc(r.emoticon)}" title="${esc(r.title)}">${esc(r.emoticon)}</button>`)
    .join('')}</div>`;
}

/* ---------------- إعادة التوجيه ---------------- */

function startForward(msg) {
  state.replyTo = null;
  state.editing = null;
  state.forwarding = {
    fromPeer: state.activePeer,
    msgIds: [msg.id],
    preview: (msg.text || previewFromMedia(msg.media) || 'رسالة').slice(0, 120),
  };
  const bar = $('context-bar');
  bar.classList.remove('hidden');
  bar.innerHTML = `
    <div class="ctx-line" style="background:#f5a623"></div>
    <div class="ctx-body">
      <div class="ctx-title" style="color:#f5a623">إعادة توجيه — اختر محادثة من القائمة</div>
      <div class="ctx-text">${esc(state.forwarding.preview)}</div>
    </div>
    <button class="ctx-close" id="ctx-close" title="إلغاء">✕</button>`;
  $('ctx-close').addEventListener('click', cancelForward);
  toast('اختر المحادثة المراد الإرسال إليها');
}

function cancelForward() {
  state.forwarding = null;
  clearContext();
}

// يُستدعى من معالج النقر على المحادثة — يعيد true إن كان التوجيه جارياً
async function tryForwardTo(targetPeer) {
  const fw = state.forwarding;
  if (!fw) return false;
  cancelForward();
  if (targetPeer === fw.fromPeer) {
    toast('اختر محادثة أخرى غير المصدر', true);
    return true;
  }
  try {
    await window.tg.forward(targetPeer, fw.fromPeer, fw.msgIds);
    toast('تمت إعادة التوجيه ✓');
    await openChat(targetPeer);
  } catch (err) {
    toast('تعذّرت إعادة التوجيه: ' + (err.message || err), true);
  }
  return true;
}

// النقر داخل منطقة الرسائل: الإيماءات، الخيارات، الصور، الروابط، الاقتباسات
$('messages').addEventListener('click', (e) => {
  // النقر على إيماءة مثبتة تحت الرسالة → تبديلها
  const chip = e.target.closest('.reaction-chip');
  if (chip) {
    e.stopPropagation();
    const msg = state.messages.find((m) => m.id === Number(chip.dataset.id));
    if (msg) toggleReaction(msg, chip.dataset.emoji);
    return;
  }

  // زر الخيارات
  const menuBtn = e.target.closest('.msg-menu-btn');
  if (menuBtn) {
    e.stopPropagation();
    const msg = state.messages.find((m) => m.id === Number(menuBtn.dataset.id));
    if (msg) {
      closeMsgMenu();
      openMsgMenu(msg, menuBtn);
    }
    return;
  }

  // الانتقال لرسالة مردود عليها
  const replyEl = e.target.closest('.msg-reply[data-goto]');
  if (replyEl) {
    flashMessage(Number(replyEl.dataset.goto));
    return;
  }

  // فتح صورة بحجم كامل
  const img = e.target.closest('.msg-media img');
  if (img && img.src) {
    window.open(img.src, '_blank');
    return;
  }

  // فتح رابط خارجي
  const link = e.target.closest('.msg-text a[data-url]');
  if (link) {
    e.preventDefault();
    window.tg.openExternal(link.dataset.url);
  }
});

// إغلاق القائمة عند النقر خارجها
document.addEventListener('click', (e) => {
  if (!e.target.closest('#msg-menu') && !e.target.closest('.msg-menu-btn')) {
    closeMsgMenu();
  }
});

/* ---------------- البحث داخل المحادثة ---------------- */

// تمرير إلى رسالة وتمييزها بوميض
function flashMessage(msgId) {
  const row = $('messages').querySelector(`.msg-row[data-id="${msgId}"]`);
  if (!row) return false;
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const bubble = row.querySelector('.msg');
  if (bubble) {
    bubble.classList.remove('flashing');
    void bubble.offsetWidth; // إعادة تشغيل الحركة
    bubble.classList.add('flashing');
    setTimeout(() => bubble.classList.remove('flashing'), 1300);
  }
  return true;
}

// الانتقال إلى رسالة قد لا تكون ضمن السجل المحمل
async function jumpToMessage(msgId) {
  closeInChatSearch();
  if (state.msgIds.has(msgId)) {
    flashMessage(msgId);
    return;
  }
  try {
    const res = await window.tg.messagesAround(state.activePeer, msgId);
    state.messages = res.messages;
    state.hasMore = res.hasMore;
    state.msgIds = new Set(res.messages.map((m) => m.id));
    renderMessages();
    requestAnimationFrame(() => flashMessage(msgId));
  } catch (err) {
    toast('تعذّر الانتقال للرسالة', true);
  }
}

function openInChatSearch() {
  $('chat-search-bar').classList.remove('hidden');
  $('chat-search-input').focus();
}

function closeInChatSearch() {
  $('chat-search-bar').classList.add('hidden');
  $('chat-search-input').value = '';
  const panel = $('search-in-chat');
  panel.classList.add('hidden');
  panel.innerHTML = '';
  clearTimeout(inChatTimer);
}

let inChatTimer = null;

$('btn-chat-search').addEventListener('click', () => {
  const bar = $('chat-search-bar');
  if (bar.classList.contains('hidden')) openInChatSearch();
  else closeInChatSearch();
});

$('chat-search-close').addEventListener('click', closeInChatSearch);

$('chat-search-input').addEventListener('input', (e) => {
  const q = e.target.value.trim();
  clearTimeout(inChatTimer);
  const panel = $('search-in-chat');
  if (q.length < 2) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }
  inChatTimer = setTimeout(async () => {
    if (!state.activePeer) return;
    panel.classList.remove('hidden');
    panel.innerHTML = '<div class="sic-empty">جارٍ البحث…</div>';
    try {
      const results = await window.tg.searchInChat(state.activePeer, q);
      // تجاهل إن تغيّر النص أثناء الانتظار
      if ($('chat-search-input').value.trim() !== q) return;
      if (!results.length) {
        panel.innerHTML = '<div class="sic-empty">لا توجد نتائج في هذه المحادثة.</div>';
        return;
      }
      panel.innerHTML =
        `<div class="sic-title">${results.length} نتيجة</div>` +
        results
          .map(
            (m) => `
          <button class="sic-item" data-id="${m.id}">
            <div class="sic-meta">
              <span>${m.out ? 'أنت' : esc(m.sender?.name || '')}</span>
              <span>${esc(fmtDialogTime(m.date))}</span>
            </div>
            <div class="sic-text">${highlightMatch(m.text || previewFromMedia(m.media) || 'رسالة', q)}</div>
          </button>`
          )
          .join('');
      for (const el of panel.querySelectorAll('.sic-item')) {
        el.addEventListener('click', () => jumpToMessage(Number(el.dataset.id)));
      }
    } catch {
      panel.innerHTML = '<div class="sic-empty">تعذّر إجراء البحث.</div>';
    }
  }, 450);
});

// إبراز النص المطابق في نتائج البحث
function highlightMatch(text, q) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(text);
  return (
    esc(text.slice(0, i)) +
    '<mark>' +
    esc(text.slice(i, i + q.length)) +
    '</mark>' +
    esc(text.slice(i + q.length))
  );
}

/* ---------------- الإشعارات (سطح المكتب) ---------------- */

let notifCtx = null;

// نغمة إشعار قصيرة مولّدة بـ WebAudio
function playNotifSound() {
  try {
    notifCtx = notifCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = notifCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = t0 + i * 0.11;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.36);
    });
  } catch {
    /* صامت */
  }
}

function notifyIncoming(chatName, body, peerKey) {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'denied') return;
    const n = new Notification({
      title: chatName || 'تليجرام فورك',
      body: (body || '').slice(0, 200) || 'رسالة جديدة',
      silent: true, // سنعزف النغمة بأنفسنا لضمان التناسق
    });
    n.onclick = () => {
      window.focus();
      n.close();
      openChat(peerKey);
    };
    playNotifSound();
  } catch {
    /* تجاهل فشل الإشعارات */
  }
}

/* ---------------- سحب وإفلات الملفات ---------------- */

const chatViewEl = document.getElementById('chat-view');
let dragDepth = 0;

chatViewEl.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  $('drop-overlay').classList.remove('hidden');
});

chatViewEl.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

chatViewEl.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) $('drop-overlay').classList.add('hidden');
});

chatViewEl.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('drop-overlay').classList.add('hidden');
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f && (WEB || f.path)) {
    setPendingFile(WEB ? null : f.path, f.name, f);
    toast('المرفق جاهز: ' + f.name + ' — اكتب تعليقاً واضغط إرسال');
  } else if (f) {
    toast('تعذّر الوصول لمسار الملف', true);
  }
});

/* ---------------- لوحة الملصقات ---------------- */

let stickersLoaded = false;

$('btn-stickers').addEventListener('click', async () => {
  const panel = $('sticker-panel');
  if (!panel.classList.contains('hidden')) {
    panel.classList.add('hidden');
    return;
  }
  if (!state.activePeer) {
    toast('افتح محادثة أولاً لإرسال ملصق', true);
    return;
  }
  panel.classList.remove('hidden');
  if (stickersLoaded) return;

  const grid = $('sticker-grid');
  grid.innerHTML = '<div class="sticker-empty">جارٍ التحميل…</div>';
  try {
    const list = await window.tg.stickers();
    stickersLoaded = true;
    if (!list.length) {
      grid.innerHTML =
        '<div class="sticker-empty">لا توجد ملصقات بعد.<br>استخدم تلكرام الرسمي لإضافتك لملصقات، ثم ستظهر هنا.</div>';
      return;
    }
    grid.innerHTML = list
      .map(
        (s) => `
        <button class="sticker-item" data-key="${esc(s.key)}" title="${esc(s.emoji)}">
          ${s.thumb ? `<img src="${s.thumb}" alt="${esc(s.emoji)}" />` : `<span class="sticker-fallback">${esc(s.emoji)}</span>`}
        </button>`
      )
      .join('');
    for (const el of grid.querySelectorAll('.sticker-item')) {
      el.addEventListener('click', () => sendSticker(el.dataset.key));
    }
  } catch {
    grid.innerHTML = '<div class="sticker-empty">تعذّر تحميل الملصقات.</div>';
  }
});

async function sendSticker(key) {
  if (!state.activePeer || state.sending) return;
  state.sending = true;
  try {
    const m = await window.tg.sendSticker(state.activePeer, key);
    if (!state.msgIds.has(m.id)) {
      state.msgIds.add(m.id);
      state.messages.push(m);
      appendMessage(m);
    }
    touchDialogAfterSend(state.activePeer, 'ملصق');
    $('sticker-panel').classList.add('hidden');
  } catch (err) {
    toast('تعذّر إرسال الملصق: ' + (err.message || err), true);
  } finally {
    state.sending = false;
  }
}

/* ---------------- نافذة الإعدادات والرد التلقائي ---------------- */

$('btn-settings').addEventListener('click', async () => {
  $('settings-modal').classList.remove('hidden');
  try {
    const ar = await window.tg.getAutoReply();
    $('ar-enabled').checked = ar.enabled;
    $('ar-message').value = ar.message;
  } catch {
    /* اترك الحقول كما هي */
  }
});

$('btn-settings-close').addEventListener('click', () => {
  $('settings-modal').classList.add('hidden');
});

// إغلاق النافذة عند النقر خارجها
$('settings-modal').addEventListener('click', (e) => {
  if (e.target === $('settings-modal')) $('settings-modal').classList.add('hidden');
});

$('btn-ar-save').addEventListener('click', async () => {
  const enabled = $('ar-enabled').checked;
  const message = $('ar-message').value.trim();
  if (enabled && !message) {
    toast('اكتب نص الرسالة التلقائية أولاً', true);
    return;
  }
  try {
    await window.tg.setAutoReply(enabled, message);
    $('settings-modal').classList.add('hidden');
    toast(enabled ? 'تم تفعيل الرد التلقائي ✓' : 'تم حفظ الإعدادات ✓');
  } catch (err) {
    toast('تعذّر الحفظ: ' + (err.message || err), true);
  }
});

/* ---------------- مؤشر الكتابة ---------------- */

const TYPING_LABELS = {
  text: 'يكتب…',
  voice: 'يسجل رسالة صوتية…',
  'video-note': 'يسجل فيديو…',
  video: 'يرسل فيديو…',
  photo: 'يرسل صورة…',
  file: 'يرسل ملفاً…',
  sticker: 'يختار ملصقاً…',
};

const typingTimers = {};

function setPeerTyping(peerKey, action) {
  state.typing[peerKey] = { until: Date.now() + 6000, action: action || 'text' };
  clearTimeout(typingTimers[peerKey]);
  typingTimers[peerKey] = setTimeout(() => clearPeerTyping(peerKey), 6200);
  updateChatSubtitle();
}

function clearPeerTyping(peerKey) {
  if (typingTimers[peerKey]) {
    clearTimeout(typingTimers[peerKey]);
    delete typingTimers[peerKey];
  }
  delete state.typing[peerKey];
  updateChatSubtitle();
}

function updateChatSubtitle() {
  const t = state.activePeer ? state.typing[state.activePeer] : null;
  const el = $('chat-subtitle');
  if (t && t.until > Date.now()) {
    el.textContent = TYPING_LABELS[t.action] || TYPING_LABELS.text;
    el.classList.add('typing');
  } else {
    if (state.activePeer) delete state.typing[state.activePeer];
    el.textContent = state.activeSubtitle;
    el.classList.remove('typing');
  }
}

/* ============================================================
   التحديثات اللحظية من تلكرام
   ============================================================ */

window.tg.onUpdate((data) => {
  if (!data) return;

  // — رسالة جديدة —
  if (data.kind === 'new-message') {
    const { peerKey, message } = data;

    // تحديث/إضافة المحادثة في القائمة
    let d = state.dialogs.find((x) => x.key === peerKey);
    if (!d && data.chat) {
      d = { ...data.chat, unread: 0, lastMessage: '', lastDate: null };
      state.dialogs.unshift(d);
    }
    if (d) {
      d.lastMessage = (message.text || previewFromMedia(message.media) || '').replace(/\s+/g, ' ').slice(0, 120);
      d.lastMessageOut = message.out;
      d.lastDate = message.date;
      if (!message.out && state.activePeer !== peerKey) d.unread = (d.unread || 0) + 1;
      if (message.out && state.activePeer === peerKey) d.unread = 0;
      state.dialogs = [d, ...state.dialogs.filter((x) => x.key !== peerKey)];
      renderDialogs();
    }

    // وصول رسالة تعني أن الطرف الآخر لم يعد يكتب
    clearPeerTyping(peerKey);

    // إشعار سطح المكتب عند عدم تركيز النافذة أو فتح محادثة أخرى
    const shouldNotify =
      !message.out &&
      (peerKey !== state.activePeer || !document.hasFocus() || document.hidden);
    if (shouldNotify) {
      const name = (d && d.name) || (data.chat && data.chat.name) || 'تليجرام فورك';
      notifyIncoming(name, message.text || previewFromMedia(message.media), peerKey);
    }

    // إضافة الرسالة إلى المحادثة المفتوحة
    if (peerKey === state.activePeer) {
      if (!state.msgIds.has(message.id)) {
        state.msgIds.add(message.id);
        state.messages.push(message);
        appendMessage(message);
      }
      const dd = state.dialogs.find((x) => x.key === peerKey);
      if (dd) { dd.unread = 0; renderDialogs(); }
    }
    return;
  }

  // — تعديل رسالة —
  if (data.kind === 'edited') {
    if (data.peerKey !== state.activePeer) return;
    const i = state.messages.findIndex((m) => m.id === data.message.id);
    if (i >= 0) {
      state.messages[i] = data.message;
      renderMessages();
    }
    return;
  }

  // — حذف رسالة —
  if (data.kind === 'deleted') {
    if (data.peerKey !== state.activePeer) return;
    if (state.msgIds.has(data.msgId)) {
      state.msgIds.delete(data.msgId);
      state.messages = state.messages.filter((m) => m.id !== data.msgId);
      renderMessages();
    }
    return;
  }

  // — مؤشر الكتابة —
  if (data.kind === 'typing') {
    if (data.typing) setPeerTyping(data.peerKey, data.action);
    else clearPeerTyping(data.peerKey);
  }
});

function previewFromMedia(media) {
  if (!media) return '';
  const base = {
    photo: '📷 صورة', sticker: '🖼️ ملصق', voice: '🎤 رسالة صوتية', gif: '🖼️ صورة متحركة',
    video: '🎬 فيديو', 'video-note': '⏺ مقطع دائري', audio: '🎵 ملف صوتي', file: '📎 ملف',
    contact: '👤 جهة اتصال', geo: '📍 موقع', poll: '📊 استطلاع', link: '🔗 رابط',
  }[media.type] || 'رسالة';
  if (media.duration && (media.type === 'voice' || media.type === 'audio' || media.type === 'video')) {
    return `${base} (${fmtDur(media.duration)})`;
  }
  return base;
}

/* ---------------- البدء ---------------- */
init().catch((err) => {
  toast('خطأ في البدء: ' + (err.message || err), true);
  show('screen-api');
});
