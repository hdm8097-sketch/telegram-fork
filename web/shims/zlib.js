// مصغّر zlib — crc32 يترك فارغاً عمداً (لدى teleproto بديل JavaScript تلقائي)
// و unzipSync لفك رسائل GZIP-Packed (مثل help.GetConfig الكبيرة المضغوطة)
// مهم: يجب إرجاع Buffer وليس Uint8Array الخام — قوّاء teleproto تستدعي
// stream.readUInt32LE مباشرة على الناتج (وكذلك في Node الأصلي عبر zlib)
import * as pako from 'pako';
import { Buffer } from 'buffer';

export function unzipSync(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const out = pako.ungzip(bytes);
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
}

export const gunzipSync = unzipSync;

export function unzip(data, cb) {
  try {
    cb(null, unzipSync(data));
  } catch (e) {
    cb(e);
  }
}

const api = { unzipSync, gunzipSync, unzip };
export default api;
