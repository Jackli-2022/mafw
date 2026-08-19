import { log } from './utils/logger';
/**
 * MAFW Loop Agent —Plugin Main Entry Point (v4.1)
 *
 * Re-exports all modules for easy consumption.
 */

// 鈹€鈹€ Plugin 鈹€鈹€
export { default as MafwPlugin } from './plugin';

// 鈹€鈹€ Engine 鈹€鈹€
export { transitionPhase, getCurrentPhase, canExecuteInPhase, recordSession, markSessionDestroyed, updateWaveProgress, shouldStartNextLoop, startNextLoop } from './engine/phase-orchestrator';
export { GoalWorktreeManager, WorktreeInfo } from './engine/goal-worktree-manager';
export { TaskBranchManager } from './engine/task-branch-manager';
export { LessonManager } from './engine/lesson-manager';
export { ReportGenerator } from './engine/report-generator';
export { DegradationStrategy } from './engine/degradation';
export { WaveExecutor } from './engine/wave-executor';

// 鈹€鈹€ Memory (L3 Parametric) 鈹€鈹€
export { ParametricStore } from './memory/store';
export { DeltaInjector } from './memory/injector';
export { MemoryExtractor } from './memory/extractor';
export { DeltaValidator } from './memory/validator';
export { TriggerMatcher } from './memory/matcher';
export { DeltaMerger } from './memory/merger';

// 鈹€鈹€ Memory (T1 Observations / Harmonic) 鈹€鈹€
export { T1Store } from './memory/t1-store';
export type { T1Observation } from './memory/t1-store';
export { T1ToT2Compressor } from './memory/t1-to-t2-compressor';
export type { T1ToT2Result } from './memory/t1-to-t2-compressor';

// 鈹€鈹€ Compression (L1, L2) 鈹€鈹€
export { SessionPruner } from './compression/session-pruner';
export { LessonCompactor } from './compression/lesson-compactor';
export { CompressionVerifier } from './compression/compression-verifier';
export { MemoryIndexManager } from './compression/memory-index';

// 鈹€鈹€ Utils 鈹€鈹€
export { updateState, loadState, loadRequest, loadGoal, loadWaves, loadReceipts, loadReview, extractGoalId, stateExists, initState } from './utils/state';
export { StatusManager, GoalStatus } from './utils/status';
export { GitUtils } from './utils/git';
export { GitHubConnector } from './utils/github';

// 鈹€鈹€ Hooks 鈹€鈹€
export { sessionEndingHook } from './hooks/session-ending';
export { toolExecutedHook } from './hooks/tool-executed';

// 鈹€鈹€ Tools 鈹€鈹€
export { RemoteCliConnector } from './tools/remote-cli';
export { buildPlanPrompt, parsePlanResponse, formatTaskMarkdown } from './tools/run-plan';
export { buildTaskPrompt } from './tools/run-execute-wave';
export { buildReviewPrompt, parseReviewResponse, formatReview, formatLesson } from './tools/run-review';
export { writeLesson } from './tools/write-lesson';
export { archiveWorktree } from './tools/archive-worktree';

// 鈹€鈹€ Types 鈹€鈹€
export * from './types/parametric';
export * from './types/compression';
export * from './types/state';

log.info('[MAFW Plugin] v4.1 loaded —Phase Relay + TMEM + Automation');


