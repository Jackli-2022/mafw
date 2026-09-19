import { describe, expect, test } from "bun:test";
import { sortAllowlistEntries } from "./ApprovalsSection";

describe("sortAllowlistEntries（tool 字典序，同 tool 无 prefix 在前）", () => {
  test("按 tool 字典序", () => {
    const out = sortAllowlistEntries([{ tool: "edit" }, { tool: "bash", prefix: "git status" }, { tool: "read" }]);
    expect(out).toEqual([{ tool: "bash", prefix: "git status" }, { tool: "edit" }, { tool: "read" }]);
  });
  test("同 tool：无 prefix 在有 prefix 前", () => {
    const out = sortAllowlistEntries([{ tool: "bash", prefix: "npm test" }, { tool: "bash" }, { tool: "bash", prefix: "git status" }]);
    expect(out).toEqual([{ tool: "bash" }, { tool: "bash", prefix: "git status" }, { tool: "bash", prefix: "npm test" }]);
  });
  test("不改输入（非变异）", () => {
    const input = [{ tool: "bash", prefix: "x" }, { tool: "bash" }];
    sortAllowlistEntries(input);
    expect(input).toEqual([{ tool: "bash", prefix: "x" }, { tool: "bash" }]);
  });
});
