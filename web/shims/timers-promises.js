// مصغّر node:timers/promises — يعمل فعلياً عبر مؤقتات المتصفح
// (يُستخدم في حلقة التحديثات وإعادة الاتصال داخل teleproto)

export function setTimeout(ms, value, options) {
  return new Promise((resolve, reject) => {
    const handle = globalThis.setTimeout(() => resolve(value), Number(ms) || 0);
    const signal = options && options.signal;
    if (signal) {
      if (signal.aborted) {
        globalThis.clearTimeout(handle);
        reject(signal.reason || new Error('Aborted'));
        return;
      }
      signal.addEventListener(
        'abort',
        () => {
          globalThis.clearTimeout(handle);
          reject(signal.reason || new Error('Aborted'));
        },
        { once: true }
      );
    }
  });
}

export function clearTimeout(handle) {
  globalThis.clearTimeout(handle);
}

export function setInterval(ms, value, options) {
  const iter = {
    [Symbol.asyncIterator]() { return iter; },
    next() { return setTimeout(ms, { value, done: false }, options); },
    return() {
      globalThis.clearInterval(handle);
      return Promise.resolve({ done: true, value: undefined });
    },
  };
  const handle = globalThis.setInterval(() => {}, 1); // مطابق لسلوك node: يبدأ فوراً
  globalThis.clearInterval(handle);
  return iter;
}

export function clearInterval(handle) {
  globalThis.clearInterval(handle);
}
