// مصغّر مكتبة socks (وكلاء) — لا تُستخدم في نسخة المتصفح
const fail = (what) => () => {
  throw new Error(`${what} غير متاح في نسخة الويب`);
};

export class SocksClient {
  constructor() { throw new Error('socks غير متاح في نسخة الويب'); }
}
export class SocksProxy {}
export const createConnection = fail('socks.createConnection');

const api = { SocksClient, SocksProxy, createConnection };
export default api;
