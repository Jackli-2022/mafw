// bun:test API shim for packages whose .ts files tsx compiles to CJS
// (no "type": "module" in their package.json — gateway-sdk today).
// Loaded via require-hook.cjs intercepting require("bun:test").
const { test, it, describe, beforeEach, afterEach, before, after } = require("node:test");
const expectPkg = require("expect");
// expect@29 CJS export: { expect, default, ... } — the callable lives on .expect
const expect = expectPkg.expect ?? expectPkg.default ?? expectPkg;

// bun-specific matchers used in the suites
expect.extend({
  toBeTypeOf(received, type) {
    const pass = typeof received === type;
    return { pass, message: () => `expected type ${typeof received} to be ${type}` };
  },
});

const { fn: jestFn, spyOn: jestSpyOn } = require("jest-mock");

const mock = (impl) => jestFn(impl);
mock.fn = jestFn;
mock.module = () => {
  throw new Error("mock.module: not supported by node shim (no usage in this repo)");
};
mock.restore = () => {};
mock.clearAllMocks = () => {};

const formatName = (template, row) => {
  const args = Array.isArray(row) ? row : [row];
  let i = 0;
  return String(template)
    .replace(/%[sdifjo%]/g, (m) => (m === "%%" ? "%" : String(args[i++] ?? m)))
    .replace(/%p/g, () => String(row));
};
const eachOf = (base) => (cases) => (name, fn) =>
  cases.map((row, idx) =>
    base(formatName(name, row) || `case ${idx}`, () => fn(...(Array.isArray(row) ? row : [row]))),
  );
test.each = eachOf(test);
describe.each = eachOf(describe);

module.exports = {
  test,
  it,
  describe,
  beforeEach,
  afterEach,
  beforeAll: before,
  afterAll: after,
  expect,
  mock,
  spyOn: (obj, method) => jestSpyOn(obj, method),
  jest: { fn: jestFn },
  xtest: test.skip,
  xdescribe: describe.skip,
};
