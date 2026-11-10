import { handleResumeTopic } from "../../../src/routes/lead-topics";
import { PodError } from "../../../src/core/pod/pod-store";

function deps(over: Record<string, any> = {}) {
  return {
    isLeadSession: () => true,
    projectDirForSession: () => "/p",
    topics: { listByProject: () => [], search: () => [], get: () => null, updateSummary: () => {}, setState: () => {} },
    index: { listByTopic: () => [], listByProject: () => [], replaceTopic: () => {} },
    goals: () => [],
    workingSetEnabled: () => true,
    resume: async (id: string) => {
      if (id === "gone") throw new PodError(404, "topic not found");
      if (id === "archived") throw new PodError(409, "topic archived");
      return { sessionID: "ses_lead", resumedFrom: id === "t1" ? null : id };
    },
    ...over,
  } as any;
}

describe("POST /api/lead/topics/:id/resume", () => {
  test("returns the resumed session", async () => {
    const out = await handleResumeTopic({ id: "t1" }, deps());
    expect(out).toMatchObject({ status: 200, body: { sessionID: "ses_lead", resumedFrom: null } });
    expect(JSON.stringify(out.body)).not.toContain("ses_old");
  });

  test("maps service errors to 404/409 and missing deps to 503", async () => {
    expect((await handleResumeTopic({ id: "gone" }, deps())).status).toBe(404);
    expect((await handleResumeTopic({ id: "archived" }, deps())).status).toBe(409);
    expect((await handleResumeTopic({ id: "t1" }, deps({ resume: undefined }))).status).toBe(503);
  });
});
