import {
  handleAcceptBoundary,
  handleListBoundaries,
  handleMergeBoundary,
  handleUndoBoundary,
} from "../../../src/routes/lead-boundaries";

function deps() {
  return {
    service: {
      list: () => [{ id: "b1", fromTopicId: "t1", status: "proposed" }],
      accept: jest.fn(() => ({ status: "accepted", toTopicId: "t2" })),
      merge: jest.fn(() => ({ status: "merged" })),
      undo: jest.fn(() => ({ status: "undone" })),
    },
  } as any;
}

describe("lead boundary routes", () => {
  test("lists proposals for a topic", () => {
    const out = handleListBoundaries({ id: "t1" }, deps());
    expect(out.status).toBe(200);
    expect(out.body.items).toHaveLength(1);
  });

  test("accept/merge/undo are distinct", () => {
    expect(handleAcceptBoundary({ id: "t1", bid: "b1" }, deps()).body)
      .toMatchObject({ status: "accepted", toTopicId: "t2" });
    expect(handleMergeBoundary({ id: "t1", bid: "b1" }, deps()).body).toMatchObject({ status: "merged" });
    expect(handleUndoBoundary({ id: "t1", bid: "b1" }, deps()).body).toMatchObject({ status: "undone" });
  });
});
