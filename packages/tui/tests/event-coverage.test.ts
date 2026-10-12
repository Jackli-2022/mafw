// TUI 第四道弱守卫：KNOWN_EVENTS（精确订阅白名单）必须 ⊆ @mafw/sdk 事件 union。
// TUI 无编译期穷尽检查（desktop 的 assertShellEventCoverage 不适用于此处），
// 词汇替换时此测试是 TUI 侧唯一的系统性指路——改名后白名单里的旧词立即变红。
import test from "node:test";
import assert from "node:assert/strict";
import { KNOWN_EVENTS } from "../src/store/connection.ts";
import { RUNTIME_EVENT_TYPES, FLAT_EVENT_TYPES } from "@mafw/sdk";

test("KNOWN_EVENTS all exist in the SDK event union", () => {
  const union = new Set<string>([...RUNTIME_EVENT_TYPES, ...FLAT_EVENT_TYPES]);
  for (const e of KNOWN_EVENTS) {
    assert.ok(union.has(e), `KNOWN_EVENTS member not in SDK union (stale event name?): ${e}`);
  }
});
