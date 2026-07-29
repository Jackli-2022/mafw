import * as path from "path";
import { config } from "../config";
import { HarmonicIndexManager } from "../core/memory/harmonic-index";
import { CognitiveGraphManager } from "../core/memory/cognitive-graph";
import { L5Store } from "../core/memory/l5-store";
import { ParametricStore } from "../core/memory/store";
import { DeltaInjector } from "../core/memory/injector";
import { createMemorySearch, MemoryFact } from "../interceptors/memory-injector";

export class MemoryService {
  harmonicIndex: HarmonicIndexManager;
  cognitiveGraph: CognitiveGraphManager;
  l5: L5Store;
  parametricStore?: ParametricStore;
  deltaInjector?: DeltaInjector;
  private _mergedSearch: ((query: string, maxFacts: number) => Promise<MemoryFact[]>) | null = null;

  constructor(mafwDir: string) {
    this.harmonicIndex = new HarmonicIndexManager(mafwDir);
    this.cognitiveGraph = new CognitiveGraphManager(
      path.join(mafwDir, "data", "knowledge-graph.json")
    );
    this.l5 = new L5Store();
    this.initParametric(mafwDir);
  }

  private initParametric(mafwDir: string) {
    const parametricDir = path.join(mafwDir, 'parametric');
    try {
      if (require('fs').existsSync(parametricDir)) {
        this.parametricStore = new ParametricStore({ baseDir: parametricDir });
        this.deltaInjector = new DeltaInjector();
      }
    } catch {
      // non-fatal
    }
  }

  search(query: string, topK?: number) {
    return this.harmonicIndex.search(query, topK ?? config.search.defaultTopK);
  }

  /** Merged search: L3 parametric deltas + Harmonic Index, sorted by energy */
  async mergedSearch(query: string, maxFacts: number = 5): Promise<MemoryFact[]> {
    if (!this._mergedSearch) {
      this._mergedSearch = createMemorySearch(this.parametricStore, this.deltaInjector, this.harmonicIndex);
    }
    return this._mergedSearch(query, maxFacts);
  }
}
