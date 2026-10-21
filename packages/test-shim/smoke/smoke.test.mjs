// SPIKE-derived smoke: exercises the ESM side of the shim through the full
// register hook chain (bun:test specifier -> shim).
import { test, describe, expect, mock, spyOn } from "bun:test";

describe("test-shim (esm)", () => {
  test("expect core matchers incl. bun's toBeTypeOf", () => {
    expect(1).toBe(1);
    expect("x").toBeTypeOf("string");
    expect({ a: 1 }).toEqual({ a: 1 });
  });

  test("mock fn is recognized by jest spy matchers", () => {
    const m = mock();
    m("a", { method: "POST" });
    expect(m).toHaveBeenCalledWith("a", expect.objectContaining({ method: "POST" }));
    expect(m).toHaveBeenCalledTimes(1);
  });

  test("spyOn intercepts and restores", () => {
    const obj = { m: () => 1 };
    const s = spyOn(obj, "m");
    obj.m();
    expect(s).toHaveBeenCalled();
    s.mockRestore();
    expect(obj.m()).toBe(1);
  });

  test.each([
    [1, 2, 3],
    [2, 3, 5],
  ])("each: %s + %s = %s", (a, b, sum) => {
    expect(a + b).toBe(sum);
  });
});
