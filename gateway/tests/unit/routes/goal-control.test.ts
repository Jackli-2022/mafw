import { handleGoalControl } from "../../../src/routes/goal-control";

function controlDeps() {
  return {
    patchState: jest.fn(async () => {}),
    destroySessions: jest.fn(async () => {}),
    archiveGoal: jest.fn(async () => {}),
    retry: jest.fn(async () => {}),
    startGoal: jest.fn(async () => {}),
    openNextRevision: jest.fn(async () => {}),
  };
}

describe("POST /api/goals/:id/{pause,stop,retry}", () => {
  test("pause/stop/retry are distinct and do not mint revisions", async () => {
    const deps = controlDeps();

    expect((await handleGoalControl({ id: "g1", action: "pause" }, deps)).body).toEqual({ status: "paused" });
    expect(deps.patchState).toHaveBeenCalledWith("g1", { nextAction: "PAUSED" });

    expect((await handleGoalControl({ id: "g1", action: "stop" }, deps)).body).toEqual({ status: "stopped" });
    expect(deps.destroySessions).toHaveBeenCalledWith("g1");
    expect(deps.patchState).toHaveBeenCalledWith("g1", { nextAction: "FAILED", planApproval: null });
    expect(deps.archiveGoal).toHaveBeenCalledWith("g1", expect.objectContaining({ verdict: "CANCELLED" }));

    expect((await handleGoalControl({ id: "g1", action: "retry" }, deps)).body).toEqual({ status: "retried" });
    expect(deps.retry).toHaveBeenCalledWith("g1", undefined);
    expect(deps.openNextRevision).not.toHaveBeenCalled();
  });

  test("retry forwards an explicit run id and validates actions", async () => {
    const deps = controlDeps();
    await handleGoalControl({ id: "g1", action: "retry", runId: 7 }, deps);
    expect(deps.retry).toHaveBeenCalledWith("g1", 7);

    expect((await handleGoalControl({ id: "g1", action: "nope" as any }, deps)).status).toBe(400);
    expect((await handleGoalControl({ id: "", action: "pause" }, deps)).status).toBe(400);
  });
});
