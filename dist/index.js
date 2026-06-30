"use strict";
/**
 * MAFW Loop Agent — Plugin Main Entry Point (v4.1)
 *
 * Re-exports all modules for easy consumption.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeLesson = exports.formatLesson = exports.formatReview = exports.parseReviewResponse = exports.buildReviewPrompt = exports.buildTaskPrompt = exports.formatTaskMarkdown = exports.parsePlanResponse = exports.buildPlanPrompt = exports.RemoteCliConnector = exports.toolExecutedHook = exports.sessionEndingHook = exports.GitHubConnector = exports.GitUtils = exports.StatusManager = exports.initState = exports.stateExists = exports.extractGoalId = exports.loadReview = exports.loadReceipts = exports.loadWaves = exports.loadGoal = exports.loadRequest = exports.loadState = exports.updateState = exports.MemoryIndexManager = exports.CompressionVerifier = exports.LessonCompactor = exports.SessionPruner = exports.DeltaMerger = exports.TriggerMatcher = exports.DeltaValidator = exports.MemoryExtractor = exports.DeltaInjector = exports.ParametricStore = exports.WaveExecutor = exports.DegradationStrategy = exports.ReportGenerator = exports.LessonManager = exports.TaskBranchManager = exports.GoalWorktreeManager = exports.startNextLoop = exports.shouldStartNextLoop = exports.updateWaveProgress = exports.markSessionDestroyed = exports.recordSession = exports.canExecuteInPhase = exports.getCurrentPhase = exports.transitionPhase = exports.MafwPlugin = void 0;
exports.archiveWorktree = void 0;
// ── Plugin ──
var plugin_1 = require("./plugin");
Object.defineProperty(exports, "MafwPlugin", { enumerable: true, get: function () { return __importDefault(plugin_1).default; } });
// ── Engine ──
var phase_orchestrator_1 = require("./engine/phase-orchestrator");
Object.defineProperty(exports, "transitionPhase", { enumerable: true, get: function () { return phase_orchestrator_1.transitionPhase; } });
Object.defineProperty(exports, "getCurrentPhase", { enumerable: true, get: function () { return phase_orchestrator_1.getCurrentPhase; } });
Object.defineProperty(exports, "canExecuteInPhase", { enumerable: true, get: function () { return phase_orchestrator_1.canExecuteInPhase; } });
Object.defineProperty(exports, "recordSession", { enumerable: true, get: function () { return phase_orchestrator_1.recordSession; } });
Object.defineProperty(exports, "markSessionDestroyed", { enumerable: true, get: function () { return phase_orchestrator_1.markSessionDestroyed; } });
Object.defineProperty(exports, "updateWaveProgress", { enumerable: true, get: function () { return phase_orchestrator_1.updateWaveProgress; } });
Object.defineProperty(exports, "shouldStartNextLoop", { enumerable: true, get: function () { return phase_orchestrator_1.shouldStartNextLoop; } });
Object.defineProperty(exports, "startNextLoop", { enumerable: true, get: function () { return phase_orchestrator_1.startNextLoop; } });
var goal_worktree_manager_1 = require("./engine/goal-worktree-manager");
Object.defineProperty(exports, "GoalWorktreeManager", { enumerable: true, get: function () { return goal_worktree_manager_1.GoalWorktreeManager; } });
var task_branch_manager_1 = require("./engine/task-branch-manager");
Object.defineProperty(exports, "TaskBranchManager", { enumerable: true, get: function () { return task_branch_manager_1.TaskBranchManager; } });
var lesson_manager_1 = require("./engine/lesson-manager");
Object.defineProperty(exports, "LessonManager", { enumerable: true, get: function () { return lesson_manager_1.LessonManager; } });
var report_generator_1 = require("./engine/report-generator");
Object.defineProperty(exports, "ReportGenerator", { enumerable: true, get: function () { return report_generator_1.ReportGenerator; } });
var degradation_1 = require("./engine/degradation");
Object.defineProperty(exports, "DegradationStrategy", { enumerable: true, get: function () { return degradation_1.DegradationStrategy; } });
var wave_executor_1 = require("./engine/wave-executor");
Object.defineProperty(exports, "WaveExecutor", { enumerable: true, get: function () { return wave_executor_1.WaveExecutor; } });
// ── Memory (L3 Parametric) ──
var store_1 = require("./memory/store");
Object.defineProperty(exports, "ParametricStore", { enumerable: true, get: function () { return store_1.ParametricStore; } });
var injector_1 = require("./memory/injector");
Object.defineProperty(exports, "DeltaInjector", { enumerable: true, get: function () { return injector_1.DeltaInjector; } });
var extractor_1 = require("./memory/extractor");
Object.defineProperty(exports, "MemoryExtractor", { enumerable: true, get: function () { return extractor_1.MemoryExtractor; } });
var validator_1 = require("./memory/validator");
Object.defineProperty(exports, "DeltaValidator", { enumerable: true, get: function () { return validator_1.DeltaValidator; } });
var matcher_1 = require("./memory/matcher");
Object.defineProperty(exports, "TriggerMatcher", { enumerable: true, get: function () { return matcher_1.TriggerMatcher; } });
var merger_1 = require("./memory/merger");
Object.defineProperty(exports, "DeltaMerger", { enumerable: true, get: function () { return merger_1.DeltaMerger; } });
// ── Compression (L1, L2) ──
var session_pruner_1 = require("./compression/session-pruner");
Object.defineProperty(exports, "SessionPruner", { enumerable: true, get: function () { return session_pruner_1.SessionPruner; } });
var lesson_compactor_1 = require("./compression/lesson-compactor");
Object.defineProperty(exports, "LessonCompactor", { enumerable: true, get: function () { return lesson_compactor_1.LessonCompactor; } });
var compression_verifier_1 = require("./compression/compression-verifier");
Object.defineProperty(exports, "CompressionVerifier", { enumerable: true, get: function () { return compression_verifier_1.CompressionVerifier; } });
var memory_index_1 = require("./compression/memory-index");
Object.defineProperty(exports, "MemoryIndexManager", { enumerable: true, get: function () { return memory_index_1.MemoryIndexManager; } });
// ── Utils ──
var state_1 = require("./utils/state");
Object.defineProperty(exports, "updateState", { enumerable: true, get: function () { return state_1.updateState; } });
Object.defineProperty(exports, "loadState", { enumerable: true, get: function () { return state_1.loadState; } });
Object.defineProperty(exports, "loadRequest", { enumerable: true, get: function () { return state_1.loadRequest; } });
Object.defineProperty(exports, "loadGoal", { enumerable: true, get: function () { return state_1.loadGoal; } });
Object.defineProperty(exports, "loadWaves", { enumerable: true, get: function () { return state_1.loadWaves; } });
Object.defineProperty(exports, "loadReceipts", { enumerable: true, get: function () { return state_1.loadReceipts; } });
Object.defineProperty(exports, "loadReview", { enumerable: true, get: function () { return state_1.loadReview; } });
Object.defineProperty(exports, "extractGoalId", { enumerable: true, get: function () { return state_1.extractGoalId; } });
Object.defineProperty(exports, "stateExists", { enumerable: true, get: function () { return state_1.stateExists; } });
Object.defineProperty(exports, "initState", { enumerable: true, get: function () { return state_1.initState; } });
var status_1 = require("./utils/status");
Object.defineProperty(exports, "StatusManager", { enumerable: true, get: function () { return status_1.StatusManager; } });
var git_1 = require("./utils/git");
Object.defineProperty(exports, "GitUtils", { enumerable: true, get: function () { return git_1.GitUtils; } });
var github_1 = require("./utils/github");
Object.defineProperty(exports, "GitHubConnector", { enumerable: true, get: function () { return github_1.GitHubConnector; } });
// ── Hooks ──
var session_ending_1 = require("./hooks/session-ending");
Object.defineProperty(exports, "sessionEndingHook", { enumerable: true, get: function () { return session_ending_1.sessionEndingHook; } });
var tool_executed_1 = require("./hooks/tool-executed");
Object.defineProperty(exports, "toolExecutedHook", { enumerable: true, get: function () { return tool_executed_1.toolExecutedHook; } });
// ── Tools ──
var remote_cli_1 = require("./tools/remote-cli");
Object.defineProperty(exports, "RemoteCliConnector", { enumerable: true, get: function () { return remote_cli_1.RemoteCliConnector; } });
var run_plan_1 = require("./tools/run-plan");
Object.defineProperty(exports, "buildPlanPrompt", { enumerable: true, get: function () { return run_plan_1.buildPlanPrompt; } });
Object.defineProperty(exports, "parsePlanResponse", { enumerable: true, get: function () { return run_plan_1.parsePlanResponse; } });
Object.defineProperty(exports, "formatTaskMarkdown", { enumerable: true, get: function () { return run_plan_1.formatTaskMarkdown; } });
var run_execute_wave_1 = require("./tools/run-execute-wave");
Object.defineProperty(exports, "buildTaskPrompt", { enumerable: true, get: function () { return run_execute_wave_1.buildTaskPrompt; } });
var run_review_1 = require("./tools/run-review");
Object.defineProperty(exports, "buildReviewPrompt", { enumerable: true, get: function () { return run_review_1.buildReviewPrompt; } });
Object.defineProperty(exports, "parseReviewResponse", { enumerable: true, get: function () { return run_review_1.parseReviewResponse; } });
Object.defineProperty(exports, "formatReview", { enumerable: true, get: function () { return run_review_1.formatReview; } });
Object.defineProperty(exports, "formatLesson", { enumerable: true, get: function () { return run_review_1.formatLesson; } });
var write_lesson_1 = require("./tools/write-lesson");
Object.defineProperty(exports, "writeLesson", { enumerable: true, get: function () { return write_lesson_1.writeLesson; } });
var archive_worktree_1 = require("./tools/archive-worktree");
Object.defineProperty(exports, "archiveWorktree", { enumerable: true, get: function () { return archive_worktree_1.archiveWorktree; } });
// ── Types ──
__exportStar(require("./types/parametric"), exports);
__exportStar(require("./types/compression"), exports);
__exportStar(require("./types/state"), exports);
console.log('[MAFW Plugin] v4.1 loaded — Phase Relay + TMEM + Automation');
//# sourceMappingURL=index.js.map