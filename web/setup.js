// تهيئة عناصر Node العالمية قبل تشغيل أي وحدة أخرى
import { Buffer as NodeBuffer } from 'buffer';

if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = NodeBuffer;

// حزمة buffer@6 npm تفتقد حُزم readBigUint64* التي توفّرها Node الأصلي
// (teleproto يستدعيها في مسار تبادل مفتاح المصادقة)
const B = globalThis.Buffer;
if (B && B.prototype) {
  if (!B.prototype.readBigUint64BE && B.prototype.readBigUInt64BE) {
    B.prototype.readBigUint64BE = B.prototype.readBigUInt64BE;
  }
  if (!B.prototype.readBigUint64LE && B.prototype.readBigUInt64LE) {
    B.prototype.readBigUint64LE = B.prototype.readBigUInt64LE;
  }
}

if (typeof globalThis.global === 'undefined') globalThis.global = globalThis;
if (typeof globalThis.process === 'undefined') {
  globalThis.process = {
    env: { NODE_ENV: 'production' },
    platform: 'browser',
    browser: true,
    version: '',
    versions: { node: '' },
    argv: ['telegram-fork'],
    title: 'telegram-fork',
    nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)),
    cwd: () => '/',
  };
}

export {};
