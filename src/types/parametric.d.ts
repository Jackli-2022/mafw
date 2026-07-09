/**
 * L3 Parametric Memory — 类型定义
 *
 * 三种 Delta 类型：
 *   - Constraint Δ (硬约束): 违反即 Review fail
 *   - Prompt Δ (提示词增量): 修正认知偏差
 *   - Pattern Δ (模式增量): 预设 Wave 分解模式
 *
 * 防污染机制：Agent 禁止读取/引用/输出 [PARAMETRIC MEMORY] 区块
 */

export type DeltaType = 'constraint' | 'prompt' | 'pattern';
export type EnforcementLevel = 'hard' | 'soft' | 'pattern';

/** L3 Δ 基础接口 */
export interface BaseDelta {
  id: string;
  scope: string[];               // 作用域 Agent，如 ['plan', 'execute']
  enforcement: EnforcementLevel; // hard | soft | pattern

  trigger_condition: TriggerCondition;

  origin: {
    goal: string;
    loop: number;
    task: string;
    lesson_anchor?: string;
  };

  created_at: string; // ISO 8601
  energy_score: number;  // 0.0 ~ 1.0，越高越可靠
  verified: boolean;       // 是否经过 Archive 阶段验证
  priority: number;      // 1-10，注入截断时按 priority DESC 排序
}

/** Constraint Δ — 硬约束增量 */
export interface ConstraintDelta extends BaseDelta {
  type: 'constraint';
  enforcement: 'hard';
  rule: string;           // 自然语言规则，Agent 必须遵守
  max_injections?: number;
  injection_count?: number;
}

/** Prompt Δ — 提示词增量 */
export interface PromptDelta extends BaseDelta {
  type: 'prompt';
  enforcement: 'soft';
  prompt_delta: string;   // 直接注入 System Prompt 的文本
  max_injections?: number;
  injection_count?: number;
}

/** Pattern Δ — 模式增量 */
export interface PatternDelta extends BaseDelta {
  type: 'pattern';
  enforcement: 'pattern';
  pattern_template: string; // 预设 Wave 分解/编码模式
  usage_stats?: {
    injected_count: number;
    success_count: number;
  };
}

export type Delta = ConstraintDelta | PromptDelta | PatternDelta;

/** TriggerCondition — Δ 触发条件 */
export interface TriggerCondition {
  domain?: string[];
  task_type?: string[];
  affected_file_pattern?: string[];
  loop_stage?: string[];
  keywords?: string[];
  goal_keywords?: string[];
  min_loop_count?: number;
}

/** Parametric Memory Store 配置 */
export interface StoreConfig {
  baseDir: string;           // .mafw/parametric/
  bannedDir: string;
  manifestFile: string;
}

/** L3 注入结果 */
export interface InjectionResult {
  injected: Delta[];
  totalTokens: number;
  truncated: boolean;        // 是否因超 token 被截断
}

/** L3 去重/合并结果 */
export interface MergeResult {
  merged: Delta[];
  conflicts: Conflict[];
  banned: string[];          // 被熔断的 delta id 列表
}

export interface Conflict {
  deltaId: string;
  reason: 'duplicate' | 'oscillation' | 'superseded';
  suggestion: string;
}

/** 防污染检测结果 */
export interface PollutionCheck {
  clean: boolean;
  violations: string[];      // 违规 Agent 输出片段
}

/** 固化清单 */
export interface BaseSkillManifest {
  manifest_version: number;
  merged_deltas: MergedDeltaEntry[];
}

export interface MergedDeltaEntry {
  id: string;
  merged_at: string;
  merged_into: string;       // 如 "AGENTS.md:§3.1"
  energy_score: number;
}

/** L3 震荡检测结果 */
export interface OscillationResult {
  isOscillating: boolean;
  deltaId?: string;
  reason?: string;
  suggestion?: string;
}
