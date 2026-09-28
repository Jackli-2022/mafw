export interface L1QuestionResult {
  question_id: string;
  question_type: string;
  question: string;
  answer: string | string[];
  question_date: string;
  is_abstention: boolean;
  unit_count: number;
  recall: Record<number, number>;
  ndcg: Record<number, number>;
  top_sessions: string[];
  top_contexts: string[];
  top_scores: number[];
  /**
   * R6 presentation: chronological neighbours of the top hits (abstractions),
   * bundled into the reader context as extra sessions. Never ranked — the L1
   * metric is blind to them by construction.
   */
  neighbor_contexts?: string[];
}

export interface L1Summary {
  timestamp: string;
  config: {
    samplePerType: number;
    seed: number;
    granularity: string;
    energyMode: string;
    retriever: string;
    ks: number[];
  };
  overall: Record<string, number>;
  by_type: Record<string, { count: number; recall: Record<string, number>; ndcg: Record<string, number> }>;
}

export interface L2QuestionResult {
  question_id: string;
  question_type: string;
  is_abstention: boolean;
  question: string;
  reference_answer: string | string[];
  reader_answer: string;
  judge_score: number;
  judge_reason: string;
  top_k_used: number;
}
