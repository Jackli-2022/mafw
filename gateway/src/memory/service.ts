import * as path from "path";
import { HarmonicIndexManager } from "../../../src/memory/harmonic-index";
import { CognitiveGraphManager } from "../../../src/memory/cognitive-graph";

export class MemoryService {
  harmonicIndex: HarmonicIndexManager;
  cognitiveGraph: CognitiveGraphManager;

  constructor(mafwDir: string) {
    this.harmonicIndex = new HarmonicIndexManager(mafwDir);
    this.cognitiveGraph = new CognitiveGraphManager(
      path.join(mafwDir, "data", "knowledge-graph.json")
    );
  }

  search(query: string, topK = 20) {
    return this.harmonicIndex.search(query, topK);
  }
}
