// مصغّر node:crypto — يوفّر التوليد العشوائي فقط (ما تستخدمه teleproto فعلياً).
// التجزئة (sha1/sha256) والتشفير (AES) تأتي من مكتبات JavaScript نقية (cifrante).
import { Buffer } from 'buffer';

function getRandom(target) {
  const c = globalThis.crypto;
  if (!c || !c.getRandomValues) throw new Error('WebCrypto غير متاح في هذا المتصفح');
  return c.getRandomValues(target);
}

export function randomBytes(size) {
  const u8 = new Uint8Array(Number(size) || 0);
  getRandom(u8);
  return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
}

export function randomFillSync(buf, offset = 0, size) {
  const len = size === undefined ? buf.byteLength - offset : size;
  getRandom(new Uint8Array(buf.buffer, buf.byteOffset + offset, len));
  return buf;
}

export function randomInt(max, min = 0) {
  return Math.floor(Math.random() * (max - min)) + min;
}

export function randomUUID() {
  if (globalThis.crypto && globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  const u8 = new Uint8Array(16);
  getRandom(u8);
  u8[6] = (u8[6] & 0x0f) | 0x40;
  u8[8] = (u8[8] & 0x3f) | 0x80;
  const hex = [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// هذه الدوال غير مستخدمة في مسارنا الأساسي — إن استُدعيت فالخطأ أوضح من الصمت
const unsupported = (name) => () => {
  throw new Error(`crypto.${name} غير متاح في نسخة الويب`);
};

export const createHash = unsupported('createHash');
export const createHmac = unsupported('createHmac');
export const createCipheriv = unsupported('createCipheriv');
export const createDecipheriv = unsupported('createDecipheriv');
export const pbkdf2Sync = unsupported('pbkdf2Sync');
export const timingSafeEqual = unsupported('timingSafeEqual');

const api = {
  randomBytes,
  randomFillSync,
  randomInt,
  randomUUID,
  createHash,
  createHmac,
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  timingSafeEqual,
};

export default api;
