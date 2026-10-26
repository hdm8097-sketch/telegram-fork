// مصغّر node-localstorage (يستخدمه StoreSession غير المستخدم في تطبيقنا)
// — يعمل فوق localStorage على أي حال
export class LocalStorage {
  constructor(prefix = '') { this.prefix = prefix; }
  getItem(key) { return localStorage.getItem(this.prefix + key); }
  setItem(key, value) { localStorage.setItem(this.prefix + key, String(value)); }
  removeItem(key) { localStorage.removeItem(this.prefix + key); }
  clear() { localStorage.clear(); }
  key(i) { return localStorage.key(i); }
  get length() { return localStorage.length; }
}

export default { LocalStorage };
