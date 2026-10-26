// مصغّر os — يُستخدم لبيانات الجهاز في بداية الاتصال
export function type() { return 'Browser'; }
export function release() { return '1.0'; }
export function platform() { return 'browser'; }
export function arch() { return 'wasm32'; }
export function homedir() { return '/'; }
export function tmpdir() { return '/tmp'; }
export function hostname() { return 'browser'; }
export const EOL = '\n';

const api = { type, release, platform, arch, homedir, tmpdir, hostname, EOL };
export default api;
