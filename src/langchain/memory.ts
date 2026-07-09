import { BaseMemory, InputValues, MemoryVariables } from "@langchain/core/memory";

export interface HarmonicIndexEntryLike {
  id: string;
  primary_abstraction: string;
  type: string;
  energy: number;
}

export interface HarmonicIndexLike {
  search(query: string, topK?: number): HarmonicIndexEntryLike[];
}

export interface ParametricStoreLike {
  loadAll(): Array<{ id: string; type: string; rule: string }>;
}

export class MAFWMemory extends BaseMemory {
  lc_namespace = ["mafw", "memory"];

  get memoryKeys(): ["l3_constraints", "hot_memories"] {
    return ["l3_constraints", "hot_memories"] as const;
  }

  constructor(
    private harmonicIndex?: HarmonicIndexLike,
    private parametricStore?: ParametricStoreLike,
  ) {
    super();
  }

  async loadMemoryVariables(_values: InputValues): Promise<MemoryVariables> {
    const hot_memories = this.harmonicIndex
      ? this.harmonicIndex.search("", 5)
          .map((e) => e.primary_abstraction)
          .join("\n")
      : "";

    const l3_constraints = this.parametricStore
      ? this.parametricStore.loadAll()
          .map((c) => `[${c.type}] ${c.rule}`)
          .join("\n")
      : "";

    return { hot_memories, l3_constraints };
  }

  async saveContext(_input: InputValues, _output: Record<string, any>): Promise<void> {
    console.log("[MAFWMemory] Agent output:", JSON.stringify(_output));
  }
}
