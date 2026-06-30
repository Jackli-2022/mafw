# MAFW v5.0 架构详细展开

> 对 MAFW_Architecture_v5.0.md 中所有待决策项和需要细化部分的完整展开。

---

## 目录

1. [检索系统实现](#1-检索系统实现)
2. [记忆压缩策略](#2-记忆压缩策略)
3. [隐私过滤机制](#3-隐私过滤机制)
4. [存储后端选型](#4-存储后端选型)
5. [知识图谱索引](#5-知识图谱索引)
6. [多 Agent 并发同步](#6-多-agent-并发同步)
7. [上下文注入详细代码](#7-上下文注入详细代码)
8. [Dashboard UI 设计](#8-dashboard-ui-设计)
9. [Loop/Wave 状态机](#9-loopwave-状态机)
10. [记忆压缩算法](#10-记忆压缩算法)
11. [Energy 系统数学模型](#11-energy-系统数学模型)
12. [Token Budget 分配算法](#12-token-budget-分配算法)
13. [Hook 实现细节](#13-hook-实现细节)
14. [错误处理与重试](#14-错误处理与重试)
15. [配置系统](#15-配置系统)

---

## 1. 检索系统实现

### 1.1 方案对比

| 方案 | 实现复杂度 | 召回率 | 成本 | 推荐场景 |
|------|-----------|--------|------|---------|
| **纯 LLM 语义搜索** | 低 | 中 | 高(API) | 快速原型 |
| **BM25 + Vector** | 中 | 高 | 低 | 生产环境 |
| **BM25 + Vector + Graph** | 高 | 极高 | 中 | 复杂知识关联 |

### 1.2 推荐方案：BM25 + Vector + RRF

```
┌─────────────────────────────────────────────────────────────┐
│                    mafw_search_hybrid                         │
│                                                             │
│  Query: "JWT 认证配置"                                       │
│       │                                                     │
│       ├─────────────────┬─────────────────┐               │
│       ▼                 ▼                 ▼               │
│  ┌─────────┐      ┌─────────┐      ┌─────────┐           │
│  │  BM25   │      │ Vector  │      │  Graph  │           │
│  │ 索引    │      │ 索引    │      │ 索引    │           │
│  │         │      │         │      │         │           │
│  │ • 词干  │      │ • 嵌入  │      │ • 实体  │           │
│  │ • 同义  │      │ • 余弦  │      │ • 关系  │           │
│  │ • 权重  │      │ • 相似  │      │ • BFS   │           │
│  └────┬────┘      └────┬────┘      └────┬────┘           │
│       │                 │                 │               │
│       └─────────────────┴─────────────────┘               │
│                         │                                   │
│                         ▼                                   │
│              ┌─────────────────┐                           │
│              │   RRF 融合      │                           │
│              │   k=60          │                           │
│              │                 │                           │
│              │ score = Σ 1/(k+r) │                         │
│              │                 │                           │
│              └────────┬────────┘                           │
│                       │                                     │
│                       ▼                                     │
│              ┌─────────────────┐                           │
│              │ Session 去重   │                           │
│              │ 每 Loop 最多 3  │                           │
│              │               │                           │
│              └────────┬────────┘                           │
│                       │                                     │
│                       ▼                                     │
│              ┌─────────────────┐                           │
│              │ Token 截断      │                           │
│              │ 按 budget 截断 │                           │
│              └─────────────────┘                           │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 BM25 实现

```typescript
// 基于 lunr.js 或自建倒排索引
class BM25Index {
  private invertedIndex: Map<string, Set<string>> = new Map();
  private docLengths: Map<string, number> = new Map();
  private avgDocLength: number = 0;
  private k1: number = 1.2;
  private b: number = 0.75;

  addDocument(id: string, text: string) {
    const tokens = this.tokenize(text);
    const docLength = tokens.length;
    this.docLengths.set(id, docLength);

    for (const token of tokens) {
      if (!this.invertedIndex.has(token)) {
        this.invertedIndex.set(token, new Set());
      }
      this.invertedIndex.get(token)!.add(id);
    }

    this.updateAvgDocLength();
  }

  search(query: string, topK: number = 10): Array<{id: string, score: number}> {
    const tokens = this.tokenize(query);
    const scores = new Map<string, number>();
    const N = this.docLengths.size;

    for (const token of tokens) {
      const docs = this.invertedIndex.get(token);
      if (!docs) continue;

      const df = docs.size;
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

      for (const docId of docs) {
        const docLength = this.docLengths.get(docId) || 0;
        const tf = this.getTermFreq(docId, token);
        const score = idf * (tf * (this.k1 + 1)) / 
          (tf + this.k1 * (1 - this.b + this.b * docLength / this.avgDocLength));

        scores.set(docId, (scores.get(docId) || 0) + score);
      }
    }

    return Array.from(scores.entries())
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  private tokenize(text: string): string[] {
    return text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2)
      .map(t => this.stem(t));
  }

  private stem(word: string): string {
    // Porter Stemmer 简化版
    // 或使用 natural.js 的 stemmer
    return word.replace(/(ing|ed|s|es)$/, '');
  }

  private updateAvgDocLength() {
    const lengths = Array.from(this.docLengths.values());
    this.avgDocLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  }

  private getTermFreq(docId: string, term: string): number {
    // 从 invertedIndex 统计
    const docs = this.invertedIndex.get(term);
    if (!docs || !docs.has(docId)) return 0;
    // 简化：假设每个 doc 中 term 出现 1 次
    // 实际应存储完整词频
    return 1;
  }
}
```

### 1.4 Vector 索引实现

```typescript
// 使用 transformers.js 本地嵌入
import { pipeline } from '@xenova/transformers';

class VectorIndex {
  private embedder: any;
  private vectors: Map<string, Float32Array> = new Map();
  private initialized: boolean = false;

  async init() {
    // 使用 all-MiniLM-L6-v2，384 维，无需 API key
    this.embedder = await pipeline('feature-extraction', 
      'Xenova/all-MiniLM-L6-v2');
    this.initialized = true;
  }

  async addDocument(id: string, text: string) {
    if (!this.initialized) await this.init();
    const embedding = await this.embed(text);
    this.vectors.set(id, embedding);
  }

  async search(query: string, topK: number = 10): Array<{id: string, score: number}> {
    if (!this.initialized) await this.init();
    const queryVec = await this.embed(query);

    const results: Array<{id: string, score: number}> = [];
    for (const [id, vec] of this.vectors) {
      const score = this.cosineSimilarity(queryVec, vec);
      results.push({ id, score });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  private async embed(text: string): Promise<Float32Array> {
    const output = await this.embedder(text, { pooling: 'mean', normalize: true });
    return output.data;
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
```

### 1.5 RRF 融合算法

```typescript
function reciprocalRankFusion(
  bm25Results: Array<{id: string, score: number}>,
  vectorResults: Array<{id: string, score: number}>,
  graphResults: Array<{id: string, score: number}> = [],
  k: number = 60
): Array<{id: string, score: number}> {
  const scores = new Map<string, number>();

  // 为每个结果列表中的文档计算 RRF 分数
  const processList = (results: Array<{id: string}>) => {
    results.forEach((item, rank) => {
      const current = scores.get(item.id) || 0;
      scores.set(item.id, current + 1 / (k + rank + 1));
    });
  };

  processList(bm25Results);
  processList(vectorResults);
  if (graphResults.length > 0) processList(graphResults);

  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}
```

### 1.6 Session 去重策略

```typescript
function diversifyByLoop(
  results: Array<{id: string, loopNum: number}>,
  maxPerLoop: number = 3,
  topK: number = 10
): Array<{id: string}> {
  const loopCounts = new Map<number, number>();
  const diversified: Array<{id: string}> = [];

  for (const result of results) {
    const count = loopCounts.get(result.loopNum) || 0;
    if (count < maxPerLoop) {
      diversified.push({ id: result.id });
      loopCounts.set(result.loopNum, count + 1);
    }
    if (diversified.length >= topK) break;
  }

  return diversified;
}
```

### 1.7 检索配置

```typescript
// .mafw/config.json
{
  "retrieval": {
    "enabled": true,
    "mode": "hybrid",  // "bm25" | "vector" | "hybrid" | "graph"
    "bm25": {
      "k1": 1.2,
      "b": 0.75,
      "topK": 20
    },
    "vector": {
      "model": "Xenova/all-MiniLM-L6-v2",
      "dimensions": 384,
      "topK": 20
    },
    "graph": {
      "enabled": false,  // 默认关闭，需要时开启
      "maxDepth": 2,
      "topK": 10
    },
    "rrf": {
      "k": 60
    },
    "diversification": {
      "enabled": true,
      "maxPerLoop": 3
    },
    "tokenBudget": 2000
  }
}
```

---

## 2. 记忆压缩策略

### 2.1 压缩触发条件

```typescript
interface CompressionTrigger {
  // 条件 1: 观察数量阈值
  minObservations: number;      // 默认 5

  // 条件 2: 重要性阈值
  minImportance: number;        // 默认 5 (0-10)

  // 条件 3: 时间阈值
  maxAgeMinutes: number;        // 默认 30

  // 条件 4: 会话结束强制压缩
  forceOnSessionEnd: boolean;   // 默认 true

  // 条件 5: 内存压力
  maxObservationsBeforeForce: number; // 默认 50
}
```

### 2.2 压缩策略分级

| 策略 | 成本 | 质量 | 适用场景 |
|------|------|------|---------|
| **Zero-token (规则)** | 0 | 中 | 高频、模式固定的观察 |
| **Diff-based** | 0 | 高 | 文件修改类观察 |
| **Template-based** | 0 | 中 | 已知模式匹配 |
| **LLM (轻量)** | 低 | 高 | 一般观察 |
| **LLM (完整)** | 高 | 极高 | 复杂、高重要性观察 |

### 2.3 Zero-token 压缩实现

```typescript
// 零 token 压缩：基于规则的提取，无需 LLM
class ZeroTokenCompressor {
  private rules: Array<{
    pattern: RegExp;
    extractor: (match: RegExpMatchArray) => object;
  }> = [
    // 规则 1: 测试覆盖率
    {
      pattern: /coverage\s+([\d.]+)%/i,
      extractor: (m) => ({
        type: 'metric',
        fact: `coverage ${m[1]}%`,
        concept: 'coverage'
      })
    },
    // 规则 2: 错误模式
    {
      pattern: /Error:\s+(.+)/,
      extractor: (m) => ({
        type: 'error',
        fact: `Error: ${m[1]}`,
        concept: 'error'
      })
    },
    // 规则 3: 文件修改
    {
      pattern: /modified\s+(.+?):\s+(.+)/i,
      extractor: (m) => ({
        type: 'file_change',
        fact: `Modified ${m[1]}: ${m[2]}`,
        concept: 'file-edit'
      })
    },
    // 规则 4: 工具调用
    {
      pattern: /Tool\s+(\w+)\s+executed/i,
      extractor: (m) => ({
        type: 'tool_use',
        fact: `Tool used: ${m[1]}`,
        concept: m[1].toLowerCase()
      })
    }
  ];

  compress(observations: Observation[]): CompressedMemory[] {
    const memories: CompressedMemory[] = [];

    for (const obs of observations) {
      for (const rule of this.rules) {
        const match = obs.content.match(rule.pattern);
        if (match) {
          const extracted = rule.extractor(match);
          memories.push({
            id: generateId(),
            sourceObservationId: obs.id,
            ...extracted,
            timestamp: obs.timestamp,
            loopNum: obs.loopNum,
            energy: 0.5
          });
          break; // 一个观察只匹配第一个规则
        }
      }
    }

    return memories;
  }
}
```

### 2.4 Diff-based 压缩

```typescript
// 针对文件修改的 diff 压缩
class DiffCompressor {
  compress(fileChanges: FileChangeObservation[]): CompressedMemory {
    // 1. 提取修改的文件列表
    const files = [...new Set(fileChanges.map(c => c.filePath))];

    // 2. 统计修改类型
    const stats = {
      added: fileChanges.filter(c => c.type === 'add').length,
      modified: fileChanges.filter(c => c.type === 'modify').length,
      deleted: fileChanges.filter(c => c.type === 'delete').length
    };

    // 3. 提取关键修改（含特定关键词）
    const keyChanges = fileChanges
      .filter(c => /(auth|jwt|security|config|api)/i.test(c.diff))
      .map(c => ({
        file: c.filePath,
        summary: this.summarizeDiff(c.diff)
      }));

    return {
      type: 'file_changes',
      facts: [
        `Modified ${files.length} files: ${files.join(', ')}`,
        `Changes: +${stats.added} ~${stats.modified} -${stats.deleted}`,
        ...keyChanges.map(c => `Key change in ${c.file}: ${c.summary}`)
      ],
      concepts: this.extractConcepts(fileChanges),
      energy: 0.5
    };
  }

  private summarizeDiff(diff: string): string {
    // 提取 diff 中的函数名、类名等关键信息
    const functions = diff.match(/^[\+\-].*function\s+(\w+)/gm) || [];
    const classes = diff.match(/^[\+\-].*class\s+(\w+)/gm) || [];

    if (functions.length > 0) {
      return `Modified functions: ${functions.slice(0, 3).join(', ')}`;
    }
    if (classes.length > 0) {
      return `Modified classes: ${classes.join(', ')}`;
    }
    return 'General modifications';
  }

  private extractConcepts(changes: FileChangeObservation[]): string[] {
    const concepts = new Set<string>();
    for (const change of changes) {
      if (/\.test\./.test(change.filePath)) concepts.add('testing');
      if (/\.config\./.test(change.filePath)) concepts.add('configuration');
      if (/auth|jwt|login|password/i.test(change.diff)) concepts.add('authentication');
      if (/api|endpoint|route/i.test(change.diff)) concepts.add('api');
    }
    return Array.from(concepts);
  }
}
```

### 2.5 LLM 压缩（完整版）

```typescript
interface LLMCompressionConfig {
  provider: 'anthropic' | 'openai' | 'local';
  model: string;
  maxTokens: number;
  temperature: number;
  // 本地模型配置
  localModelPath?: string;
}

class LLMCompressor {
  async compress(
    observations: Observation[],
    config: LLMCompressionConfig
  ): Promise<CompressedMemory> {
    const prompt = this.buildPrompt(observations);

    const response = await this.callLLM(prompt, config);
    const parsed = this.parseResponse(response);

    return {
      type: 'llm_compressed',
      narrative: parsed.narrative,
      facts: parsed.facts,
      concepts: parsed.concepts,
      metrics: parsed.metrics,
      energy: 0.5
    };
  }

  private buildPrompt(observations: Observation[]): string {
    const obsText = observations.map(o => 
      `[${o.timestamp}] ${o.phase} | ${o.type}: ${o.content}`
    ).join('
');

    return `Analyze the following agent observations and extract structured memories.

Observations:
${obsText}

Extract:
1. Narrative summary (what happened, why, outcome)
2. Facts (specific, verifiable statements)
3. Concepts (domain keywords)
4. Metrics (if any quantitative data)
5. Success/failure indicators

Return JSON:
{
  "narrative": "...",
  "facts": ["..."],
  "concepts": ["..."],
  "metrics": {"coverage": "60%", ...},
  "success": true/false
}`;
  }

  private async callLLM(prompt: string, config: LLMCompressionConfig): Promise<string> {
    if (config.provider === 'local') {
      // 使用本地模型如 llama.cpp
      return await this.callLocalModel(prompt, config);
    }
    // API 调用...
  }
}
```

### 2.6 压缩策略选择器

```typescript
class CompressionStrategySelector {
  select(observations: Observation[]): CompressionStrategy {
    // 1. 如果全是文件修改，用 Diff-based
    if (observations.every(o => o.type === 'file_edit')) {
      return 'diff';
    }

    // 2. 如果模式匹配率高，用 Zero-token
    const matchRate = this.calculatePatternMatchRate(observations);
    if (matchRate > 0.8) {
      return 'zero-token';
    }

    // 3. 如果观察数量少且简单，用 Template
    if (observations.length < 3 && this.isSimple(observations)) {
      return 'template';
    }

    // 4. 默认用 LLM
    return 'llm';
  }

  private calculatePatternMatchRate(obs: Observation[]): number {
    const compressor = new ZeroTokenCompressor();
    const compressed = compressor.compress(obs);
    return compressed.length / obs.length;
  }
}
```

---

## 3. 隐私过滤机制

### 3.1 脱敏规则

```typescript
interface PrivacyRule {
  name: string;
  pattern: RegExp;
  replacement: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

const PRIVACY_RULES: PrivacyRule[] = [
  // API Keys
  {
    name: 'api_key',
    pattern: /(api[_-]?key|apikey)\s*[:=]\s*["']?[a-zA-Z0-9_-]{20,}["']?/gi,
    replacement: '$1: [REDACTED_API_KEY]',
    severity: 'critical'
  },
  // AWS Keys
  {
    name: 'aws_access_key',
    pattern: /AKIA[0-9A-Z]{16}/g,
    replacement: '[REDACTED_AWS_KEY]',
    severity: 'critical'
  },
  // Passwords
  {
    name: 'password',
    pattern: /(password|passwd|pwd)\s*[:=]\s*["']?[^\s"']+["']?/gi,
    replacement: '$1: [REDACTED_PASSWORD]',
    severity: 'critical'
  },
  // Tokens
  {
    name: 'bearer_token',
    pattern: /Bearer\s+[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
    replacement: 'Bearer [REDACTED_JWT]',
    severity: 'high'
  },
  // Private tags (OpenCode 风格)
  {
    name: 'private_tag',
    pattern: /<private>.*?<\/private>/gs,
    replacement: '<private>[REDACTED]</private>',
    severity: 'high'
  },
  // Email
  {
    name: 'email',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: '[REDACTED_EMAIL]',
    severity: 'medium'
  },
  // IP Address
  {
    name: 'ip_address',
    pattern: /(?:\d{1,3}\.){3}\d{1,3}/g,
    replacement: '[REDACTED_IP]',
    severity: 'low'
  },
  // Credit Card
  {
    name: 'credit_card',
    pattern: /(?:\d{4}[-\s]?){3}\d{4}/g,
    replacement: '[REDACTED_CC]',
    severity: 'critical'
  }
];
```

### 3.2 隐私过滤器实现

```typescript
class PrivacyFilter {
  private rules: PrivacyRule[] = PRIVACY_RULES;
  private logRedactions: boolean = true;

  filter(text: string): { filtered: string; redactions: RedactionLog[] } {
    let filtered = text;
    const redactions: RedactionLog[] = [];

    for (const rule of this.rules) {
      const matches = filtered.matchAll(rule.pattern);
      for (const match of matches) {
        const original = match[0];
        const start = match.index!;
        const end = start + original.length;

        filtered = filtered.substring(0, start) + 
                   rule.replacement + 
                   filtered.substring(end);

        redactions.push({
          rule: rule.name,
          severity: rule.severity,
          position: { start, end },
          originalLength: original.length,
          timestamp: new Date().toISOString()
        });
      }
    }

    if (this.logRedactions && redactions.length > 0) {
      console.log(`[Privacy] Redacted ${redactions.length} sensitive items`);
    }

    return { filtered, redactions };
  }

  // 在 mafw_observe 中自动调用
  filterObservation(obs: Observation): Observation {
    const { filtered, redactions } = this.filter(obs.content);
    return {
      ...obs,
      content: filtered,
      metadata: {
        ...obs.metadata,
        redactions,
        redactionCount: redactions.length
      }
    };
  }
}
```

### 3.3 配置

```typescript
// .mafw/config.json
{
  "privacy": {
    "enabled": true,
    "rules": [
      "api_key",
      "aws_access_key",
      "password",
      "bearer_token",
      "private_tag",
      "email",
      "credit_card"
    ],
    "logRedactions": true,
    "blockOnCritical": false,  // 是否阻止包含 critical 级别敏感信息的观察存储
    "customPatterns": []  // 用户自定义规则
  }
}
```

---

## 4. 存储后端选型

### 4.1 方案对比

| 方案 | 读取速度 | 写入速度 | 查询能力 | 并发 | 复杂度 | 推荐 |
|------|---------|---------|---------|------|--------|------|
| **JSON 文件** | 快 | 中 | 差 | 差 | 低 | 原型/单用户 |
| **SQLite** | 快 | 快 | 强 | 中 | 中 | 推荐 |
| **LevelDB/RocksDB** | 极快 | 极快 | 弱 | 强 | 中 | 高性能 |
| **LMDB** | 极快 | 极快 | 弱 | 强 | 中 | 嵌入式 |
| **PostgreSQL** | 快 | 快 | 极强 | 强 | 高 | 多用户/远程 |

### 4.2 推荐方案：SQLite + 文件缓存

```typescript
// 存储抽象层
interface StorageBackend {
  get(scope: string, key: string): Promise<any>;
  set(scope: string, key: string, value: any): Promise<void>;
  delete(scope: string, key: string): Promise<void>;
  query(scope: string, filter: object): Promise<any[]>;
  batch(operations: StorageOp[]): Promise<void>;
}

class SQLiteStorage implements StorageBackend {
  private db: Database;
  private cache: LRUCache<string, any>;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.cache = new LRUCache({ max: 1000, ttl: 1000 * 60 * 5 }); // 5分钟缓存
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch()),
        energy REAL DEFAULT 0.5,
        PRIMARY KEY (scope, key)
      );
      CREATE INDEX IF NOT EXISTS idx_scope ON memories(scope);
      CREATE INDEX IF NOT EXISTS idx_energy ON memories(energy);
      CREATE INDEX IF NOT EXISTS idx_created ON memories(created_at);

      -- 全文搜索表 (FTS5)
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content, scope, key,
        content='memories',
        content_rowid='rowid'
      );
    `);
  }

  async get(scope: string, key: string): Promise<any> {
    const cacheKey = `${scope}:${key}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const row = this.db.prepare(
      'SELECT value FROM memories WHERE scope = ? AND key = ?'
    ).get(scope, key);

    if (row) {
      const value = JSON.parse(row.value);
      this.cache.set(cacheKey, value);
      return value;
    }
    return null;
  }

  async set(scope: string, key: string, value: any): Promise<void> {
    const json = JSON.stringify(value);
    this.db.prepare(`
      INSERT INTO memories (scope, key, value, updated_at)
      VALUES (?, ?, ?, unixepoch())
      ON CONFLICT(scope, key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run(scope, key, json);

    this.cache.set(`${scope}:${key}`, value);
  }

  async query(scope: string, filter: object): Promise<any[]> {
    // 使用 FTS5 进行全文搜索
    if (filter['query']) {
      return this.fullTextSearch(scope, filter['query'] as string);
    }

    // 普通查询
    const rows = this.db.prepare(
      'SELECT key, value FROM memories WHERE scope = ? ORDER BY energy DESC'
    ).all(scope);

    return rows.map(r => ({ key: r.key, ...JSON.parse(r.value) }));
  }

  private fullTextSearch(scope: string, query: string): any[] {
    const rows = this.db.prepare(`
      SELECT m.key, m.value, rank
      FROM memories_fts fts
      JOIN memories m ON fts.rowid = m.rowid
      WHERE memories_fts MATCH ? AND m.scope = ?
      ORDER BY rank
    `).all(query, scope);

    return rows.map(r => ({ key: r.key, ...JSON.parse(r.value), rank: r.rank }));
  }
}
```

### 4.3 文件系统回退

```typescript
class FileStorage implements StorageBackend {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
    ensureDir(basePath);
  }

  async get(scope: string, key: string): Promise<any> {
    const path = join(this.basePath, scope, `${key}.json`);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8'));
  }

  async set(scope: string, key: string, value: any): Promise<void> {
    const dir = join(this.basePath, scope);
    ensureDir(dir);
    const path = join(dir, `${key}.json`);
    writeFileSync(path, JSON.stringify(value, null, 2));
  }

  async query(scope: string, filter: object): Promise<any[]> {
    const dir = join(this.basePath, scope);
    if (!existsSync(dir)) return [];

    const files = readdirSync(dir).filter(f => f.endsWith('.json'));
    const results: any[] = [];

    for (const file of files) {
      const content = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
      // 简单过滤
      if (this.matchesFilter(content, filter)) {
        results.push({ key: file.replace('.json', ''), ...content });
      }
    }

    return results;
  }

  private matchesFilter(content: any, filter: object): boolean {
    for (const [key, value] of Object.entries(filter)) {
      if (content[key] !== value) return false;
    }
    return true;
  }
}
```

### 4.4 存储配置

```typescript
// .mafw/config.json
{
  "storage": {
    "backend": "sqlite",  // "file" | "sqlite" | "leveldb"
    "sqlite": {
      "path": "./.mafw/data/state.db",
      "cacheSize": 1000,
      "cacheTTL": 300000  // 5 minutes
    },
    "file": {
      "basePath": "./.mafw/data"
    },
    "leveldb": {
      "path": "./.mafw/data/leveldb"
    }
  }
}
```

---

## 5. 知识图谱索引

### 5.1 图谱结构

```typescript
interface KnowledgeGraph {
  nodes: Map<string, GraphNode>;      // 概念/实体
  edges: Map<string, GraphEdge>;     // 关系
}

interface GraphNode {
  id: string;
  type: 'concept' | 'entity' | 'fact' | 'pattern';
  label: string;
  energy: number;
  sourceLoops: number[];
  properties: Record<string, any>;
}

interface GraphEdge {
  id: string;
  source: string;    // node id
  target: string;    // node id
  relation: string;  // "depends_on", "uses", "causes", "part_of", etc.
  weight: number;
  sourceLoops: number[];
}
```

### 5.2 实体提取

```typescript
class EntityExtractor {
  // 基于规则 + LLM 的实体提取
  private conceptPatterns: RegExp[] = [
    /(jwt|oauth|bcrypt|express|react|vue|angular)/gi,
    /(authentication|authorization|middleware|controller|service)/gi,
    /(coverage|testing|jest|mocha|cypress)/gi,
    /(api|endpoint|route|handler|middleware)/gi
  ];

  extract(text: string): string[] {
    const concepts = new Set<string>();

    // 规则提取
    for (const pattern of this.conceptPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        concepts.add(match[0].toLowerCase());
      }
    }

    // 文件扩展名提取
    const extensions = text.match(/\.(js|ts|jsx|tsx|py|go|rs|java)/g);
    if (extensions) {
      extensions.forEach(e => concepts.add(e.slice(1)));
    }

    return Array.from(concepts);
  }

  // LLM 增强提取
  async extractWithLLM(text: string): Promise<Array<{
    entity: string;
    type: string;
    confidence: number;
  }>> {
    // 调用 LLM 提取实体和关系
    // 返回结构化结果
  }
}
```

### 5.3 关系推断

```typescript
class RelationInferencer {
  // 基于共现和语法的关系推断
  inferRelations(entities: string[], context: string): GraphEdge[] {
    const edges: GraphEdge[] = [];

    // 1. 共现关系：同一句话中出现的实体有关联
    const sentences = context.split(/[.!?]+/);
    for (const sentence of sentences) {
      const present = entities.filter(e => 
        sentence.toLowerCase().includes(e.toLowerCase())
      );

      for (let i = 0; i < present.length; i++) {
        for (let j = i + 1; j < present.length; j++) {
          edges.push({
            id: generateId(),
            source: present[i],
            target: present[j],
            relation: 'co_occurs',
            weight: 0.5,
            sourceLoops: []
          });
        }
      }
    }

    // 2. 依赖关系：基于关键词
    if (/depends on|requires|uses/i.test(context)) {
      // 提取依赖关系
    }

    // 3. 因果关系：基于错误/修复模式
    if (/error|fix|bug|issue/i.test(context)) {
      // 提取因果关系
    }

    return edges;
  }
}
```

### 5.4 图谱搜索

```typescript
class GraphSearcher {
  private graph: KnowledgeGraph;

  // BFS 遍历查找相关节点
  search(queryNodes: string[], maxDepth: number = 2): GraphNode[] {
    const visited = new Set<string>();
    const results: GraphNode[] = [];
    const queue: Array<{nodeId: string; depth: number}> = 
      queryNodes.map(n => ({ nodeId: n, depth: 0 }));

    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift()!;
      if (visited.has(nodeId) || depth > maxDepth) continue;

      visited.add(nodeId);
      const node = this.graph.nodes.get(nodeId);
      if (node) {
        results.push(node);

        // 找到相邻节点
        for (const edge of this.graph.edges.values()) {
          if (edge.source === nodeId && !visited.has(edge.target)) {
            queue.push({ nodeId: edge.target, depth: depth + 1 });
          }
          if (edge.target === nodeId && !visited.has(edge.source)) {
            queue.push({ nodeId: edge.source, depth: depth + 1 });
          }
        }
      }
    }

    return results;
  }

  // 计算节点重要性 (PageRank 简化版)
  calculateImportance(nodeId: string): number {
    const incomingEdges = Array.from(this.graph.edges.values())
      .filter(e => e.target === nodeId);

    return incomingEdges.reduce((sum, e) => sum + e.weight, 0) / 
      (incomingEdges.length || 1);
  }
}
```

### 5.5 图谱配置

```typescript
// .mafw/config.json
{
  "graph": {
    "enabled": false,  // 默认关闭
    "autoExtract": true,
    "maxNodesPerSession": 50,
    "maxDepth": 2,
    "relations": [
      "uses",
      "depends_on",
      "causes",
      "part_of",
      "implements",
      "tests"
    ]
  }
}
```

---

## 6. 多 Agent 并发同步

### 6.1 并发场景

```
Goal: 重构认证模块
│
├─ Wave 1: 修改 User 模型 (Agent A)
├─ Wave 2: 修改 Auth 控制器 (Agent B)  ← 依赖 Wave 1
├─ Wave 3: 修改 JWT 中间件 (Agent C)   ← 依赖 Wave 1
├─ Wave 4: 更新测试 (Agent D)           ← 依赖 Wave 2,3
└─ Wave 5: 文档更新 (Agent E)           ← 独立
```

### 6.2 状态锁机制

```typescript
interface StateLock {
  goalId: string;
  loopNum: number;
  waveNum: number;
  agentId: string;
  acquiredAt: string;
  expiresAt: string;
}

class StateLockManager {
  private locks: Map<string, StateLock> = new Map();
  private lockTimeout: number = 300000; // 5 minutes

  async acquireLock(
    goalId: string, 
    loopNum: number, 
    waveNum: number,
    agentId: string
  ): Promise<boolean> {
    const lockKey = `${goalId}:${loopNum}:${waveNum}`;

    // 检查现有锁
    const existing = this.locks.get(lockKey);
    if (existing) {
      if (new Date(existing.expiresAt) > new Date()) {
        return false; // 锁被占用
      }
      // 锁已过期，清理
      this.locks.delete(lockKey);
    }

    // 获取锁
    const now = new Date();
    const lock: StateLock = {
      goalId,
      loopNum,
      waveNum,
      agentId,
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.lockTimeout).toISOString()
    };

    this.locks.set(lockKey, lock);
    return true;
  }

  async releaseLock(
    goalId: string, 
    loopNum: number, 
    waveNum: number
  ): Promise<void> {
    const lockKey = `${goalId}:${loopNum}:${waveNum}`;
    this.locks.delete(lockKey);
  }

  // 心跳续期
  async heartbeat(goalId: string, loopNum: number, waveNum: number): Promise<void> {
    const lockKey = `${goalId}:${loopNum}:${waveNum}`;
    const lock = this.locks.get(lockKey);
    if (lock) {
      lock.expiresAt = new Date(Date.now() + this.lockTimeout).toISOString();
    }
  }
}
```

### 6.3 依赖管理

```typescript
interface WaveDependency {
  waveNum: number;
  dependsOn: number[];  // 依赖的 wave 编号
  status: 'pending' | 'running' | 'completed' | 'failed';
}

class WaveDependencyManager {
  private dependencies: Map<string, WaveDependency[]> = new Map();

  canStartWave(goalId: string, loopNum: number, waveNum: number): boolean {
    const deps = this.getDependencies(goalId, loopNum);
    const wave = deps.find(d => d.waveNum === waveNum);

    if (!wave) return true; // 无依赖信息，允许执行

    // 检查所有依赖是否已完成
    for (const depWaveNum of wave.dependsOn) {
      const dep = deps.find(d => d.waveNum === depWaveNum);
      if (!dep || dep.status !== 'completed') {
        return false;
      }
    }

    return true;
  }

  updateWaveStatus(
    goalId: string, 
    loopNum: number, 
    waveNum: number, 
    status: WaveDependency['status']
  ): void {
    const key = `${goalId}:${loopNum}`;
    let deps = this.dependencies.get(key);
    if (!deps) {
      deps = [];
      this.dependencies.set(key, deps);
    }

    const wave = deps.find(d => d.waveNum === waveNum);
    if (wave) {
      wave.status = status;
    } else {
      deps.push({ waveNum, dependsOn: [], status });
    }
  }

  getReadyWaves(goalId: string, loopNum: number): number[] {
    const deps = this.getDependencies(goalId, loopNum);
    return deps
      .filter(d => d.status === 'pending' && this.canStartWave(goalId, loopNum, d.waveNum))
      .map(d => d.waveNum);
  }
}
```

### 6.4 状态同步协议

```typescript
// 基于文件的乐观锁
class OptimisticStateSync {
  private statePath: string;

  async updateState(
    goalId: string, 
    update: StateUpdate
  ): Promise<boolean> {
    const path = `${this.statePath}/status.json`;

    // 1. 读取当前状态
    const current = await this.readState(path);

    // 2. 检查版本（乐观锁）
    if (update.expectedVersion !== current.version) {
      return false; // 冲突，需要重试
    }

    // 3. 应用更新
    const newState = {
      ...current,
      ...update.changes,
      version: current.version + 1,
      lastUpdated: new Date().toISOString()
    };

    // 4. 写入（原子操作）
    await this.atomicWrite(path, newState);

    return true;
  }

  private async atomicWrite(path: string, data: any): Promise<void> {
    const tempPath = `${path}.tmp`;
    await writeFile(tempPath, JSON.stringify(data));
    await rename(tempPath, path); // 原子重命名
  }
}
```

---

## 7. 上下文注入详细代码

### 7.1 Skill Entry 注入（推荐方案）

```typescript
// skill/entry.ts
import { PluginContext } from '@opencode-ai/sdk';

interface MemoryContext {
  semantic: SemanticMemory[];
  procedural: ProceduralMemory[];
  parametric: ParametricDelta[];
  episodes: EpisodicMemory[];
}

export default async function skillEntry(context: PluginContext) {
  const { goalId, userMessage, phase = 'execute' } = context;

  // 1. 检索相关记忆
  const memoryContext = await buildMemoryContext(context, goalId, userMessage, phase);

  // 2. 注入到 Agent 上下文
  context.systemPrompt = injectMemoryIntoPrompt(
    context.systemPrompt,
    memoryContext,
    context.tokenBudget || 2000
  );

  // 3. 附加到 context 供后续使用
  context.mafw = {
    memoryContext,
    goalId,
    phase,
    loopNum: await getCurrentLoopNum(goalId)
  };

  // 4. 继续执行
  await context.next();
}

async function buildMemoryContext(
  context: PluginContext,
  goalId: string,
  query: string,
  phase: string
): Promise<MemoryContext> {
  // 并行检索
  const [hybrid, deltas, episodes] = await Promise.all([
    // 混合搜索
    context.callTool('mafw_search_hybrid', {
      goalId,
      query,
      maxResults: 10,
      tokenBudget: 1500
    }),

    // 行为约束
    context.callTool('mafw_get_deltas', {
      goalId,
      phase,
      maxResults: 5
    }),

    // 最近会话历史
    context.callTool('mafw_list_episodes', { goalId })
  ]);

  return {
    semantic: hybrid.semantic || [],
    procedural: hybrid.procedural || [],
    parametric: deltas.deltas || [],
    episodes: episodes.slice(-3) // 最近 3 个 loop
  };
}

function injectMemoryIntoPrompt(
  basePrompt: string,
  memoryContext: MemoryContext,
  tokenBudget: number
): string {
  const sections: string[] = [];
  let usedTokens = 0;

  // 1. 行为约束（最高优先级）
  if (memoryContext.parametric.length > 0) {
    const deltaSection = formatDeltas(memoryContext.parametric);
    sections.push(deltaSection);
    usedTokens += estimateTokens(deltaSection);
  }

  // 2. 工作流模式
  if (memoryContext.procedural.length > 0 && usedTokens < tokenBudget * 0.6) {
    const procSection = formatProcedural(memoryContext.procedural);
    sections.push(procSection);
    usedTokens += estimateTokens(procSection);
  }

  // 3. 语义事实
  if (memoryContext.semantic.length > 0 && usedTokens < tokenBudget * 0.8) {
    const semSection = formatSemantic(memoryContext.semantic);
    sections.push(semSection);
    usedTokens += estimateTokens(semSection);
  }

  // 4. 最近会话（剩余预算）
  if (memoryContext.episodes.length > 0 && usedTokens < tokenBudget) {
    const remainingBudget = tokenBudget - usedTokens;
    const epSection = formatEpisodes(memoryContext.episodes, remainingBudget);
    sections.push(epSection);
  }

  const memoryBlock = sections.join('

');

  return `${basePrompt}

--- MAFW Memory Context ---
${memoryBlock}
--- End MAFW Memory Context ---`;
}

function formatDeltas(deltas: ParametricDelta[]): string {
  const lines = deltas
    .sort((a, b) => b.energy - a.energy)
    .map(d => `[${d.energy.toFixed(1)}] ${d.content}`);

  return `## Behavioral Constraints (MUST follow):
${lines.join('
')}`;
}

function formatProcedural(patterns: ProceduralMemory[]): string {
  const lines = patterns
    .sort((a, b) => b.successRate - a.successRate)
    .map(p => `[${(p.successRate * 100).toFixed(0)}% success] ${p.pattern}`);

  return `## Workflow Patterns:
${lines.join('
')}`;
}

function formatSemantic(memories: SemanticMemory[]): string {
  const lines = memories
    .sort((a, b) => b.energy - a.energy)
    .map(m => `• ${m.facts.join('; ')} (concepts: ${m.concepts.join(', ')})`);

  return `## Relevant Facts:
${lines.join('
')}`;
}

function formatEpisodes(episodes: EpisodicMemory[], budget: number): string {
  let text = '## Recent History:
';
  let used = estimateTokens(text);

  for (const ep of episodes.reverse()) {
    const entry = `Loop ${ep.loop}: ${ep.verdict} - ${ep.summary}`;
    const entryTokens = estimateTokens(entry);

    if (used + entryTokens > budget) break;

    text += entry + '
';
    used += entryTokens;
  }

  return text;
}

function estimateTokens(text: string): number {
  // 粗略估计：1 token ≈ 4 字符（英文）或 1 汉字
  return Math.ceil(text.length / 3.5);
}
```

### 7.2 动态 Tool Description 注入

```typescript
// 在 Plugin 注册 Tools 时动态修改 description
class DynamicToolDescription {
  async enrichToolDescriptions(
    tools: ToolDefinition[],
    goalId: string,
    context: PluginContext
  ): Promise<ToolDefinition[]> {
    // 获取相关记忆摘要
    const memories = await context.callTool('mafw_search_hybrid', {
      goalId,
      query: 'common patterns',
      maxResults: 3,
      tokenBudget: 500
    });

    // 为特定 tools 添加记忆上下文
    return tools.map(tool => {
      if (tool.name === 'file_edit') {
        return {
          ...tool,
          description: `${tool.description}

Relevant context from previous loops:
${
            memories.semantic.map(m => `• ${m.facts[0]}`).join('
')
          }`
        };
      }
      return tool;
    });
  }
}
```

### 7.3 Pre-compact 重新注入

```typescript
// 在会话压缩前，确保关键记忆被重新注入
class PreCompactInjector {
  async injectBeforeCompact(context: PluginContext, goalId: string): Promise<void> {
    // 1. 获取高能量记忆（可能即将被压缩丢失）
    const criticalMemories = await context.callTool('mafw_search_hybrid', {
      goalId,
      query: 'critical constraints',
      maxResults: 5,
      tokenBudget: 1000
    });

    // 2. 筛选高能量记忆
    const highEnergy = criticalMemories.semantic
      .filter(m => m.energy > 0.8)
      .concat(criticalMemories.parametric.filter(m => m.energy > 0.8));

    // 3. 注入到当前上下文
    if (highEnergy.length > 0) {
      context.systemPrompt += `

[CRITICAL MEMORY PRESERVE]
${
        highEnergy.map(m => m.content || m.facts?.join('; ')).join('
')
      }`;
    }
  }
}
```

---

## 8. Dashboard UI 设计

### 8.1 布局设计

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  MAFW Dashboard                                                    [refresh]│
├──────────────────┬────────────────────────────────────────────────────────────┤
│                  │                                                            │
│  ┌──────────┐   │  ┌─────────────────────────────────────────────────────┐   │
│  │ Goals    │   │  │  Goal: auth-refactor-001                          │   │
│  │          │   │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ │   │
│  │ • auth   │   │  │  │ Loop 1  │ │ Loop 2  │ │ Loop 3  │ │ Loop 4  │ │   │
│  │   (4)    │   │  │  │  FAIL   │ │  FAIL   │ │  PASS   │ │ running │ │   │
│  │ • api    │   │  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ │   │
│  │   (2)    │   │  │                                                    │   │
│  │ • db     │   │  │  Timeline:                                         │   │
│  │   (1)    │   │  │  Plan ──▶ Wave 1 ──▶ Wave 2 ──▶ Review           │   │
│  │          │   │  │  [done]   [done]    [run]    [pend]              │   │
│  └──────────┘   │  └─────────────────────────────────────────────────────┘   │
│                  │                                                            │
│  ┌──────────┐   │  ┌─────────────────────┐  ┌─────────────────────────────┐  │
│  │ Memory   │   │  │  Energy Graph       │  │  Constraint Board         │  │
│  │ Explorer │   │  │                     │  │                           │  │
│  │          │   │  │  ▲                  │  │  [0.9] MUST use RS256      │  │
│  │ T1: 234  │   │  │  │    ╭─╮           │  │  [0.8] coverage ≥ 80%    │  │
│  │ T2: 12   │   │  │  │   ╱   ╲    ╭─╮  │  │  [0.7] sync tests/        │  │
│  │ T3: 45   │   │  │  │  ╱     ╲  ╱   ╲ │  │  [0.5] use bcrypt 10      │  │
│  │ T4: 8    │   │  │  │ ╱       ╲╱     │  │                           │  │
│  │ L3: 15   │   │  │  └─────────────────│  └─────────────────────────────┘  │
│  └──────────┘   │  └─────────────────────┘                                   │
│                  │                                                            │
│  ┌──────────┐   │  ┌─────────────────────────────────────────────────────┐   │
│  │ Live Log │   │  │  Session Replay                                     │   │
│  │          │   │  │  ┌─────────────────────────────────────────────┐   │   │
│  │ [17:30]  │   │  │  │  ▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │   │   │
│  │ tool:    │   │  │  │  17:30:01  mafw_search_hybrid               │   │   │
│  │ file_edit│   │  │  │  17:30:15  tool:file_edit src/auth.ts       │   │   │
│  │          │   │  │  │  17:30:22  tool:file_edit tests/auth.test.ts│   │   │
│  │ [17:29]  │   │  │  │  17:30:45  mafw_update_state                │   │   │
│  │ mafw_    │   │  │  │                                             │   │   │
│  │ search   │   │  │  └─────────────────────────────────────────────┘   │   │
│  └──────────┘   │  └─────────────────────────────────────────────────────┘   │
│                  │                                                            │
└──────────────────┴────────────────────────────────────────────────────────────┘
```

### 8.2 技术栈

```typescript
// Dashboard 技术栈
const dashboardStack = {
  frontend: {
    framework: 'Vanilla JS + Web Components',  // 轻量，无构建依赖
    styling: 'Tailwind CSS CDN',
    charts: 'Chart.js CDN',
    icons: 'Lucide icons CDN'
  },
  backend: {
    server: 'Node.js http module',  // 内嵌在 Gateway 中
    api: 'REST + WebSocket',
    data: 'File system polling + SQLite'
  },
  realtime: {
    protocol: 'WebSocket',
    events: ['tool_call', 'state_change', 'memory_update', 'error']
  }
};
```

### 8.3 API 设计

```typescript
// Dashboard REST API
interface DashboardAPI {
  // 目标管理
  'GET /api/goals': () => GoalSummary[];
  'GET /api/goals/:id': (id: string) => GoalDetail;
  'GET /api/goals/:id/loops': (id: string) => LoopSummary[];
  'GET /api/goals/:id/loops/:loop': (id: string, loop: number) => LoopDetail;

  // 记忆浏览
  'GET /api/memory/:goalId/tier/:tier': (goalId: string, tier: string) => MemoryItem[];
  'GET /api/memory/search': (query: string) => HybridSearchResult;

  // 实时监控
  'WS /api/stream': WebSocket;  // 实时事件流

  // 会话回放
  'GET /api/replay/:goalId/:loop': (goalId: string, loop: number) => ReplayEvent[];
  'POST /api/replay/:goalId/:loop/seek': (timestamp: string) => void;
}
```

### 8.4 实时事件流

```typescript
// WebSocket 事件格式
interface DashboardEvent {
  type: 'tool_call' | 'state_change' | 'memory_update' | 'error' | 'loop_transition';
  timestamp: string;
  goalId: string;
  loopNum: number;
  waveNum?: number;
  data: any;
}

// 示例事件
const exampleEvents: DashboardEvent[] = [
  {
    type: 'loop_transition',
    timestamp: '2026-06-27T17:30:00Z',
    goalId: 'auth-refactor-001',
    loopNum: 3,
    data: { from: 'execute', to: 'review', wave: 2 }
  },
  {
    type: 'tool_call',
    timestamp: '2026-06-27T17:30:15Z',
    goalId: 'auth-refactor-001',
    loopNum: 3,
    waveNum: 2,
    data: { tool: 'file_edit', file: 'src/auth.ts', duration: 1200 }
  },
  {
    type: 'memory_update',
    timestamp: '2026-06-27T17:30:45Z',
    goalId: 'auth-refactor-001',
    loopNum: 3,
    data: { tier: 'tier3', action: 'create', energy: 0.5 }
  }
];
```

---

## 9. Loop/Wave 状态机

### 9.1 完整状态图

```
                    ┌─────────────┐
                    │   IDLE      │
                    │  (等待目标)  │
                    └──────┬──────┘
                           │ goal.create
                           ▼
                    ┌─────────────┐
                    │  PLANNING   │
                    │  Plan Agent │
                    │  制定计划   │
                    └──────┬──────┘
                           │ plan.complete
                           ▼
              ┌────────────────────────┐
              │      WAVE_READY        │
              │  等待 Wave 依赖满足    │
              └──────┬─────────────────┘
                     │ deps satisfied
                     ▼
              ┌─────────────┐
              │  EXECUTING  │◄────────────────┐
              │ Execute     │                 │
              │ Agent       │                 │
              └──────┬──────┘                 │
                     │ wave.complete          │
                     ▼                      │
              ┌─────────────┐               │
              │  WAVE_CHECK │               │
              │ 检查是否还有 │               │
              │ 未执行 Wave  │               │
              └──────┬──────┘               │
                     │                      │
         ┌───────────┴───────────┐          │
         │                       │          │
    more waves              all done       │
         │                       │          │
         ▼                       ▼          │
    ┌─────────┐           ┌─────────────┐   │
    │WAVE_READY│           │  REVIEWING  │   │
    └─────────┘           │ Review Agent│   │
                          │ 生成报告    │   │
                          └──────┬──────┘   │
                                 │         │
                                 ▼         │
                          ┌─────────────┐   │
                          │   VERDICT   │   │
                          └──────┬──────┘   │
                                 │         │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
              ▼                  ▼                  ▼
        ┌──────────┐      ┌──────────┐      ┌──────────┐
        │   PASS   │      │   FAIL   │      │  PARTIAL │
        │ 目标完成  │      │ 重新 Plan │      │ 继续当前  │
        │          │      │          │      │ Loop     │
        └──────────┘      └────┬─────┘      └────┬─────┘
                               │                 │
                               │                 │
                               ▼                 ▼
                        ┌─────────────┐   ┌─────────────┐
                        │  LOOP_RESET │   │  WAVE_RETRY │
                        │ 新 Loop N+1 │   │ 重试 Wave   │
                        │ 保留记忆    │   │ 保留状态    │
                        └─────────────┘   └─────────────┘
                               │                 │
                               └─────────────────┘
                                                 │
                                                 ▼
                                          ┌─────────────┐
                                          │  PLANNING   │
                                          │ (新 Loop)   │
                                          └─────────────┘
```

### 9.2 状态定义

```typescript
enum LoopState {
  IDLE = 'idle',
  PLANNING = 'planning',
  WAVE_READY = 'wave_ready',
  EXECUTING = 'executing',
  WAVE_CHECK = 'wave_check',
  REVIEWING = 'reviewing',
  VERDICT = 'verdict',
  PASS = 'pass',
  FAIL = 'fail',
  PARTIAL = 'partial',
  LOOP_RESET = 'loop_reset',
  WAVE_RETRY = 'wave_retry'
}

enum WaveState {
  PENDING = 'pending',
  READY = 'ready',
  RUNNING = 'running',
  BLOCKED = 'blocked',    // 依赖未满足
  COMPLETED = 'completed',
  FAILED = 'failed',
  RETRYING = 'retrying'
}

interface LoopStateMachine {
  goalId: string;
  loopNum: number;
  state: LoopState;
  waves: WaveStateMachine[];
  currentWave: number;
  phase: 'plan' | 'execute' | 'review';
  verdict?: 'PASS' | 'FAIL' | 'PARTIAL';
  transitions: StateTransition[];
}

interface WaveStateMachine {
  waveNum: number;
  state: WaveState;
  dependencies: number[];
  agentId?: string;
  startTime?: string;
  endTime?: string;
  error?: string;
  retryCount: number;
  maxRetries: number;
}

interface StateTransition {
  from: LoopState;
  to: LoopState;
  trigger: string;
  condition?: (state: LoopStateMachine) => boolean;
  action?: (state: LoopStateMachine) => Promise<void>;
}
```

### 9.3 状态转换表

| 当前状态 | 触发事件 | 条件 | 下一状态 | 动作 |
|---------|---------|------|---------|------|
| IDLE | goal.create | - | PLANNING | 初始化 Loop 1 |
| PLANNING | plan.complete | - | WAVE_READY | 写入 waves.json |
| WAVE_READY | deps.satisfied | 有依赖满足的 Wave | EXECUTING | 分配 Agent |
| EXECUTING | wave.complete | 还有未执行 Wave | WAVE_CHECK | 更新状态 |
| EXECUTING | wave.complete | 所有 Wave 完成 | REVIEWING | 触发 Review |
| EXECUTING | wave.fail | retry < max | WAVE_RETRY | 重试 Wave |
| EXECUTING | wave.fail | retry >= max | REVIEWING | 强制 Review |
| WAVE_CHECK | - | 有 ready Wave | WAVE_READY | - |
| WAVE_CHECK | - | 无 ready Wave | REVIEWING | - |
| REVIEWING | review.complete | verdict=PASS | PASS | 归档 Goal |
| REVIEWING | review.complete | verdict=FAIL | LOOP_RESET | 启动 Loop N+1 |
| REVIEWING | review.complete | verdict=PARTIAL | WAVE_RETRY | 重试失败 Wave |
| LOOP_RESET | - | - | PLANNING | 新 Loop 计划 |
| WAVE_RETRY | - | - | WAVE_READY | 重置 Wave 状态 |

### 9.4 状态机实现

```typescript
class LoopStateMachineImpl {
  private state: LoopStateMachine;
  private transitions: StateTransition[];

  constructor(goalId: string, loopNum: number) {
    this.state = {
      goalId,
      loopNum,
      state: LoopState.IDLE,
      waves: [],
      currentWave: 0,
      phase: 'plan',
      transitions: []
    };
    this.initTransitions();
  }

  private initTransitions() {
    this.transitions = [
      {
        from: LoopState.IDLE,
        to: LoopState.PLANNING,
        trigger: 'goal.create',
        action: async (s) => {
          await this.initLoop(s);
        }
      },
      {
        from: LoopState.PLANNING,
        to: LoopState.WAVE_READY,
        trigger: 'plan.complete',
        action: async (s) => {
          s.waves = await this.loadWaves(s.goalId);
          s.phase = 'execute';
        }
      },
      {
        from: LoopState.WAVE_READY,
        to: LoopState.EXECUTING,
        trigger: 'deps.satisfied',
        condition: (s) => s.waves.some(w => w.state === WaveState.READY),
        action: async (s) => {
          const readyWave = s.waves.find(w => w.state === WaveState.READY);
          if (readyWave) {
            s.currentWave = readyWave.waveNum;
            readyWave.state = WaveState.RUNNING;
            await this.assignAgent(s.goalId, readyWave.waveNum);
          }
        }
      },
      {
        from: LoopState.EXECUTING,
        to: LoopState.WAVE_CHECK,
        trigger: 'wave.complete',
        action: async (s) => {
          const wave = s.waves.find(w => w.waveNum === s.currentWave);
          if (wave) {
            wave.state = WaveState.COMPLETED;
            wave.endTime = new Date().toISOString();
          }
        }
      },
      {
        from: LoopState.EXECUTING,
        to: LoopState.REVIEWING,
        trigger: 'wave.complete',
        condition: (s) => s.waves.every(w => 
          w.state === WaveState.COMPLETED || w.state === WaveState.FAILED
        ),
        action: async (s) => {
          s.phase = 'review';
          await this.triggerReview(s);
        }
      },
      {
        from: LoopState.REVIEWING,
        to: LoopState.PASS,
        trigger: 'review.complete',
        condition: (s) => s.verdict === 'PASS',
        action: async (s) => {
          await this.archiveGoal(s.goalId);
        }
      },
      {
        from: LoopState.REVIEWING,
        to: LoopState.LOOP_RESET,
        trigger: 'review.complete',
        condition: (s) => s.verdict === 'FAIL',
        action: async (s) => {
          await this.startNewLoop(s);
        }
      }
    ];
  }

  async handleEvent(trigger: string, data?: any): Promise<boolean> {
    const transition = this.transitions.find(t => 
      t.from === this.state.state && t.trigger === trigger
    );

    if (!transition) return false;

    if (transition.condition && !transition.condition(this.state)) {
      return false;
    }

    this.state.state = transition.to;
    if (transition.action) {
      await transition.action(this.state);
    }

    return true;
  }

  getState(): LoopStateMachine {
    return { ...this.state };
  }
}
```

---

## 10. 记忆压缩算法

### 10.1 压缩流水线

```
Raw Observations (T1)
    │
    ├─> [Filter] ──> 去重 (SHA-256, 5min 窗口)
    │
    ├─> [Privacy] ──> 脱敏
    │
    ├─> [Classify] ──> 分类 (tool_use/file_edit/llm_call/error)
    │
    ├─> [Group] ──> 按 Loop/Phase/Concept 分组
    │
    ├─> [Compress] ──> 策略选择 + 压缩
    │       ├─> Zero-token (规则匹配 > 80%)
    │       ├─> Diff-based (全文件修改)
    │       ├─> Template (简单观察 < 3)
    │       └─> LLM (默认)
    │
    ├─> [Extract] ──> 提取 facts/concepts
    │
    ├─> [Merge] ──> 合并相似记忆
    │
    └─> [Store] ──> 写入 T2/T3/T4
```

### 10.2 去重算法

```typescript
class ObservationDeduplicator {
  private recentHashes: Map<string, number> = new Map(); // hash -> timestamp
  private windowMs: number = 5 * 60 * 1000; // 5 minutes

  deduplicate(observations: Observation[]): Observation[] {
    const unique: Observation[] = [];
    const now = Date.now();

    // 清理过期记录
    for (const [hash, ts] of this.recentHashes) {
      if (now - ts > this.windowMs) {
        this.recentHashes.delete(hash);
      }
    }

    for (const obs of observations) {
      const hash = this.computeHash(obs);

      if (!this.recentHashes.has(hash)) {
        unique.push(obs);
        this.recentHashes.set(hash, now);
      }
    }

    return unique;
  }

  private computeHash(obs: Observation): string {
    const content = `${obs.type}:${obs.phase}:${obs.content}`;
    // 使用 Node.js crypto
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }
}
```

### 10.3 相似记忆合并

```typescript
class MemoryMerger {
  private similarityThreshold: number = 0.85;

  async mergeSimilarMemories(memories: SemanticMemory[]): Promise<SemanticMemory[]> {
    const merged: SemanticMemory[] = [];
    const processed = new Set<string>();

    for (const memory of memories) {
      if (processed.has(memory.id)) continue;

      // 找到相似记忆
      const similar = await this.findSimilar(memory, memories.filter(m => !processed.has(m.id)));

      if (similar.length > 0) {
        // 合并
        const mergedMemory = this.mergeGroup([memory, ...similar]);
        merged.push(mergedMemory);

        processed.add(memory.id);
        similar.forEach(m => processed.add(m.id));
      } else {
        merged.push(memory);
        processed.add(memory.id);
      }
    }

    return merged;
  }

  private async findSimilar(
    target: SemanticMemory, 
    candidates: SemanticMemory[]
  ): Promise<SemanticMemory[]> {
    const similar: SemanticMemory[] = [];

    for (const candidate of candidates) {
      const similarity = this.calculateSimilarity(target, candidate);
      if (similarity > this.similarityThreshold) {
        similar.push(candidate);
      }
    }

    return similar;
  }

  private calculateSimilarity(a: SemanticMemory, b: SemanticMemory): number {
    // 1. 概念重叠度
    const conceptOverlap = this.jaccardSimilarity(
      new Set(a.concepts),
      new Set(b.concepts)
    );

    // 2. 事实文本相似度（简化：共享关键词比例）
    const factOverlap = this.jaccardSimilarity(
      new Set(a.facts.join(' ').split(/\s+/)),
      new Set(b.facts.join(' ').split(/\s+/))
    );

    // 3. 加权平均
    return conceptOverlap * 0.6 + factOverlap * 0.4;
  }

  private jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    const intersection = new Set([...a].filter(x => b.has(x)));
    const union = new Set([...a, ...b]);
    return intersection.size / union.size;
  }

  private mergeGroup(group: SemanticMemory[]): SemanticMemory {
    // 合并 facts（去重）
    const allFacts = group.flatMap(m => m.facts);
    const uniqueFacts = [...new Set(allFacts)];

    // 合并 concepts（去重）
    const allConcepts = group.flatMap(m => m.concepts);
    const uniqueConcepts = [...new Set(allConcepts)];

    // 能量取平均
    const avgEnergy = group.reduce((sum, m) => sum + m.energy, 0) / group.length;

    // 来源记录所有 loop
    const sourceLoops = [...new Set(group.flatMap(m => m.sourceLoops || [m.loopNum]))];

    return {
      id: generateId(),
      facts: uniqueFacts,
      concepts: uniqueConcepts,
      energy: Math.min(avgEnergy * 1.1, 1.0), // 合并后能量略增
      loopNum: group[0].loopNum,
      sourceLoops,
      mergedFrom: group.map(m => m.id),
      timestamp: new Date().toISOString()
    };
  }
}
```

---

## 11. Energy 系统数学模型

### 11.1 能量更新公式

```
E(t+1) = E(t) + ΔE

其中:
• 有用反馈: ΔE = +0.1
• 无用反馈: ΔE = -0.05
• 自然衰减: ΔE = -0.01 × Δt_days
• 被检索: ΔE = +0.02 (每次检索)
• 被引用: ΔE = +0.05 (被其他记忆引用)

约束:
• 0 ≤ E(t) ≤ 1
• E(t) < 0.3 → 进入清理候选
• E(t) > 0.8 → 标记为关键记忆（Pre-compact 保护）
```

### 11.2 能量衰减实现

```typescript
class EnergySystem {
  private decayRatePerDay: number = 0.01;
  private minEnergy: number = 0.0;
  private maxEnergy: number = 1.0;
  private cleanupThreshold: number = 0.3;
  private criticalThreshold: number = 0.8;

  calculateEnergy(
    currentEnergy: number,
    event: EnergyEvent,
    daysSinceLastUpdate: number
  ): number {
    // 1. 应用自然衰减
    let energy = currentEnergy - (this.decayRatePerDay * daysSinceLastUpdate);

    // 2. 应用事件
    switch (event.type) {
      case 'useful_feedback':
        energy += 0.1;
        break;
      case 'useless_feedback':
        energy -= 0.05;
        break;
      case 'retrieved':
        energy += 0.02;
        break;
      case 'referenced':
        energy += 0.05;
        break;
      case 'merged':
        energy += 0.03;
        break;
    }

    // 3. 边界约束
    energy = Math.max(this.minEnergy, Math.min(this.maxEnergy, energy));

    return energy;
  }

  shouldCleanup(energy: number): boolean {
    return energy < this.cleanupThreshold;
  }

  isCritical(energy: number): boolean {
    return energy > this.criticalThreshold;
  }
}

type EnergyEvent = 
  | { type: 'useful_feedback' }
  | { type: 'useless_feedback' }
  | { type: 'retrieved' }
  | { type: 'referenced' }
  | { type: 'merged' };
```

### 11.3 能量可视化

```typescript
// 能量分布统计
interface EnergyDistribution {
  critical: number;    // > 0.8
  high: number;        // 0.6 - 0.8
  medium: number;      // 0.3 - 0.6
  low: number;         // < 0.3 (待清理)
  total: number;
}

function calculateDistribution(memories: Memory[]): EnergyDistribution {
  const dist: EnergyDistribution = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };

  for (const m of memories) {
    dist.total++;
    if (m.energy > 0.8) dist.critical++;
    else if (m.energy > 0.6) dist.high++;
    else if (m.energy > 0.3) dist.medium++;
    else dist.low++;
  }

  return dist;
}
```

---

## 12. Token Budget 分配算法

### 12.1 预算分配策略

```
总预算: B (默认 2000 tokens)

分配:
├─ 行为约束 (L3):     0.25 × B = 500 tokens  [最高优先级]
├─ 工作流模式 (T4):   0.20 × B = 400 tokens  [高优先级]
├─ 语义事实 (T3):     0.30 × B = 600 tokens  [中优先级]
├─ 会话历史 (T2):     0.15 × B = 300 tokens  [低优先级]
└─ 保留缓冲:          0.10 × B = 200 tokens  [应急]

截断策略:
• 每类记忆按 energy 排序
• 依次添加直到该类预算耗尽
• 如果某类记忆不足，剩余预算分配给下一类
```

### 12.2 实现

```typescript
class TokenBudgetAllocator {
  private defaultBudget: number = 2000;

  private allocations: Record<string, number> = {
    parametric: 0.25,
    procedural: 0.20,
    semantic: 0.30,
    episodic: 0.15,
    buffer: 0.10
  };

  allocate(
    memories: {
      parametric: ParametricDelta[];
      procedural: ProceduralMemory[];
      semantic: SemanticMemory[];
      episodic: EpisodicMemory[];
    },
    totalBudget: number = this.defaultBudget
  ): AllocatedMemory {
    const result: AllocatedMemory = {
      parametric: [],
      procedural: [],
      semantic: [],
      episodic: [],
      totalTokens: 0
    };

    let remainingBudget = totalBudget;
    const categories: (keyof typeof memories)[] = ['parametric', 'procedural', 'semantic', 'episodic'];

    for (const category of categories) {
      const categoryBudget = Math.floor(totalBudget * this.allocations[category]);
      const items = memories[category];

      // 按 energy 排序
      const sorted = [...items].sort((a, b) => (b.energy || 0) - (a.energy || 0));

      let usedTokens = 0;
      const selected: any[] = [];

      for (const item of sorted) {
        const itemTokens = this.estimateItemTokens(item, category);

        if (usedTokens + itemTokens <= categoryBudget) {
          selected.push(item);
          usedTokens += itemTokens;
        } else {
          break;
        }
      }

      result[category] = selected;
      result.totalTokens += usedTokens;
      remainingBudget -= usedTokens;
    }

    // 如果有剩余预算，分配给最高能量的未选中记忆
    if (remainingBudget > 100) {
      this.fillRemainingBudget(result, memories, remainingBudget);
    }

    return result;
  }

  private estimateItemTokens(item: any, category: string): number {
    switch (category) {
      case 'parametric':
        return Math.ceil(item.content?.length / 4) + 10;
      case 'procedural':
        return Math.ceil(item.pattern?.length / 4) + 15;
      case 'semantic':
        return Math.ceil(item.facts?.join(' ').length / 4) + 20;
      case 'episodic':
        return Math.ceil(item.summary?.length / 4) + 10;
      default:
        return 50;
    }
  }

  private fillRemainingBudget(
    result: AllocatedMemory,
    memories: any,
    remaining: number
  ): void {
    // 收集所有未选中的记忆
    const allUnselected: Array<{item: any; category: string; energy: number}> = [];

    for (const category of ['parametric', 'procedural', 'semantic', 'episodic'] as const) {
      const selected = new Set(result[category].map((i: any) => i.id));
      for (const item of memories[category]) {
        if (!selected.has(item.id)) {
          allUnselected.push({ item, category, energy: item.energy || 0 });
        }
      }
    }

    // 按能量排序，填充剩余预算
    allUnselected.sort((a, b) => b.energy - a.energy);

    let used = 0;
    for (const { item, category } of allUnselected) {
      const tokens = this.estimateItemTokens(item, category);
      if (used + tokens <= remaining) {
        (result[category] as any[]).push(item);
        used += tokens;
      } else {
        break;
      }
    }

    result.totalTokens += used;
  }
}

interface AllocatedMemory {
  parametric: ParametricDelta[];
  procedural: ProceduralMemory[];
  semantic: SemanticMemory[];
  episodic: EpisodicMemory[];
  totalTokens: number;
}
```

---

## 13. Hook 实现细节

### 13.1 Hook 注册

```typescript
// Plugin 中的 Hook 注册
interface HookRegistration {
  name: string;
  event: string;
  handler: (context: HookContext) => Promise<void>;
  priority: number;  // 执行优先级，数字越小越先执行
}

class HookManager {
  private hooks: Map<string, HookRegistration[]> = new Map();

  register(hook: HookRegistration): void {
    const existing = this.hooks.get(hook.event) || [];
    existing.push(hook);
    // 按优先级排序
    existing.sort((a, b) => a.priority - b.priority);
    this.hooks.set(hook.event, existing);
  }

  async execute(event: string, context: HookContext): Promise<void> {
    const handlers = this.hooks.get(event) || [];

    for (const hook of handlers) {
      try {
        await hook.handler(context);
      } catch (error) {
        console.error(`Hook ${hook.name} failed:`, error);
        // 根据配置决定是否继续
        if (context.config.hookFailBehavior === 'stop') {
          throw error;
        }
      }
    }
  }
}
```

### 13.2 核心 Hooks 实现

```typescript
// 1. Session Start Hook
const sessionStartHook: HookRegistration = {
  name: 'mafw_session_start',
  event: 'session.start',
  priority: 100,
  handler: async (ctx) => {
    const { goalId, userMessage } = ctx;

    // 1. 检索相关记忆
    const memories = await ctx.callTool('mafw_search_hybrid', {
      goalId,
      query: userMessage,
      maxResults: 10,
      tokenBudget: 2000
    });

    // 2. 获取行为约束
    const deltas = await ctx.callTool('mafw_get_deltas', {
      goalId,
      phase: 'plan',
      maxResults: 5
    });

    // 3. 注入上下文
    ctx.memoryContext = { ...memories, parametric: deltas.deltas };

    // 4. 记录会话开始
    await ctx.callTool('mafw_observe', {
      goalId,
      loopNum: await getCurrentLoopNum(goalId),
      phase: 'plan',
      type: 'llm_call',
      content: `Session started: ${userMessage}`,
      metadata: { event: 'session_start' }
    });
  }
};

// 2. Tool Execute After Hook
const toolExecuteAfterHook: HookRegistration = {
  name: 'mafw_tool_observe',
  event: 'tool.execute.after',
  priority: 50,
  handler: async (ctx) => {
    const { toolName, toolInput, toolOutput, error, goalId, loopNum, phase } = ctx;

    // 1. 隐私过滤
    const filter = new PrivacyFilter();
    const safeInput = filter.filter(JSON.stringify(toolInput));
    const safeOutput = error ? filter.filter(error.message) : filter.filter(JSON.stringify(toolOutput));

    // 2. 记录观察
    await ctx.callTool('mafw_observe', {
      goalId,
      loopNum,
      phase,
      type: 'tool_use',
      content: `Tool: ${toolName}
Input: ${safeInput.filtered}
Output: ${safeOutput.filtered}`,
      metadata: {
        toolName,
        duration: ctx.duration,
        success: !error,
        errorType: error?.name,
        redactions: [...safeInput.redactions, ...safeOutput.redactions]
      }
    });

    // 3. 如果是文件修改工具，额外记录
    if (toolName === 'file_edit' || toolName === 'file_write') {
      await ctx.callTool('mafw_observe', {
        goalId,
        loopNum,
        phase,
        type: 'file_edit',
        content: `File modified: ${toolInput.filePath}`,
        metadata: { filePath: toolInput.filePath, operation: toolName }
      });
    }
  }
};

// 3. Session Idle Hook (压缩触发)
const sessionIdleHook: HookRegistration = {
  name: 'mafw_compress_on_idle',
  event: 'session.idle',
  priority: 200,
  handler: async (ctx) => {
    const { goalId, loopNum, sessionId } = ctx;

    // 1. 检查是否有足够观察需要压缩
    const observations = await ctx.callTool('mafw_get_observations', {
      goalId,
      loopNum,
      phase: 'execute'
    });

    if (observations.length >= 5) {
      // 2. 触发压缩
      await ctx.callTool('mafw_compress_session', {
        goalId,
        loopNum,
        sessionId
      });

      console.log(`[MAFW] Compressed ${observations.length} observations for ${goalId} loop ${loopNum}`);
    }
  }
};

// 4. Session End Hook
const sessionEndHook: HookRegistration = {
  name: 'mafw_session_end',
  event: 'session.end',
  priority: 100,
  handler: async (ctx) => {
    const { goalId, loopNum, sessionId } = ctx;

    // 1. 强制压缩
    await ctx.callTool('mafw_compress_session', {
      goalId,
      loopNum,
      sessionId
    });

    // 2. 清理低能量记忆
    await ctx.callTool('mafw_cleanup_memories', {
      threshold: 0.3
    });

    // 3. 记录会话结束
    await ctx.callTool('mafw_observe', {
      goalId,
      loopNum,
      phase: 'review',
      type: 'llm_call',
      content: `Session ended. Compressed and cleaned up memories.`,
      metadata: { event: 'session_end' }
    });
  }
};

// 5. Pre-compact Hook (防止关键记忆丢失)
const preCompactHook: HookRegistration = {
  name: 'mafw_pre_compact',
  event: 'pre.compact',
  priority: 10,  // 最高优先级
  handler: async (ctx) => {
    const { goalId } = ctx;

    // 1. 获取高能量记忆
    const critical = await ctx.callTool('mafw_search_hybrid', {
      goalId,
      query: 'critical',
      maxResults: 5,
      tokenBudget: 1000
    });

    // 2. 筛选 energy > 0.8 的
    const highEnergy = [
      ...critical.semantic.filter(m => m.energy > 0.8),
      ...critical.parametric.filter(m => m.energy > 0.8)
    ];

    // 3. 标记为不可压缩
    ctx.preserveMemories = highEnergy.map(m => m.id);

    // 4. 重新注入到上下文
    if (highEnergy.length > 0) {
      ctx.systemPrompt += `

[PRESERVE] Critical memories must be retained:
${
        highEnergy.map(m => `• ${m.content || m.facts?.join('; ')}`).join('
')
      }`;
    }
  }
};
```

### 13.3 Hook 配置

```typescript
// .mafw/config.json
{
  "hooks": {
    "enabled": [
      "mafw_session_start",
      "mafw_tool_observe",
      "mafw_compress_on_idle",
      "mafw_session_end",
      "mafw_pre_compact"
    ],
    "failBehavior": "continue",  // "continue" | "stop"
    "timeout": 5000,  // 每个 hook 超时时间 (ms)
    "privacyFilter": true,
    "autoCompress": {
      "minObservations": 5,
      "minImportance": 5,
      "maxAgeMinutes": 30
    }
  }
}
```

---

## 14. 错误处理与重试

### 14.1 错误分类

| 错误类型 | 示例 | 处理策略 |
|---------|------|---------|
| **Transient** | 网络超时、API 限流 | 指数退避重试 |
| **Persistent** | 文件不存在、权限错误 | 立即失败，记录 |
| **Logic** | 状态不一致、依赖缺失 | 状态机回滚 |
| **Resource** | 内存不足、磁盘满 | 优雅降级 |
| **External** | LLM API 错误、DB 错误 | 熔断 + 降级 |

### 14.2 重试策略

```typescript
interface RetryPolicy {
  maxRetries: number;
  baseDelay: number;      // 初始延迟 (ms)
  maxDelay: number;       // 最大延迟 (ms)
  backoffMultiplier: number;
  retryableErrors: string[];
  onRetry?: (attempt: number, error: Error) => void;
  onExhausted?: (error: Error) => void;
}

const defaultRetryPolicy: RetryPolicy = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  retryableErrors: ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'RATE_LIMITED'],
  onRetry: (attempt, error) => {
    console.log(`[Retry] Attempt ${attempt + 1}/3 after error: ${error.message}`);
  },
  onExhausted: (error) => {
    console.error(`[Retry] All attempts exhausted: ${error.message}`);
  }
};

async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = defaultRetryPolicy
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // 检查是否可重试
      if (attempt >= policy.maxRetries || !isRetryable(error, policy)) {
        throw error;
      }

      // 计算延迟
      const delay = Math.min(
        policy.baseDelay * Math.pow(policy.backoffMultiplier, attempt),
        policy.maxDelay
      );

      // 添加 jitter
      const jitteredDelay = delay * (0.5 + Math.random() * 0.5);

      if (policy.onRetry) {
        policy.onRetry(attempt, lastError);
      }

      await sleep(jitteredDelay);
    }
  }

  if (policy.onExhausted) {
    policy.onExhausted(lastError!);
  }
  throw lastError!;
}

function isRetryable(error: any, policy: RetryPolicy): boolean {
  const code = error.code || error.message;
  return policy.retryableErrors.some(re => 
    code.includes(re) || code.includes(re.toLowerCase())
  );
}
```

### 14.3 熔断器

```typescript
class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime?: number;

  private threshold: number = 5;        // 触发熔断的失败次数
  private timeout: number = 60000;     // 熔断持续时间 (ms)
  private halfOpenMaxCalls: number = 3; // 半开状态允许的最大测试调用

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - (this.lastFailureTime || 0) > this.timeout) {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failureCount = 0;

    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.halfOpenMaxCalls) {
        this.state = 'CLOSED';
      }
    }
  }

  private onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
    } else if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';
    }
  }
}
```

### 14.4 降级策略

```typescript
interface FallbackStrategy {
  primary: () => Promise<any>;
  fallback: () => Promise<any>;
  degrade?: () => Promise<any>;  // 进一步降级
}

async function executeWithFallback<T>(strategy: FallbackStrategy): Promise<T> {
  try {
    return await strategy.primary();
  } catch (error) {
    console.warn(`Primary failed, trying fallback: ${error}`);
    try {
      return await strategy.fallback();
    } catch (fallbackError) {
      if (strategy.degrade) {
        console.warn(`Fallback failed, degrading: ${fallbackError}`);
        return await strategy.degrade();
      }
      throw fallbackError;
    }
  }
}

// 使用示例：LLM 压缩降级
const compressionStrategy: FallbackStrategy = {
  primary: async () => {
    // 尝试 Anthropic API
    return await llmCompress(observations, { provider: 'anthropic' });
  },
  fallback: async () => {
    // 降级到本地模型
    return await llmCompress(observations, { provider: 'local' });
  },
  degrade: async () => {
    // 最终降级：Zero-token 规则压缩
    return new ZeroTokenCompressor().compress(observations);
  }
};
```

---

## 15. 配置系统

### 15.1 配置层级

```
配置优先级（高到低）:
1. 环境变量 (MAFW_*)
2. 项目配置 (.mafw/config.json)
3. 用户全局配置 (~/.mafw/config.json)
4. 默认配置 (内置)
```

### 15.2 完整配置 schema

```typescript
interface MAFWConfig {
  // 核心设置
  version: string;

  // 存储
  storage: {
    backend: 'file' | 'sqlite' | 'leveldb';
    sqlite?: { path: string; cacheSize: number; cacheTTL: number };
    file?: { basePath: string };
    leveldb?: { path: string };
  };

  // 检索
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

  // 压缩
  compression: {
    strategy: 'auto' | 'llm' | 'zero-token' | 'diff' | 'template';
    llm?: { provider: string; model: string; maxTokens: number; temperature: number };
    triggers: {
      minObservations: number;
      minImportance: number;
      maxAgeMinutes: number;
      forceOnSessionEnd: boolean;
      maxObservationsBeforeForce: number;
    };
  };

  // 隐私
  privacy: {
    enabled: boolean;
    rules: string[];
    logRedactions: boolean;
    blockOnCritical: boolean;
    customPatterns: Array<{ name: string; pattern: string; replacement: string }>;
  };

  // 记忆
  memory: {
    energy: {
      decayRatePerDay: number;
      cleanupThreshold: number;
      criticalThreshold: number;
    };
    maxMemoriesPerTier: number;
    mergeSimilarityThreshold: number;
  };

  // Hooks
  hooks: {
    enabled: string[];
    failBehavior: 'continue' | 'stop';
    timeout: number;
  };

  // 并发
  concurrency: {
    maxParallelWaves: number;
    lockTimeout: number;
    stateSyncInterval: number;
  };

  // Dashboard
  dashboard: {
    enabled: boolean;
    port: number;
    viewerPort: number;
    refreshInterval: number;
  };

  // 日志
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    file?: string;
    maxFiles: number;
    maxSize: string;
  };
}

// 默认配置
const defaultConfig: MAFWConfig = {
  version: '5.0.0',
  storage: {
    backend: 'sqlite',
    sqlite: { path: './.mafw/data/state.db', cacheSize: 1000, cacheTTL: 300000 }
  },
  retrieval: {
    enabled: true,
    mode: 'hybrid',
    bm25: { k1: 1.2, b: 0.75, topK: 20 },
    vector: { model: 'Xenova/all-MiniLM-L6-v2', dimensions: 384, topK: 20 },
    graph: { enabled: false, maxDepth: 2, topK: 10 },
    rrf: { k: 60 },
    diversification: { enabled: true, maxPerLoop: 3 },
    tokenBudget: 2000
  },
  compression: {
    strategy: 'auto',
    triggers: {
      minObservations: 5,
      minImportance: 5,
      maxAgeMinutes: 30,
      forceOnSessionEnd: true,
      maxObservationsBeforeForce: 50
    }
  },
  privacy: {
    enabled: true,
    rules: ['api_key', 'password', 'bearer_token', 'private_tag', 'email'],
    logRedactions: true,
    blockOnCritical: false,
    customPatterns: []
  },
  memory: {
    energy: {
      decayRatePerDay: 0.01,
      cleanupThreshold: 0.3,
      criticalThreshold: 0.8
    },
    maxMemoriesPerTier: 1000,
    mergeSimilarityThreshold: 0.85
  },
  hooks: {
    enabled: ['mafw_session_start', 'mafw_tool_observe', 'mafw_compress_on_idle', 'mafw_session_end'],
    failBehavior: 'continue',
    timeout: 5000
  },
  concurrency: {
    maxParallelWaves: 3,
    lockTimeout: 300000,
    stateSyncInterval: 1000
  },
  dashboard: {
    enabled: true,
    port: 3111,
    viewerPort: 3113,
    refreshInterval: 5000
  },
  logging: {
    level: 'info',
    maxFiles: 5,
    maxSize: '10m'
  }
};
```

### 15.3 配置加载

```typescript
class ConfigLoader {
  private config: MAFWConfig;

  async load(): Promise<MAFWConfig> {
    // 1. 从默认配置开始
    let config = { ...defaultConfig };

    // 2. 加载用户全局配置
    const globalConfig = await this.loadFile(`${os.homedir()}/.mafw/config.json`);
    if (globalConfig) {
      config = this.merge(config, globalConfig);
    }

    // 3. 加载项目配置
    const projectConfig = await this.loadFile('./.mafw/config.json');
    if (projectConfig) {
      config = this.merge(config, projectConfig);
    }

    // 4. 加载环境变量
    config = this.applyEnvVars(config);

    this.config = config;
    return config;
  }

  private async loadFile(path: string): Promise<Partial<MAFWConfig> | null> {
    try {
      if (existsSync(path)) {
        const content = readFileSync(path, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.warn(`Failed to load config from ${path}:`, error);
    }
    return null;
  }

  private merge(base: MAFWConfig, override: Partial<MAFWConfig>): MAFWConfig {
    return deepMerge(base, override);
  }

  private applyEnvVars(config: MAFWConfig): MAFWConfig {
    const envMappings: Record<string, string> = {
      'MAFW_STORAGE_BACKEND': 'storage.backend',
      'MAFW_RETRIEVAL_MODE': 'retrieval.mode',
      'MAFW_TOKEN_BUDGET': 'retrieval.tokenBudget',
      'MAFW_COMPRESSION_STRATEGY': 'compression.strategy',
      'MAFW_PRIVACY_ENABLED': 'privacy.enabled',
      'MAFW_DASHBOARD_PORT': 'dashboard.port',
      'MAFW_LOG_LEVEL': 'logging.level'
    };

    for (const [envVar, path] of Object.entries(envMappings)) {
      const value = process.env[envVar];
      if (value !== undefined) {
        setNestedValue(config, path, this.parseValue(value));
      }
    }

    return config;
  }

  private parseValue(value: string): any {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (/^\d+$/.test(value)) return parseInt(value);
    if (/^\d+\.\d+$/.test(value)) return parseFloat(value);
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  get(): MAFWConfig {
    return this.config;
  }
}
```

---

## 附录 A: 完整数据模型

```typescript
// 核心数据模型

interface Goal {
  id: string;
  description: string;
  createdAt: string;
  completedAt?: string;
  status: 'active' | 'completed' | 'failed' | 'abandoned';
  currentLoop: number;
  totalLoops: number;
  metadata: {
    projectPath: string;
    agentType: string;
    tags: string[];
  };
}

interface Loop {
  goalId: string;
  loopNum: number;
  status: 'planning' | 'executing' | 'reviewing' | 'completed' | 'failed';
  plan?: Plan;
  waves: Wave[];
  review?: Review;
  verdict?: 'PASS' | 'FAIL' | 'PARTIAL';
  startTime: string;
  endTime?: string;
  metadata: {
    agentVersions: Record<string, string>;
    contextInjected: boolean;
  };
}

interface Plan {
  goalId: string;
  loopNum: number;
  spec: string;
  tasks: Task[];
  waves: WavePlan[];
  createdAt: string;
  createdBy: string;
}

interface Task {
  id: string;
  description: string;
  type: 'code' | 'test' | 'doc' | 'config' | 'review';
  estimatedComplexity: number;  // 1-10
  dependencies: string[];  // task IDs
  assignedWave: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

interface WavePlan {
  waveNum: number;
  tasks: string[];  // task IDs
  dependencies: number[];  // wave nums
  parallelizable: boolean;
  checkpoint: boolean;  // 是否需要 Review 通过才能继续
}

interface Wave {
  goalId: string;
  loopNum: number;
  waveNum: number;
  status: WaveState;
  tasks: Task[];
  startTime?: string;
  endTime?: string;
  agentId?: string;
  results: WaveResult[];
  error?: string;
  retryCount: number;
}

interface WaveResult {
  taskId: string;
  status: 'success' | 'failure' | 'partial';
  output?: string;
  error?: string;
  duration: number;
  toolsUsed: string[];
  filesModified: string[];
}

interface Review {
  goalId: string;
  loopNum: number;
  reviewer: string;
  verdict: 'PASS' | 'FAIL' | 'PARTIAL';
  summary: string;
  findings: ReviewFinding[];
  metrics: ReviewMetrics;
  createdAt: string;
}

interface ReviewFinding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'bug' | 'security' | 'performance' | 'style' | 'test' | 'doc';
  description: string;
  filePath?: string;
  lineRange?: [number, number];
  suggestion?: string;
}

interface ReviewMetrics {
  coverage?: number;
  complexity?: number;
  testCount?: number;
  lintErrors?: number;
  securityIssues?: number;
}

interface Observation {
  id: string;
  goalId: string;
  loopNum: number;
  phase: 'plan' | 'execute' | 'review';
  type: 'tool_use' | 'file_edit' | 'llm_call' | 'error' | 'state_change';
  content: string;
  metadata: {
    timestamp: string;
    duration?: number;
    toolName?: string;
    filePath?: string;
    success?: boolean;
    errorType?: string;
    redactions?: RedactionLog[];
    [key: string]: any;
  };
}

interface EpisodicMemory {
  id: string;
  goalId: string;
  loopNum: number;
  narrative: string;
  summary: string;
  verdict: 'PASS' | 'FAIL' | 'PARTIAL';
  keyEvents: string[];
  metrics: Record<string, any>;
  timeline: Array<{
    timestamp: string;
    event: string;
    phase: string;
  }>;
  energy: number;
  createdAt: string;
}

interface SemanticMemory {
  id: string;
  goalId: string;
  loopNum: number;
  facts: string[];
  concepts: string[];
  energy: number;
  sourceObservations: string[];  // observation IDs
  sourceLoops: number[];
  provenance: {
    extractedBy: string;
    extractionPrompt: string;
    confidence: number;
  };
  createdAt: string;
}

interface ProceduralMemory {
  id: string;
  pattern: string;
  description: string;
  goalType: string;
  technologies: string[];
  steps: string[];
  successRate: number;
  usageCount: number;
  sourceLoops: number[];
  energy: number;
  createdAt: string;
}

interface ParametricDelta {
  id: string;
  goalId: string;
  phase: 'plan' | 'execute' | 'review';
  type: 'must' | 'must_not' | 'prefer' | 'avoid';
  content: string;
  energy: number;
  sourceLoop: number;
  sourceObservation: string;
  createdAt: string;
}

interface RedactionLog {
  rule: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  position: { start: number; end: number };
  originalLength: number;
  timestamp: string;
}
```

---

## 附录 B: 与 v4.1 的完整对比

| 维度 | v4.1 | v5.0 | 变化 |
|------|------|------|------|
| **架构** | 单 Agent | 多 Agent (Plan/Execute/Review) | 重构 |
| **执行模型** | 线性 | Loop + Wave | 新增 |
| **记忆分层** | 2-tier (raw + compressed) | 5-tier (T1-T4 + L3) | 扩展 |
| **检索** | 无 | Hybrid (BM25 + Vector + RRF) | 新增 |
| **压缩** | 手动 LLM | 自动 + 策略选择 | 自动化 |
| **隐私** | 无 | 自动脱敏 | 新增 |
| **能量系统** | 无 | Energy + 衰减 + 反馈 | 新增 |
| **上下文注入** | 手动 | Skill Entry 自动 | 自动化 |
| **并发** | 无 | Wave 级并行 + 锁 | 新增 |
| **Dashboard** | 简单状态 | 完整看板 + 回放 | 升级 |
| **配置** | 硬编码 | 分层配置系统 | 新增 |
| **错误处理** | 简单重试 | 熔断 + 降级 | 增强 |
| **存储** | JSON 文件 | SQLite + 文件缓存 | 升级 |
| **图谱** | 无 | 可选知识图谱 | 新增 |
| **状态机** | 隐式 | 显式 Loop/Wave 状态机 | 新增 |
