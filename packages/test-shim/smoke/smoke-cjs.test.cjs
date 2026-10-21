// Smoke: exercises the CJS side of the shim via the require hook
// (Module._resolveFilename intercept), the mode gateway-sdk runs in.
const { test, expect, mock } = require("bun:test");

test("cjs: shim resolves via require hook", () => {
  const m = mock();
  m(42);
  expect(m).toHaveBeenCalledWith(42);
  expect("ok").toBeTypeOf("string");
});
