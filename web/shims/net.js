// مصغّر net/tls — في المتصفح نستخدم WebSocket فقط (PromisedWebSockets)
const fail = (what) => () => {
  throw new Error(`${what} غير متاح في المتصفح — استخدم اتصال WebSocket`);
};

export class Socket {
  on() { return this; }
  once() { return this; }
  write() { return false; }
  end() {}
  destroy() {}
  connect() { throw new Error('اتصال TCP غير متاح في المتصفح'); }
}

export class TLSSocket extends Socket {}

export const connect = fail('connect');
export const createConnection = fail('createConnection');
export const createServer = fail('createServer');

const api = { Socket, TLSSocket, connect, createConnection, createServer };
export default api;
