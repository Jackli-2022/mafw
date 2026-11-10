import type { MafwMessage } from "../../../src/runtime/canonical-types";
import { compactTopic, summarizeTopic } from "../../../src/core/lead/topic-summary";

const msg = (id: string, role: "user" | "assistant", text: string): MafwMessage => ({
  id,
  role,
  content: [{ type: "text", text } as any],
});

const toolMsg = (id: string, output: string): MafwMessage => ({
  id,
  role: "assistant",
  content: [{ type: "tool", tool: "bash", state: { status: "completed", output } } as any],
});

describe("topic summary", () => {
  test("summary keeps decisions, open loops and user words", () => {
    const long = "并保留原始 transcript 以便回读与审计。".repeat(4);
    const filler = Array.from({ length: 6 }, (_, i) => msg(`f${i}`, "assistant", long));
    const result = compactTopic({
      topicId: "t1",
      messages: [
        msg("m1", "user", `决定：使用 SQLite。${long}`),
        msg("m2", "assistant", `好的，${long}`),
        msg("m3", "user", `待办：补迁移测试。${long}`),
        msg("m4", "assistant", `收到，${long}`),
        ...filler,
        msg("m5", "user", `继续，${long}`),
      ],
      keepRecentTurns: 1,
    });

    expect(result.summary).toContain("决定：使用 SQLite");
    expect(result.summary).toContain("待办：补迁移测试");
    expect(result.summary).toContain("User words:");
    expect(result.evictedMessageIds).not.toContain("m5");
    expect(result.evictedMessageIds).toEqual(expect.arrayContaining(["m1", "m2", "m3"]));
    expect(result.afterTokens).toBeLessThan(result.beforeTokens);
    expect(result.summaryHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("tool output is truncated but failure lines stay", () => {
    const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const result = summarizeTopic([toolMsg("m1", `${long}\nERROR: boom`)]);

    expect(result.summary).toContain("ERROR: boom");
    expect(result.summary.split("\n").length).toBeLessThanOrEqual(12);
  });

  test("drops synthetic text and system messages", () => {
    const synthetic: MafwMessage = {
      id: "m1",
      role: "user",
      content: [
        { type: "text", text: "real question" } as any,
        { type: "text", text: "recalled secret", synthetic: true } as any,
      ],
    };
    const system: MafwMessage = { id: "m2", role: "system" as any, content: [{ type: "text", text: "system prompt" } as any] };

    const result = summarizeTopic([synthetic, system]);
    expect(result.summary).toContain("real question");
    expect(result.summary).not.toContain("recalled secret");
    expect(result.summary).not.toContain("system prompt");
  });

  test("a huge decision line cannot drop open loops or user words", () => {
    const result = summarizeTopic([
      msg("m1", "user", `决定：${"x".repeat(2000)}`),
      msg("m2", "user", "待办：补迁移测试"),
      msg("m3", "user", "继续，别丢用户原话"),
    ], 800);

    expect(result.summary.length).toBeLessThanOrEqual(800);
    expect(result.summary).toContain("Open loops:");
    expect(result.summary).toContain("待办：补迁移测试");
    expect(result.summary).toContain("User words:");
    expect(result.summary).toContain("继续，别丢用户原话");
  });
});
