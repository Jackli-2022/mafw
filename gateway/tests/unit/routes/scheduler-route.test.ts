import { handleSchedulerStatus } from "../../../src/routes/scheduler";

describe("GET /api/scheduler/status", () => {
  test("returns slots and plan for the project Pod", () => {
    const out = handleSchedulerStatus({ projectDir: "/p" }, {
      status: () => ({
        capacity: 2,
        active: ["a1"],
        queued: ["q1"],
        plan: { start: ["q1"], waiting: [], humanSlot: false, capacity: 2 },
      }),
    });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ capacity: 2, active: ["a1"], queued: ["q1"] });
  });

  test("404s when the project has no Pod", () => {
    expect(handleSchedulerStatus({ projectDir: "/p" }, { status: () => null }).status).toBe(404);
  });
});
