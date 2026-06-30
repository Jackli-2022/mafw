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
exports.mafwExecuteEntry = mafwExecuteEntry;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const state_1 = require("../../utils/state");
const phase_orchestrator_1 = require("../../engine/phase-orchestrator");
const goal_worktree_manager_1 = require("../../engine/goal-worktree-manager");
const task_branch_manager_1 = require("../../engine/task-branch-manager");
const remote_cli_1 = require("../../tools/remote-cli");
async function mafwExecuteEntry(context) {
    const goalId = (0, state_1.extractGoalId)(context.message);
    const projectDir = process.cwd();
    console.log(`[mafw-execute] Starting Execute for Goal: ${goalId}`);
    // 1. 读取状态
    const state = await (0, state_1.loadState)(goalId, projectDir);
    const req = await (0, state_1.loadRequest)(goalId, projectDir);
    // 2. 记录 Session
    await (0, phase_orchestrator_1.recordSession)(goalId, 'execute', context.sessionId, projectDir);
    // 3. 准备 Worktree
    const worktreeManager = new goal_worktree_manager_1.GoalWorktreeManager(projectDir);
    const worktree = await worktreeManager.prepare({
        projectDir,
        goalId,
        parallel: req.parallel || false
    });
    console.log(`[mafw-execute] Worktree ready: ${worktree.branch} at ${worktree.worktreeDir}`);
    // 4. 读取 Waves
    const waves = await (0, state_1.loadWaves)(goalId, projectDir);
    if (waves.length === 0) {
        throw new Error(`No waves found for goal ${goalId}`);
    }
    console.log(`[mafw-execute] ${waves.length} waves to execute`);
    // 5. 执行 Waves
    const taskBranchManager = new task_branch_manager_1.TaskBranchManager();
    const receipts = [];
    for (let i = 0; i < waves.length; i++) {
        const wave = waves[i];
        console.log(`[mafw-execute] Wave ${i + 1}/${waves.length}: ${wave.name || 'unnamed'}`);
        // 更新 Wave 进度
        await (0, phase_orchestrator_1.updateWaveProgress)(goalId, i + 1, waves.length, projectDir);
        // Wave 内 Task 并行（各自 Git 分支）
        const waveResult = await executeWave(wave, {
            goalId,
            worktreeDir: worktree.worktreeDir,
            baseBranch: worktree.branch,
            loopNum: state.loop,
            llm: context.llm,
            model: context.config.model,
            taskBranchManager
        });
        receipts.push({ waveId: wave.id, ...waveResult });
        // 合并 Wave 到 Goal 分支
        await mergeWaveToGoal(wave, worktree.worktreeDir);
    }
    // 6. 远程 CLI 同步（如果配置）
    if (req.remoteCli?.syncOnExecute) {
        const remoteCli = new remote_cli_1.RemoteCliConnector();
        console.log(`[mafw-execute] Syncing to remote: ${req.remoteCli.host}`);
        const syncResult = await remoteCli.sync({
            localDir: worktree.worktreeDir,
            remoteHost: req.remoteCli.host,
            remoteDir: req.remoteCli.projectDir
        });
        if (!syncResult.success) {
            console.error(`[mafw-execute] Remote sync failed: ${syncResult.output}`);
            // 不抛出错误，继续执行，但记录
        }
        receipts.push({ phase: 'sync', result: syncResult });
    }
    // 7. 写入 receipts
    await writeReceipts(goalId, projectDir, receipts);
    console.log(`[mafw-execute] Written ${receipts.length} receipts`);
    // 8. 【显式状态更新】通知 Scheduler 进入 REVIEWING
    await (0, phase_orchestrator_1.transitionPhase)(goalId, {
        from: 'EXECUTING',
        to: 'EXECUTING_COMPLETE',
        nextAction: 'CREATE_REVIEW_SESSION',
        artifacts: { execute: `receipts/${goalId}/` }
    }, projectDir);
    console.log(`[mafw-execute] Execute complete. State updated → CREATE_REVIEW_SESSION`);
}
// ── Wave 执行 ──
async function executeWave(wave, options) {
    const { goalId, worktreeDir, baseBranch, loopNum, llm, model, taskBranchManager } = options;
    const tasks = wave.tasks || [];
    // Task 并行执行（各自 Git 分支）
    const taskResults = await Promise.all(tasks.map(async (task) => {
        try {
            // 创建 Task 分支
            const branch = await taskBranchManager.createTaskBranch(worktreeDir, task.id, baseBranch);
            console.log(`  [Task] ${task.id}: branch ${branch}`);
            // 调用 LLM 编写代码
            const taskPrompt = buildTaskPrompt(task, worktreeDir);
            const response = await llm.chat({
                model,
                messages: [{ role: 'user', content: taskPrompt }]
            });
            // 写入文件（模拟）
            // 实际应由 LLM 生成文件内容并写入
            await writeTaskCode(task, response.content, worktreeDir);
            // Git commit
            // await gitCommit(worktreeDir, `task(${task.id}): ${task.description}`);
            return {
                taskId: task.id,
                status: 'completed',
                branch,
                filesChanged: task.affected_files || []
            };
        }
        catch (err) {
            console.error(`  [Task] ${task.id} failed: ${err.message}`);
            return {
                taskId: task.id,
                status: 'failed',
                error: err.message
            };
        }
    }));
    return { tasks: taskResults, status: 'completed' };
}
// ── 合并 Wave ──
async function mergeWaveToGoal(wave, worktreeDir) {
    // 合并 Wave 内所有 Task 分支到 Goal 分支
    console.log(`[mafw-execute] Merging wave ${wave.id} into goal branch`);
    // 实际实现应使用 git merge
}
// ── 写入 Receipts ──
async function writeReceipts(goalId, projectDir, receipts) {
    const receiptsDir = path.join(projectDir, '.opencode/mafw/receipts', goalId);
    if (!fs.existsSync(receiptsDir)) {
        fs.mkdirSync(receiptsDir, { recursive: true });
    }
    const receiptFile = path.join(receiptsDir, `loop-receipt.json`);
    fs.writeFileSync(receiptFile, JSON.stringify({
        goalId,
        timestamp: new Date().toISOString(),
        receipts
    }, null, 2), 'utf-8');
}
// ── 辅助 ──
function buildTaskPrompt(task, worktreeDir) {
    return `# Task: ${task.id}\n\n${task.description}\n\n## Affected Files\n\n${(task.affected_files || []).join('\n')}\n\n## Instructions\n\nImplement this task. Write the code to the affected files.\nWorktree: ${worktreeDir}\n`;
}
async function writeTaskCode(task, content, worktreeDir) {
    // 解析 content 中的文件内容并写入
    // 简化实现：直接写入一个文件
    for (const file of task.affected_files || []) {
        const filePath = path.join(worktreeDir, file);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, `// Generated by MAFW Execute Agent\n// Task: ${task.id}\n\n${content}`, 'utf-8');
    }
}
//# sourceMappingURL=entry.js.map