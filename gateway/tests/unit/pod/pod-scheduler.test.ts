import { planPromotions, type SchedulerCandidate } from "../../../src/core/pod/pod-scheduler";

const candidate = (goalId: string, over: Partial<SchedulerCandidate> = {}): SchedulerCandidate => ({
  goalId,
  active: false,
  priority: 0,
  enqueuedAt: "2026-11-10T00:00:00.000Z",
  humanAttention: false,
  ...over,
});

describe("planPromotions", () => {
  test("fills normal slots and reserves the human slot for active person goals", () => {
    const normal = planPromotions({
      active: [candidate("a1", { active: true })],
      queued: [candidate("q1"), candidate("q2"), candidate("q3")],
      maxConcurrent: 2,
    });
    expect(normal.start).toEqual(["q1"]);
    expect(normal.capacity).toBe(2);
    expect(normal.waiting).toEqual(["q2", "q3"]);

    const human = planPromotions({
      active: [candidate("a1", { active: true, humanAttention: true })],
      queued: [candidate("q1"), candidate("q2")],
      maxConcurrent: 2,
    });
    expect(human.capacity).toBe(3);
    expect(human.start).toEqual(["q1", "q2"]);
    expect(human.humanSlot).toBe(true);
  });

  test("orders by priority then enqueue time and never starts humans for new goals", () => {
    const plan = planPromotions({
      active: [],
      queued: [
        candidate("low", { priority: 0, enqueuedAt: "2026-11-10T00:00:00.000Z" }),
        candidate("high", { priority: 5, enqueuedAt: "2026-11-10T02:00:00.000Z" }),
        candidate("older", { priority: 0, enqueuedAt: "2026-11-09T00:00:00.000Z" }),
      ],
      maxConcurrent: 2,
    });
    expect(plan.start).toEqual(["high", "older"]);
    expect(plan.humanSlot).toBe(false);
    expect(plan.capacity).toBe(2);
  });
});
