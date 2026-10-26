// يُحقن تلقائياً (esbuild inject): يستبدل المعرّفات الحرة Buffer / process
import { Buffer } from 'buffer';

export { Buffer };

export const process = {
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
