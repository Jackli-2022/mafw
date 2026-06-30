"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WaveExecutor = void 0;
/**
 * Wave Executor — Wave 调度 + Task 并行执行器 (v2.1)
 *
 * 按 Goal 隔离：所有 Wave/Task 在同一个 Goal 分支上执行。
 * 不再为每个 Task 创建独立分支。
 *
 * 职责：
 *   1. 串行执行 Wave（Wave 间有依赖）
 *   2. 每个 Wave 内并行执行 Task（共享同一个 Goal 分支）
 *   3. 工具输出 > 1000 tokens 时截断
 */
class WaveExecutor {
    projectDir;
    constructor(projectDir = '.') {
        this.projectDir = projectDir;
    }
    async run(waves, goalId, loopCount) {
        const results = [];
        const digests = [];
        for (let i = 0; i < waves.length; i++) {
            const wave = waves[i];
            console.log(`  [WaveExecutor] Wave ${i + 1}/${waves.length}: ${wave.name}`);
            // Wave 内 Task 并行（在同个 Goal 分支上）
            const waveResult = await this.executeWave(wave, goalId, loopCount);
            results.push(waveResult);
            // 生成 Wave 摘要
            const digest = this.createDigest(wave, waveResult, i + 1);
            digests.push(digest);
            // 工具输出截断
            this.truncateToolOutputs(waveResult);
        }
        return {
            waves: results,
            digests,
            loopCount,
            domain: waves[0]?.domain || 'general',
            currentTask: waves[waves.length - 1]?.tasks?.[waves[waves.length - 1].tasks.length - 1]?.id || 'unknown',
            filesChanged: this.collectFilesChanged(results)
        };
    }
    async executeWave(wave, goalId, loopCount) {
        const tasks = wave.tasks || [];
        // 所有 Task 在同个 Goal 分支上并行执行
        const taskResults = await Promise.all(tasks.map((task) => this.executeTask(task, goalId, loopCount)));
        return { waveId: wave.id, tasks: taskResults, status: 'completed' };
    }
    async executeTask(task, goalId, loopCount) {
        console.log(`    [Task] ${task.id} (goal ${goalId}): ${task.description}`);
        // 模拟执行
        const result = {
            taskId: task.id,
            status: 'completed',
            filesChanged: task.affected_files || [],
            metrics: {
                coverage: Math.floor(Math.random() * 40) + 60,
                lint_errors: 0
            },
            output: ''
        };
        return result;
    }
    /**
     * L1 实时：工具输出截断
     */
    truncateToolOutputs(waveResult) {
        for (const task of waveResult.tasks || []) {
            if (task.output && task.output.length > 1000) {
                const lines = task.output.split('\n');
                const lastLines = lines.slice(-10);
                task.output = `[TRUNCATED: ${lines.length} lines → last 10]\n${lastLines.join('\n')}`;
                task._truncated = true;
            }
        }
    }
    createDigest(wave, waveResult, waveNum) {
        return {
            id: `wave-${waveNum}`,
            status: waveResult.tasks.every((t) => t.status === 'completed') ? 'PASS' : 'FAIL',
            tokens_saved: 0,
            domain: wave.domain || 'general',
            completed_tasks: waveResult.tasks.map((t) => t.taskId),
            key_decisions: wave.key_decisions || [],
            metrics: {
                coverage: waveResult.tasks.reduce((sum, t) => sum + (t.metrics?.coverage || 0), 0) / (waveResult.tasks.length || 1),
                lint_errors: waveResult.tasks.reduce((sum, t) => sum + (t.metrics?.lint_errors || 0), 0)
            },
            blockers: waveResult.tasks.filter((t) => t.status !== 'completed').map((t) => t.taskId),
            files_changed: this.collectFilesChanged([waveResult])
        };
    }
    collectFilesChanged(results) {
        const files = new Set();
        for (const r of results) {
            for (const task of r.tasks || []) {
                for (const f of task.filesChanged || [])
                    files.add(f);
            }
        }
        return Array.from(files);
    }
    /**
     * Goal 完成后合并到 main
     */
    async mergeToMain(goalId) {
        console.log(`[WaveExecutor] Goal ${goalId} completed, merging to main`);
    }
}
exports.WaveExecutor = WaveExecutor;
//# sourceMappingURL=wave-executor.js.map