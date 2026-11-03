// work for tests/parallel.test.mjs: a pure function of one item and shared data
export function square(item, shared) {
  if (item.n < 0) throw new Error('negative');
  let x = 0; for (let i = 0; i < 1e5 * (item.spin || 0); i++) x += i;
  return item.n * item.n + (shared?.plus || 0) + (x < 0 ? 1 : 0);
}
