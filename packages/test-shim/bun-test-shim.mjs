// bun:test API shim over node:test + jest expect + jest-mock (ESM side).
// Lifted verbatim from the validated spike (packages/desktop/.spike), which
// ran desktop 1033/1041, gateway-sdk 131/133, session-ui 71/71, ui 8/8.
export { test, it, describe, beforeEach, afterEach } from "node:test";
export { before as beforeAll, after as afterAll } from "node:test";
import { test, describe } from "node:test";

import { expect } from "expect";
export { expect };

// bun-specific matchers used in the suites
expect.extend({
  toBeTypeOf(received, type) {
    const pass = typeof received === type;
    return { pass, message: () => `expected type ${typeof received} to be ${type}` };
  },
});

import { fn as jestFn, spyOn as jestSpyOn } from "jest-mock";

// bun:test: mock(impl?) -> jest-style mock fn.
// Use jest-mock directly: node:test mock fns are Proxies whose .mock property
// cannot be overridden, so wrapping them never works (spike finding).
export const mock = (impl) => jestFn(impl);
mock.fn = jestFn;
mock.module = () => {
  throw new Error("mock.module: not supported by node shim (no usage in this repo)");
};
mock.restore = () => {};
mock.clearAllMocks = () => {};

export const spyOn = (obj, method) => jestSpyOn(obj, method);

// bun:test: test.each(cases)(name, fn) / describe.each
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

// bun:test compat extras
export const jest = { fn: jestFn };
export const setSystemTime = () => {
  throw new Error("setSystemTime: not supported by node shim");
};
export const xtest = test.skip;
export const xdescribe = describe.skip;
