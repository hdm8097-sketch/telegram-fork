/* ============================================================
   بُنية نسخة الويب — تحزم teleproto + الخدمة + الواجهة في
   ملف واحد (docs/app.js) يُنشر على GitHub Pages
   الاستخدام: npm run build:web
   ============================================================ */
'use strict';
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const SHIM_DIR = path.join(__dirname, 'shims');
const DOCS = path.join(ROOT, 'docs');

// وحدات Node → ملفات بديلة (تُطبَّق بعد إزالة بادئة node:)
const SHIM_FILES = {
  fs: 'fs.js',
  path: 'path.js',
  os: 'os.js',
  net: 'net.js',
  tls: 'net.js',
  http: 'http.js',
  https: 'http.js',
  crypto: 'crypto.js',
  zlib: 'zlib.js',
  'timers/promises': 'timers-promises.js',
  socks: 'socks.js',
  'node-localstorage': 'localstorage.js',
};

// وحدات غير متوقعة → بديل يرمي خطأً واضحاً عند الاستدعاء فقط
const NOOP_BUILTINS = new Set([
  'stream', 'string_decoder', 'util', 'assert', 'url', 'child_process',
  'worker_threads', 'dns', 'readline', 'tty', 'constants', 'perf_hooks',
  'v8', 'vm', 'module', 'process', 'punycode', 'querystring', 'domain',
  'cluster', 'repl', 'sys', 'fs/promises',
]);

const nodeShims = {
  name: 'node-shims',
  setup(build) {
    build.onResolve({ filter: /^(?:node:)?[a-z_/-]+$/i }, (args) => {
      const raw = args.path;
      const base = raw.startsWith('node:') ? raw.slice(5) : raw;

      // حزم npm نقية (events) — require.resolve يعود الاسم لأن events مدمجة في Node
      if (base === 'events') {
        return { path: path.join(ROOT, 'node_modules', 'events', 'events.js') };
      }

      if (SHIM_FILES[raw]) return { path: path.join(SHIM_DIR, SHIM_FILES[raw]) };
      if (SHIM_FILES[base]) return { path: path.join(SHIM_DIR, SHIM_FILES[base]) };
      if (NOOP_BUILTINS.has(base)) return { path: path.join(SHIM_DIR, 'noop.js') };

      return null; // حزم أخرى (pako/buffer/store2…) تُحلّ عادياً
    });
  },
};

async function main() {
  fs.mkdirSync(DOCS, { recursive: true });

  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, 'entry.js')],
    outfile: path.join(DOCS, 'app.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome110', 'firefox110', 'safari16'],
    minify: true,
    charset: 'utf8',
    plugins: [nodeShims],
    inject: [path.join(SHIM_DIR, 'inject-globals.js')],
    define: { __WEB__: 'true', global: 'globalThis' },
    loader: { '.json': 'json' },
    logLevel: 'info',
  });

  if (result.errors && result.errors.length) process.exit(1);

  // نسخ الواجهة كما هي (index.html يشير إلى app.js بالفعل)
  const renderer = path.join(ROOT, 'src', 'renderer');
  const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');

  // سياسة أمان مخصّصة للويب: أصلح CSP الأصلي (الموجّه لـElectون) ليسمح
  // باتصال WebSocket مع خوادم تلكرام وعرض الوسائط من blob:
  const WEB_CSP =
    "default-src 'self'; connect-src 'self' wss: https:; " +
    "img-src 'self' blob: data:; media-src 'self' blob:; " +
    "style-src 'self' 'unsafe-inline'; font-src 'self' data:";
  const patched = html.replace(
    /(<meta http-equiv="Content-Security-Policy" content=")[^"]*(")/i,
    `$1${WEB_CSP}$2`
  );
  fs.writeFileSync(path.join(DOCS, 'index.html'), patched, 'utf8');
  fs.copyFileSync(path.join(renderer, 'styles.css'), path.join(DOCS, 'styles.css'));
  fs.writeFileSync(path.join(DOCS, '.nojekyll'), '');

  const size = fs.statSync(path.join(DOCS, 'app.js')).size;
  console.log(`✓ تم البناء: docs/app.js (${(size / 1024).toFixed(0)} كيلوبايت) + index.html + styles.css`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
