// خادم ملفات ثابتة بسيط لاختبار نسخة الويب محلياً
// الاستخدام: node web/serve.js [port]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'docs');
const PORT = Number(process.argv[2]) || 8765;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
};

http
  .createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    const file = path.join(ROOT, path.normalize(urlPath).replace(/^([.][.][/\\])+/, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, '127.0.0.1', () => console.log(`serving docs/ at http://127.0.0.1:${PORT}/`));
