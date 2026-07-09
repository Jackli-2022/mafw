import { BaseRetriever } from "@langchain/core/retrievers";
import { Document } from "@langchain/core/documents";

export interface HarmonicIndexEntryLike {
  id: string;
  primary_abstraction: string;
  cue_anchors: string[];
  memory_type: string;
  tier: string;
  energy: number;
}

export interface HarmonicIndexLike {
  search(query: string, topK?: number): HarmonicIndexEntryLike[];
}

export class MAFWRetriever extends BaseRetriever {
  lc_namespace = ["mafw", "retriever"];

  private harmonicIndex: HarmonicIndexLike;
  private defaultLimit: number;

  constructor(harmonicIndex: HarmonicIndexLike, defaultLimit: number = 20) {
    super();
    this.harmonicIndex = harmonicIndex;
    this.defaultLimit = defaultLimit;
  }

  async _getRelevantDocuments(query: string): Promise<Document[]> {
    const entries = this.harmonicIndex.search(query, this.defaultLimit);
    return entries.map(entry => new Document({
      pageContent: entry.primary_abstraction,
      metadata: {
        id: entry.id,
        type: entry.memory_type,
        tier: entry.tier,
        energy: entry.energy,
      },
    }));
  }
}
