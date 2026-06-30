/**
 * MAFW Loop Agent — Plugin Main Entry Point (v4.1)
 *
 * Re-exports all modules for easy consumption.
 */

// ── Plugin ──
export { default as MafwPlugin } from './plugin';

// ── Engine ──
export { transitionPhase, getCurrentPhase, canExecuteInPhase, recordSession, markSessionDestroyed, updateWaveProgress, shouldStartNextLoop, startNextLoop } from './engine/phase-orchestrator';
export { GoalWorktreeManager, WorktreeInfo } from './engine/goal-worktree-manager';
export { TaskBranchManager } from './engine/task-branch-manager';
export { LessonManager } from './engine/lesson-manager';
export { ReportGenerator } from './engine/report-generator';
export { DegradationStrategy } from './engine/degradation';
export { WaveExecutor } from './engine/wave-executor';

// ── Memory (L3 Parametric) ──
export { ParametricStore } from './memory/store';
export { DeltaInjector } from './memory/injector';
export { MemoryExtractor } from './memory/extractor';
export { DeltaValidator } from './memory/validator';
export { TriggerMatcher } from './memory/matcher';
export { DeltaMerger } from './memory/merger';

// ── Compression (L1, L2) ──
export { SessionPruner } from './compression/session-pruner';
export { LessonCompactor } from './compression/lesson-compactor';
export { CompressionVerifier } from './compression/compression-verifier';
export { MemoryIndexManager } from './compression/memory-index';

// ── Utils ──
export { updateState, loadState, loadRequest, loadGoal, loadWaves, loadReceipts, loadReview, extractGoalId, stateExists, initState } from './utils/state';
export { StatusManager, GoalStatus } from './utils/status';
export { GitUtils } from './utils/git';
export { GitHubConnector } from './utils/github';

// ── Hooks ──
export { sessionEndingHook } from './hooks/session-ending';
export { toolExecutedHook } from './hooks/tool-executed';

// ── Tools ──
export { RemoteCliConnector } from './tools/remote-cli';
export { buildPlanPrompt, parsePlanResponse, formatTaskMarkdown } from './tools/run-plan';
export { buildTaskPrompt } from './tools/run-execute-wave';
export { buildReviewPrompt, parseReviewResponse, formatReview, formatLesson } from './tools/run-review';
export { writeLesson } from './tools/write-lesson';
export { archiveWorktree } from './tools/archive-worktree';

// ── Types ──
export * from './types/parametric';
export * from './types/compression';
export * from './types/state';

console.log('[MAFW Plugin] v4.1 loaded — Phase Relay + TMEM + Automation');
