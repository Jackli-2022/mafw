export interface MAFWConfig {
  version: string;
  storage: {
    backend: 'file' | 'sqlite';
    sqlite?: { path: string; cacheSize: number; cacheTTL: number };
    file?: { basePath: string };
  };
  retrieval: {
    enabled: boolean;
    mode: 'bm25' | 'vector' | 'hybrid' | 'graph';
    bm25?: { k1: number; b: number; topK: number };
    vector?: { model: string; dimensions: number; topK: number };
    graph?: { enabled: boolean; maxDepth: number; topK: number };
    rrf?: { k: number };
    diversification?: { enabled: boolean; maxPerLoop: number };
    tokenBudget: number;
  };
  memory: {
    energy: {
      decayRatePerDay: number;
      cleanupThreshold: number;
      criticalThreshold: number;
    };
    maxMemoriesPerTier: number;
    mergeSimilarityThreshold: number;
  };
  hooks: {
    enabled: string[];
    failBehavior: 'continue' | 'stop';
    timeout: number;
  };
  concurrency: {
    maxParallelWaves: number;
    lockTimeout: number;
    stateSyncInterval: number;
  };
  dashboard: {
    enabled: boolean;
    port: number;
    refreshInterval: number;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    maxFiles: number;
    maxSize: string;
  };
}
