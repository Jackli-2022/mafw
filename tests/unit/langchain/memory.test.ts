import { MAFWMemory, HarmonicIndexLike, ParametricStoreLike } from "../../../gateway/src/core/langchain/memory";

function makeIndex(entries: Array<{ id: string; primary_abstraction: string; type: string; energy: number }>): jest.Mocked<HarmonicIndexLike> {
  return {
    search: jest.fn().mockReturnValue(entries),
  };
}

function makeStore(rules: Array<{ id: string; type: string; rule: string }>): jest.Mocked<ParametricStoreLike> {
  return {
    loadAll: jest.fn().mockReturnValue(rules),
  };
}

describe("MAFWMemory", () => {
  it("loads hot memories", async () => {
    const entries = [
      { id: "mem_1", primary_abstraction: "hot memory 1", type: "episodic", energy: 0.9 },
      { id: "mem_2", primary_abstraction: "hot memory 2", type: "semantic", energy: 0.7 },
    ];
    const index = makeIndex(entries);
    const memory = new MAFWMemory(index);

    const result = await memory.loadMemoryVariables({});

    expect(result.hot_memories).toBe("hot memory 1\nhot memory 2");
    expect(index.search).toHaveBeenCalledWith("", 5);
  });

  it("loads l3 constraints from parametric store", async () => {
    const rules = [
      { id: "r1", type: "constraint", rule: "use RS256" },
      { id: "r2", type: "boundary", rule: "max 100 chars" },
    ];
    const store = makeStore(rules);
    const memory = new MAFWMemory(undefined, store);

    const result = await memory.loadMemoryVariables({});

    expect(result.l3_constraints).toBe("[constraint] use RS256\n[boundary] max 100 chars");
    expect(store.loadAll).toHaveBeenCalledTimes(1);
  });

  it("returns empty strings when stores missing", async () => {
    const memory = new MAFWMemory();

    const result = await memory.loadMemoryVariables({});

    expect(result.hot_memories).toBe("");
    expect(result.l3_constraints).toBe("");
  });

  it("saveContext stores without error", async () => {
    const memory = new MAFWMemory();
    const consoleSpy = jest.spyOn(require('../../../gateway/src/core/utils/logger').log, 'info').mockImplementation(() => {});

    await expect(memory.saveContext({ input: "hello" }, { output: "world" })).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith("[MAFWMemory] Agent output:", JSON.stringify({ output: "world" }));
    consoleSpy.mockRestore();
  });
});
