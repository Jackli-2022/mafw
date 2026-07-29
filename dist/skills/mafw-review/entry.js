"use strict";
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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.mafwReviewEntry = mafwReviewEntry;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const state_1 = require("../../utils/state");
const phase_orchestrator_1 = require("../../engine/phase-orchestrator");
const state_2 = require("../../utils/state");
const lesson_manager_1 = require("../../engine/lesson-manager");
const extractor_1 = require("../../memory/extractor");
const store_1 = require("../../memory/store");
const remote_cli_1 = require("../../tools/remote-cli");
async function mafwReviewEntry(context) {
    const goalId = (0, state_1.extractGoalId)(context.message);
    const projectDir = process.cwd();
    console.log(`[mafw-review] Starting Review for Goal: ${goalId}`);
    // 1. 读取状态
    const state = await (0, state_1.loadState)(goalId, projectDir);
    const req = await (0, state_1.loadRequest)(goalId, projectDir);
    // 2. 记录 Session
    await (0, phase_orchestrator_1.recordSession)(goalId, 'review', context.sessionId, projectDir);
    // 3. 读取 Execute 产出（Receipts + Diff）
    const receipts = await (0, state_2.loadReceipts)(goalId, projectDir);
    const diff = await gitDiffGoal(goalId, projectDir);
    console.log(`[mafw-review] Loaded ${receipts.length} receipts, diff: ${diff.length} chars`);
    // 4. 读取远程 CLI 测试结果（如果配置）
    let remoteResults = null;
    if (req.remoteCli?.testCommand) {
        const remoteCli = new remote_cli_1.RemoteCliConnector();
        console.log(`[mafw-review] Running remote tests: ${req.remoteCli.testCommand}`);
        remoteResults = await remoteCli.run({
            host: req.remoteCli.host,
            command: req.remoteCli.testCommand,
            cwd: req.remoteCli.projectDir
        });
        console.log(`[mafw-review] Remote test result: ${remoteResults.success ? 'PASS' : 'FAIL'}`);
    }
    // 5. 读取验收标准
    const metrics = req.metrics;
    const boundaries = req.boundaries;
    const goal = await (0, state_1.loadGoal)(goalId, projectDir);
    // 6. 拼接 Review Prompt
    const prompt = buildReviewPrompt({ receipts, diff, metrics, boundaries, remoteResults, goal });
    // 7. 调用 LLM 审查
    console.log(`[mafw-review] Calling LLM...`);
    const response = await context.llm.chat({
        model: context.config.model,
        messages: [{ role: 'user', content: prompt }]
    });
    // 8. 解析 Review 结果
    const review = parseReviewResponse(response.content);
    console.log(`[mafw-review] Verdict: ${review.verdict}`);
    // 9. 写入 review 文件
    const reviewsDir = path.join(projectDir, '.mafw/reviews');
    if (!fs.existsSync(reviewsDir))
        fs.mkdirSync(reviewsDir, { recursive: true });
    const reviewPath = path.join(reviewsDir, `${goalId}-loop${state.loop}.md`);
    fs.writeFileSync(reviewPath, formatReview(review), 'utf-8');
    console.log(`[mafw-review] Written ${reviewPath}`);
    // 10. 如果失败，写入 lesson + 压缩 + 提取 Δ
    if (review.verdict === 'FAIL') {
        const lessonsDir = path.join(projectDir, '.mafw/lessons');
        if (!fs.existsSync(lessonsDir))
            fs.mkdirSync(lessonsDir, { recursive: true });
        const lessonPath = path.join(lessonsDir, `${goalId}-loop${state.loop}.md`);
        fs.writeFileSync(lessonPath, formatLesson(review), 'utf-8');
        console.log(`[mafw-review] Written lesson ${lessonPath}`);
        const lessonManager = new lesson_manager_1.LessonManager(projectDir);
        await lessonManager.compactLastLesson(goalId);
        const extractor = new extractor_1.MemoryExtractor();
        const compacted = lessonManager.loadAll(goalId).slice(-1)[0];
        if (compacted) {
            const deltas = extractor.extract(compacted);
            const store = new store_1.ParametricStore({
                baseDir: path.join(projectDir, '.mafw/parametric'),
                bannedDir: path.join(projectDir, '.mafw/parametric/banned'),
                manifestFile: path.join(projectDir, '.mafw/parametric/base-skill-manifest.yaml')
            });
            for (const delta of deltas)
                store.save(delta);
        }
    }
    // 11. 【显式状态更新】由 Review Skill 直接判定 verdict，不再交给 Gateway
    await evaluateReviewResult(goalId, state, req, review, projectDir);
    console.log(`[mafw-review] Review complete. State updated`);
}
async function evaluateReviewResult(goalId, state, req, review, projectDir) {
    const metricsOk = checkMetrics(req.metrics, review.metrics);
    const reviewArtifact = `reviews/${goalId}-loop${state.loop}.md`;
    if (review.verdict === 'PASS' && metricsOk) {
        await (0, phase_orchestrator_1.transitionPhase)(goalId, {
            from: 'REVIEWING',
            to: 'REVIEWING_COMPLETE',
            nextAction: 'PASS',
            artifacts: { review: reviewArtifact },
            metrics: review.metrics
        }, projectDir);
        console.log(`[mafw-review] PASS → REVIEWING_COMPLETE`);
        await (0, phase_orchestrator_1.handleLoopEvent)(goalId, 'review.complete', { verdict: 'PASS' }, state.loop, projectDir);
        return;
    }
    if (state.loop >= req.maxLoops) {
        await (0, phase_orchestrator_1.transitionPhase)(goalId, {
            from: 'REVIEWING',
            to: 'REVIEWING_COMPLETE',
            nextAction: 'FAIL',
            error: 'max_loops_reached',
            artifacts: { review: reviewArtifact },
            metrics: review.metrics
        }, projectDir);
        console.log(`[mafw-review] FAIL but maxLoops reached → REVIEWING_COMPLETE`);
        await (0, phase_orchestrator_1.handleLoopEvent)(goalId, 'review.complete', { verdict: 'PARTIAL' }, state.loop, projectDir);
        return;
    }
    await (0, phase_orchestrator_1.transitionPhase)(goalId, {
        from: 'REVIEWING',
        to: 'REVIEWING_COMPLETE',
        nextAction: 'FAIL',
        artifacts: { review: reviewArtifact },
        metrics: review.metrics
    }, projectDir);
    console.log(`[mafw-review] FAIL → REVIEWING_COMPLETE`);
    await (0, phase_orchestrator_1.handleLoopEvent)(goalId, 'review.complete', { verdict: 'FAIL' }, state.loop, projectDir);
}
function checkMetrics(reqMetrics, reviewMetrics) {
    if (!reviewMetrics)
        return true;
    for (const [key, target] of Object.entries(reqMetrics)) {
        const actual = reviewMetrics[key];
        if (actual === undefined)
            continue;
        if (actual < target.target)
            return false;
    }
    return true;
}
// ── 辅助函数 ──
function buildReviewPrompt(options) {
    const { receipts, diff, metrics, boundaries, remoteResults, goal } = options;
    let prompt = `# Review Agent\n\n`;
    prompt += `## Goal Charter\n\n${goal}\n\n`;
    prompt += `## Execution Receipts\n\n`;
    for (const r of receipts) {
        prompt += `### Wave ${r.waveId || 'unknown'}\n\n`;
        prompt += `Status: ${r.status}\n`;
        if (r.tasks) {
            for (const t of r.tasks) {
                prompt += `- Task ${t.taskId}: ${t.status}\n`;
            }
        }
        prompt += '\n';
    }
    prompt += `## Code Changes\n\n\`\`\`diff\n${diff}\n\`\`\`\n\n`;
    prompt += `## Metrics\n\n`;
    for (const [key, value] of Object.entries(metrics)) {
        prompt += `- ${key}: target ${value.target}${value.unit}\n`;
    }
    prompt += '\n';
    prompt += `## Boundaries\n\n`;
    for (const b of boundaries) {
        prompt += `- ${b}\n`;
    }
    prompt += '\n';
    if (remoteResults) {
        prompt += `## Remote Test Results\n\n`;
        prompt += `Success: ${remoteResults.success}\n`;
        prompt += `Output: ${remoteResults.output}\n\n`;
    }
    prompt += `## Instructions\n\n`;
    prompt += `Review the execution results against the goal charter, metrics, and boundaries.\n`;
    prompt += `Return a JSON with:\n`;
    prompt += `- verdict: "PASS" or "FAIL"\n`;
    prompt += `- reason: explanation\n`;
    prompt += `- metrics: actual metric values\n`;
    return prompt;
}
function parseReviewResponse(content) {
    try {
        const data = JSON.parse(content);
        return {
            verdict: data.verdict === 'PASS' ? 'PASS' : 'FAIL',
            reason: data.reason || 'No reason provided',
            metrics: data.metrics || {}
        };
    }
    catch {
        // Fallback: 解析文本
        const pass = content.toLowerCase().includes('pass') || content.toLowerCase().includes('通过');
        return {
            verdict: pass ? 'PASS' : 'FAIL',
            reason: content.slice(0, 200),
            metrics: {}
        };
    }
}
function formatReview(review) {
    return `# Review Report\n\n## Verdict: ${review.verdict}\n\n## Reason\n\n${review.reason}\n\n## Metrics\n\n${Object.entries(review.metrics).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n`;
}
function formatLesson(review) {
    return `# Lesson Learned\n\n## Trigger\n\nReview failed: ${review.reason}\n\n## Metrics\n\n${Object.entries(review.metrics).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\n## Recommendation\n\n${review.reason}\n`;
}
async function gitDiffGoal(goalId, projectDir) {
    // 简化实现，实际应调用 git diff
    return `// Diff for goal ${goalId}\n// (actual diff would be generated by git)`;
}
//# sourceMappingURL=entry.js.map