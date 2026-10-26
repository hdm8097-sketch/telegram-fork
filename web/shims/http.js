// مصغّر http/https — تُستخدم فقط في مسارات الوكيل (Proxy) غير المفعّل هنا
const fail = (what) => () => {
  throw new Error(`${what} غير متاح في نسخة الويب`);
};

export const request = fail('http.request');
export const get = fail('http.get');
export const createServer = fail('http.createServer');
export const Server = class Server {};

const api = { request, get, createServer, Server };
export default api;
