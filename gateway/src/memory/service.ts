import * as path from "path";
import { HarmonicIndexManager } from "../../../src/memory/harmonic-index";
import { CognitiveGraphManager } from "../../../src/memory/cognitive-graph";
import { L5Store } from "../../../src/memory/l5-store";

export class MemoryService {
  harmonicIndex: HarmonicIndexManager;
  cognitiveGraph: CognitiveGraphManager;
  l5: L5Store;

  constructor(mafwDir: string) {
    this.harmonicIndex = new HarmonicIndexManager(mafwDir);
    this.cognitiveGraph = new CognitiveGraphManager(
      path.join(mafwDir, "data", "knowledge-graph.json")
    );
    this.l5 = new L5Store();
  }

  search(query: string, topK = 20) {
    return this.harmonicIndex.search(query, topK);
  }
}
