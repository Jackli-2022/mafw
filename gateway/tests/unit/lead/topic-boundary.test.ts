import { detectBoundary } from "../../../src/core/lead/topic-boundary";

const NOW = "2026-11-10T12:00:00.000Z";

describe("detectBoundary", () => {
  test("does not propose a boundary while a goal is active", () => {
    expect(detectBoundary({ text: "换个话题，聊 UI", now: NOW, goalActive: true })).toBeNull();
    expect(detectBoundary({ text: "换个话题，聊 UI", now: NOW, goalActive: false }))
      .toMatchObject({ trigger: "explicit", confidence: 0.9 });
    expect(detectBoundary({ text: "好了", now: NOW, goalActive: false, goalJustClosed: true }))
      .toMatchObject({ trigger: "goal_closed", confidence: 0.8 });
  });

  test("proposes idle and semantic at conservative confidence", () => {
    expect(detectBoundary({
      text: "继续",
      now: NOW,
      lastActiveAt: "2026-11-10T11:00:00.000Z",
      goalActive: false,
    })).toMatchObject({ trigger: "idle", confidence: 0.6 });

    expect(detectBoundary({
      text: "天气怎么样",
      previousUserText: "SQLite 迁移计划",
      now: NOW,
      goalActive: false,
    })).toMatchObject({ trigger: "semantic", confidence: 0.5 });
  });

  test("returns null for ordinary continuation", () => {
    expect(detectBoundary({
      text: "SQLite 迁移计划继续",
      previousUserText: "SQLite 迁移计划",
      now: NOW,
      goalActive: false,
    })).toBeNull();
  });
});
