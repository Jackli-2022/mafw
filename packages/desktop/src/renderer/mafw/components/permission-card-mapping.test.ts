import { describe, expect, test } from "bun:test";
import { mapPermissionCard, nextMode, shouldNotify, autoBadgeText } from "./permission-card-mapping";

const baseReq = {
  id: "r1", sessionID: "s1", permission: "bash", patterns: ["npm test"],
  metadata: { impact: "run command" },
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
      { ...baseReq, permission: "unlink", patterns: [], mafwPolicy: { action: "human", verdict: "safe", reason: "" } },
      1, "Agent",
    );
    expect(c.risk).toBe("medium");
  });

  test("pi 形状（toolName/args）经 mafwPolicy 正常合并", () => {
    const c = mapPermissionCard(
      { id: "r2", sessionID: "s1", toolName: "bash", args: { command: "npm test" }, mafwPolicy: { action: "auto-approve", verdict: "safe", reason: "persistent allowlist match" } },
      1, "Agent",
    );
    expect(c.status).toBe("allowed-once");
  });

  test("agentTitle 参数化 + tool.messageID/callID 透传", () => {
    const c = mapPermissionCard({ ...baseReq, tool: { messageID: "m1", callID: "c1" } }, 42, "My Session");
    expect(c.agentName).toBe("My Session");
    expect(c.createdAt).toBe(42);
    expect(c.messageID).toBe("m1");
    expect(c.callID).toBe("c1");
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
