import { describe, expect, test } from "bun:test";
import { mapPermissionCard, nextMode, shouldNotify, autoBadgeText, permissionPayloadOf } from "./permission-card-mapping";

// 规范 `MafwPermissionRequest`（gateway 投影后的形状）：id/kind/targets 是权威字段。
const baseReq = {
  id: "r1",
  sessionID: "s1",
  kind: "bash",
  targets: ["npm test"],
  extensions: { impact: "run command" },
};

describe("mapPermissionCard — mafwPolicy 合并", () => {
  test("无 mafwPolicy → pending + 本地 risk 启发式", () => {
    const c = mapPermissionCard(baseReq, 1, "Agent");
    expect(c.status).toBe("pending");
    expect(c.autoResolved).toBeUndefined();
    expect(c.risk).toBe("medium");
  });

  test("auto-approve → allowed-once + autoResolved:auto", () => {
    const c = mapPermissionCard({ ...baseReq, mafwPolicy: { action: "auto-approve", verdict: "safe", reason: "auto mode (1/25)" } }, 1, "Agent");
    expect(c.status).toBe("allowed-once");
    expect(c.autoResolved).toBe("auto");
  });

  test("auto-deny → denied + autoResolved:internal", () => {
    const c = mapPermissionCard({ ...baseReq, mafwPolicy: { action: "auto-deny", verdict: "safe", reason: "internal session" } }, 1, "Agent");
    expect(c.status).toBe("denied");
    expect(c.autoResolved).toBe("internal");
  });

  test("human + verdict dangerous → pending + risk high（gateway 判定优先于本地启发式）", () => {
    const c = mapPermissionCard({ ...baseReq, mafwPolicy: { action: "human", verdict: "dangerous", reason: "dangerous command pattern" } }, 1, "Agent");
    expect(c.status).toBe("pending");
    expect(c.risk).toBe("high");
  });

  test("human + verdict safe → pending + risk medium（即使本地启发式判 high）", () => {
    const c = mapPermissionCard(
      { ...baseReq, kind: "unlink", targets: [], mafwPolicy: { action: "human", verdict: "safe", reason: "" } },
      1, "Agent",
    );
    expect(c.risk).toBe("medium");
  });
});

describe("mapPermissionCard — 规范字段是唯一来源（review I1/I2）", () => {
  test("pi 权限请求 fixture：id 取自 requestId、正文展示真实命令（不是 'shell'）", () => {
    // gateway 投影后的形状（pi 原生 {requestId, toolName:'shell', args:{command}}）
    const piProjected = {
      id: "6f1c2a9e-pi-request",
      sessionID: "s-pi",
      kind: "bash",
      targets: ["rm -rf build"],
      suggestedRule: { scope: "tool", value: "shell" },
      extensions: { risk: "medium" },
      mafwPolicy: { action: "human", verdict: "dangerous", reason: "rm pattern" },
    };
    const c = mapPermissionCard(piProjected, 7, "Builder");
    expect(c.id).toBe("6f1c2a9e-pi-request"); // 不再是 undefined（审批答复有 requestId）
    expect(c.action.type).toBe("shell");
    expect(c.action.payload).toBe("rm -rf build"); // 不是工具名
    expect(c.action.dangerousParts).toEqual(["rm -rf build"]);
    expect(c.risk).toBe("high");
  });

  test("opencode 权限请求 fixture：patterns → targets、permission → kind", () => {
    const c = mapPermissionCard(
      { id: "perm_1", sessionID: "s1", kind: "edit", targets: ["src/a.ts"], mafwPolicy: { action: "human", verdict: "safe" } },
      1, "Agent",
    );
    expect(c.id).toBe("perm_1");
    expect(c.action.type).toBe("file-write");
    expect(c.action.payload).toBe("src/a.ts");
  });

  test("不读原生 permission/patterns/toolName/args（原生形状不会误配或丢 id）", () => {
    const c = mapPermissionCard(
      { permission: "bash", patterns: ["npm test"], toolName: "shell", args: { command: "ls" }, sessionID: "s1" } as any,
      1, "Agent",
    );
    // 没有规范 id → 空串（绝不是 undefined），且不把原始工具名当命令正文
    expect(c.id).toBe("");
    expect(c.action.payload).not.toBe("npm test");
    expect(c.action.payload).not.toBe("ls");
  });

  test("tool 指针与 createdAt 透传", () => {
    const c = mapPermissionCard({ ...baseReq, tool: { messageID: "m1", callID: "c1" } }, 42, "My Session");
    expect(c.agentName).toBe("My Session");
    expect(c.createdAt).toBe(42);
    expect(c.messageID).toBe("m1");
    expect(c.callID).toBe("c1");
  });

  test("extension impact 进卡片；targets 空时展示 kind 兜底", () => {
    const c = mapPermissionCard({ id: "x", sessionID: "s", kind: "webfetch", targets: [], extensions: { impact: "打开网页" } }, 1, "A");
    expect(c.impact).toBe("打开网页");
    expect(c.action.payload).toBe("webfetch");
    expect(permissionPayloadOf("webfetch", ["https://x"])).toBe("https://x");
  });
});

describe("migration helpers（T11 消费）", () => {
  test("nextMode 三档循环", () => {
    expect(nextMode("read-only")).toBe("auto");
    expect(nextMode("auto")).toBe("full-access");
    expect(nextMode("full-access")).toBe("read-only");
  });
  test("nextMode legacy manual / 未知值 → auto（read-only 的下一档）", () => {
    expect(nextMode("manual")).toBe("auto");
    expect(nextMode("yolo")).toBe("auto");
  });
  test("shouldNotify：autoResolved 卡不发通知；human 卡发", () => {
    expect(shouldNotify({ autoResolved: "auto" })).toBe(false);
    expect(shouldNotify({ autoResolved: "internal" })).toBe(false);
    expect(shouldNotify({})).toBe(true);
  });
});

describe("autoBadgeText（T12 徽标文案）", () => {
  test("auto → 已自动放行", () => {
    expect(autoBadgeText("auto")).toBe("已自动放行");
  });
  test("internal → 已自动拒绝 · 内部", () => {
    expect(autoBadgeText("internal")).toBe("已自动拒绝 · 内部");
  });
  test("undefined → null（走既有徽标文案）", () => {
    expect(autoBadgeText(undefined)).toBeNull();
  });
});
