// نقطة دخول نسخة الويب — الترتيب مهم:
// 1) تهيئة globals (Buffer/process) 2) جسر window.tg 3) منطق الواجهة
import './setup.js';
import './bridge.js';
import '../src/renderer/app.js';
