/**
 * 三层压缩系统 — 类型定义
 *
 * L1: Session Pruner (实时剪枝)
 * L2: Lesson Compactor (结构化压实) + Memory Index (倒排检索)
 * L3: Delta Injector (参数注入)
 */

/** Token 预算配置 */
export interface TokenBudgetConfig {
  maxContextTokens: number;       // 8000
  compressionThreshold: number;   // 0.6 (4800 tokens)
  currentWaveReserve: number;     // 2000 tokens
  toolOutputReserve: number;      // 10 lines
}

/** L2 压缩前 Lesson (自然语言) */
export interface RawLesson {
  loop: number;
  trigger: string;              // 'initial' | 'stop_hook' | 'degraded'
  result: string;               // 'review_fail' | 'completion_promise' | 'degraded'
  domain: string;
  task: string;
  violation?: {
    rule: string;
    type: string;               // 'boundary_cross' | 'metric_miss' | 'quality_issue'
    severity: 'critical' | 'high' | 'medium' | 'low';
  };
  root_cause?: string;
  details?: Record<string, any>;
  lesson: string;               // 自然语言教训
  energy: 'high' | 'medium' | 'low';
  files: string[];
  metrics?: Record<string, number>;
  applied_deltas?: string[];
  created_at: string;
}

/** L2 压缩后 Lesson (结构化 YAML) */
export interface CompactedLesson {
  loop: number;
  trigger: string;
  result: string;
  domain: string;
  task: string;
  violation?: {
    rule: string;
    type: string;
    severity: string;
  };
  root_cause?: string;
  details?: Record<string, any>;
  lesson: string;
  energy: string;
  files: string[];
  metrics?: Record<string, number>;
  applied_deltas?: string[];
  created_at: string;
  // 压缩元数据
  _compacted: boolean;
  _originalTokens: number;
  _compactedTokens: number;
}

/** L2 倒排索引条目 */
export interface MemoryIndexEntry {
  id: string;
  file: string;                 // lessons/xxx.md
  anchor: string;               // 行号，如 "L12"
  tags: string[];
  energy: number;               // 0.0 ~ 1.0
  type: 'constraint_source' | 'pattern_source' | 'quality_issue' | 'metric_miss';
  loop: number;
  goal: string;
}

/** L2 索引结构 */
export interface MemoryIndex {
  version: string;
  entries: MemoryIndexEntry[];
  inverted_index: Record<string, string[]>;  // tag -> entry_ids
  domain_index: Record<string, string[]>;    // domain -> entry_ids
}

/** L1 Wave 摘要卡片 */
export interface WaveDigest {
  id: string;
  status: 'PASS' | 'FAIL' | 'DEGRADED';
  tokens_saved: number;
  domain: string;
  completed_tasks: string[];
  key_decisions: string[];
  metrics: Record<string, number>;
  blockers: string[];
  files_changed: string[];
}

/** L1 Session 内容类型 */
export type SessionContentType =
  | 'system_prompt'
  | 'parametric_delta'
  | 'task_definition'
  | 'code_edit'
  | 'tool_output'
  | 'dialogue'
  | 'test_log_success'
  | 'test_log_fail';

/** L1 压缩策略 */
export interface CompressionStrategy {
  contentType: SessionContentType;
  currentWave: 'full' | 'summary' | 'truncate' | 'discard';
  completedWave: 'full' | 'summary' | 'truncate' | 'discard';
}

/** L2 压缩验证清单 */
export interface CompressionVerification {
  ruleId: string;
  description: string;
  check: (original: RawLesson, compacted: CompactedLesson) => boolean;
}

/** 压缩结果 */
export interface CompactionResult {
  success: boolean;
  original: RawLesson;
  compacted: CompactedLesson;
  errors: string[];
}
