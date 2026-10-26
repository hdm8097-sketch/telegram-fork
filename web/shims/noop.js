// بديل فارغ لأي وحدة Node غير متوقعة — يمنع فشل البناء بصمت مريب
const fail = (name) => () => {
  throw new Error(`وحدة Node "${name}" غير متاحة في المتصفح`);
};

export default new Proxy(
  {},
  {
    get: (t, prop) => {
      if (prop === '__esModule') return false;
      if (typeof prop !== 'string') return undefined;
      return fail(prop);
    },
  }
);
