import {
  handleGoalControl,
  pauseStatePatch,
  resumeStatePatch,
  selectRetryRun,
  type GoalControlDeps,
} from "../../../src/routes/goal-control";

function controlDeps(over: Partial<GoalControlDeps> = {}): GoalControlDeps {
  return {
    hasGoal: jest.fn(() => true),
    patchState: jest.fn(async () => {}),
    pause: jest.fn(async () => {}),
    resume: jest.fn(async () => {}),
    destroySessions: jest.fn(async () => {}),
    archiveGoal: jest.fn(async () => {}),
    retry: jest.fn(async () => {}),
    startGoal: jest.fn(async () => {}),
    ...over,
  } as GoalControlDeps;
}

describe("POST /api/goals/:id/{pause,resume,stop,retry}", () => {
  test("pause/stop/retry are distinct and do not mint revisions", async () => {
    const deps = controlDeps();

    expect((await handleGoalControl({ id: "g1", action: "pause" }, deps)).body).toEqual({ status: "paused" });
    expect(deps.pause).toHaveBeenCalledWith("g1");

    expect((await handleGoalControl({ id: "g1", action: "stop" }, deps)).body).toEqual({ status: "stopped" });
    expect(deps.destroySessions).toHaveBeenCalledWith("g1");
    expect(deps.patchState).toHaveBeenCalledWith("g1", { nextAction: "FAILED", planApproval: null });
    expect(deps.archiveGoal).toHaveBeenCalledWith("g1", expect.objectContaining({ verdict: "CANCELLED" }));

    expect((await handleGoalControl({ id: "g1", action: "retry" }, deps)).body).toEqual({ status: "retried" });
    expect(deps.retry).toHaveBeenCalledWith("g1", undefined);
  });

  test("resume restores the persisted pre-pause state", async () => {
    const deps = controlDeps();
    expect((await handleGoalControl({ id: "g1", action: "resume" }, deps)).body).toEqual({ status: "resumed" });
    expect(deps.resume).toHaveBeenCalledWith("g1");
  });

  test("retry forwards an explicit run id and validates actions", async () => {
    const deps = controlDeps();
    await handleGoalControl({ id: "g1", action: "retry", runId: 7 }, deps);
    expect(deps.retry).toHaveBeenCalledWith("g1", 7);

    expect((await handleGoalControl({ id: "g1", action: "nope" as any }, deps)).status).toBe(400);
    expect((await handleGoalControl({ id: "", action: "pause" }, deps)).status).toBe(400);
  });

  test("missing goals are 404 and dependency conflicts are 409", async () => {
    const missing = controlDeps({ hasGoal: jest.fn(() => false) });
    expect((await handleGoalControl({ id: "g1", action: "pause" }, missing)).status).toBe(404);

    const terminal = controlDeps({ terminal: jest.fn(() => true) });
    expect((await handleGoalControl({ id: "g1", action: "retry" }, terminal)).status).toBe(409);

    const conflict = controlDeps({
      resume: jest.fn(async () => {
        throw Object.assign(new Error("goal is not paused"), { status: 409 });
      }),
    });
    expect((await handleGoalControl({ id: "g1", action: "resume" }, conflict)).status).toBe(409);
  });
});

describe("pause/resume state patches", () => {
  test("round-trip the phase and next action", () => {
    const paused = pauseStatePatch(
      { phase: "EXECUTING", nextAction: "RUNNING_execute" },
      "2026-11-10T00:00:00.000Z",
    );
    expect(paused).toMatchObject({
      phase: "PAUSED",
      nextAction: "PAUSED",
      _resumePhase: "EXECUTING",
      _resumeNextAction: "RUNNING_execute",
    });

    expect(resumeStatePatch(paused)).toMatchObject({
      phase: "EXECUTING",
      nextAction: "RUNNING_execute",
      _resumePhase: null,
      _resumeNextAction: null,
    });
    expect(resumeStatePatch({ nextAction: "RUNNING_execute" })).toBeNull();

    expect(pauseStatePatch({
      phase: "PAUSED",
      nextAction: "PAUSED",
      _resumePhase: "EXECUTING",
      _resumeNextAction: "RUNNING_execute",
    }, "2026-11-10T00:01:00.000Z")).toMatchObject({
      _resumePhase: "EXECUTING",
      _resumeNextAction: "RUNNING_execute",
    });
  });
});

describe("selectRetryRun", () => {
  const runs = [
    { id: 1, revision: 1, status: "completed" },
    { id: 2, revision: 1, status: "failed" },
    { id: 3, revision: 2, status: "failed" },
  ];

  test("picks the latest failed run in the active revision", () => {
    expect(selectRetryRun(runs, 1)).toEqual({ ok: true, runId: 2 });
    expect(selectRetryRun([...runs, { id: 4, revision: 1, status: "aborted" }], 1))
      .toEqual({ ok: true, runId: 4 });
  });

  test("rejects successful/foreign runs and revisions without a failure", () => {
    expect(selectRetryRun(runs, 1, 1)).toMatchObject({ ok: false, status: 409 });
    expect(selectRetryRun(runs, 1, 3)).toMatchObject({ ok: false, status: 404 });
    expect(selectRetryRun([{ id: 1, revision: 1, status: "completed" }], 1))
      .toMatchObject({ ok: false, status: 409 });
  });
});
