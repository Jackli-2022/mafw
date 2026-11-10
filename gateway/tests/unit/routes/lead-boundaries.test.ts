import {
  handleAcceptBoundary,
  handleListBoundaries,
  handleMergeBoundary,
  handleUndoBoundary,
} from "../../../src/routes/lead-boundaries";

function deps(over: Record<string, any> = {}) {
  return {
    service: {
      list: jest.fn(() => [{ id: "b1", fromTopicId: "t1", status: "proposed" }]),
      accept: jest.fn(() => ({ status: "accepted", toTopicId: "t2" })),
      merge: jest.fn(() => ({ status: "merged" })),
      undo: jest.fn(() => ({ status: "undone" })),
      ...over,
    },
  } as any;
}

describe("lead boundary routes", () => {
  test("lists proposals for a topic", () => {
    const out = handleListBoundaries({ id: "t1" }, deps());
    expect(out.status).toBe(200);
    expect(out.body.items).toHaveLength(1);
    expect(handleListBoundaries({ id: "" }, deps()).status).toBe(400);
  });

  test("accept/merge/undo are distinct and scoped to the topic", () => {
    const d = deps();
    expect(handleAcceptBoundary({ id: "t1", bid: "b1" }, d).body)
      .toMatchObject({ status: "accepted", toTopicId: "t2" });
    expect(d.service.accept).toHaveBeenCalledWith("t1", "b1");

    expect(handleMergeBoundary({ id: "t1", bid: "b1" }, d).body).toMatchObject({ status: "merged" });
    expect(handleUndoBoundary({ id: "t1", bid: "b1" }, d).body).toMatchObject({ status: "undone" });
    expect(handleAcceptBoundary({ id: "t1", bid: "" }, d).status).toBe(400);
  });

  test("maps not-found and conflict errors to 404/409", () => {
    const notFound = deps({
      accept: jest.fn(() => {
        throw Object.assign(new Error("boundary not found"), { status: 404 });
      }),
    });
    expect(handleAcceptBoundary({ id: "t1", bid: "b1" }, notFound).status).toBe(404);

    const conflict = deps({
      merge: jest.fn(() => {
        throw Object.assign(new Error("boundary is undone"), { status: 409 });
      }),
    });
    expect(handleMergeBoundary({ id: "t1", bid: "b1" }, conflict).status).toBe(409);
  });
});
