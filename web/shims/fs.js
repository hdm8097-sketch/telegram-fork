// مصغّر وحدة fs — غير قابلة للاستخدام في المتصفح.
// الفروع التي تستدعيها موجودة فقط في مسار Electron وتُستبعد وقت البناء (__WEB__).
const fail = (name) => () => {
  throw new Error(`fs.${name} غير متاح في نسخة الويب`);
};

export class WriteStream {}
export class ReadStream {}

export const createWriteStream = fail('createWriteStream');
export const createReadStream = fail('createReadStream');
export const readFileSync = fail('readFileSync');
export const writeFileSync = fail('writeFileSync');
export const mkdirSync = fail('mkdirSync');
export const rmSync = fail('rmSync');
export const unlinkSync = fail('unlinkSync');
export const statSync = fail('statSync');
export const existsSync = () => false;
export const promises = {
  readFile: fail('readFile'),
  writeFile: fail('writeFile'),
  mkdir: fail('mkdir'),
  unlink: fail('unlink'),
  stat: fail('stat'),
  rm: fail('rm'),
};

const api = {
  WriteStream,
  ReadStream,
  createWriteStream,
  createReadStream,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  unlinkSync,
  statSync,
  existsSync,
  promises,
};

export default api;
