// مصغّر وحدة path — يكفي للاستخدامات داخل المتصفح (أسماء ملفات التنزيل)
export const sep = '/';

export function normalize(p) {
  const absolute = p.startsWith('/');
  const parts = p.split('/').filter((x) => x !== '' && x !== '.');
  const stack = [];
  for (const part of parts) {
    if (part === '..') {
      if (stack.length && stack[stack.length - 1] !== '..') stack.pop();
      else if (!absolute) stack.push('..');
    } else {
      stack.push(part);
    }
  }
  const out = stack.join('/');
  if (absolute) return '/' + out;
  return out || '.';
}

export function join(...parts) {
  return normalize(parts.filter((p) => p !== undefined && p !== null && p !== '').join('/'));
}

export function dirname(p) {
  const cleaned = String(p).replace(/\/+$/, '');
  const idx = cleaned.lastIndexOf('/');
  if (idx < 0) return '.';
  if (idx === 0) return '/';
  return cleaned.slice(0, idx);
}

export function basename(p, ext) {
  let base = String(p).replace(/\/+$/, '').split('/').pop() || '';
  if (ext && base.endsWith(ext) && base !== ext) base = base.slice(0, -ext.length);
  return base;
}

export function extname(p) {
  const base = basename(p);
  const idx = base.lastIndexOf('.');
  return idx > 0 ? base.slice(idx) : '';
}

export function isAbsolute(p) {
  return String(p).startsWith('/');
}

export function resolve(...parts) {
  return join(...parts);
}

export function parse(p) {
  const dir = dirname(p);
  const base = basename(p);
  return { root: '/', dir, base, ext: extname(p), name: base.slice(0, base.length - extname(p).length) };
}

const api = { sep, normalize, join, dirname, basename, extname, isAbsolute, resolve, parse };
export default api;
