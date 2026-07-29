"use strict";
/**
 * Archive Worktree Tool — Archive tool 函数
 *
 * 职责：
 *   1. 合并 Goal 分支到 main
 *   2. 从 worktree 提取独有记忆到主项目
 *   3. 生成报告
 *   4. 更新 STATUS.md
 *   5. 清理临时资源
 *
 * 被 Scheduler 在 ARCHIVE 阶段调用。
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
exports.archiveWorktree = archiveWorktree;
exports.mergeMemoryFromWorktree = mergeMemoryFromWorktree;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const goal_worktree_manager_1 = require("../engine/goal-worktree-manager");
const minhash_merger_1 = require("../memory/minhash-merger");
const harmonic_types_1 = require("../memory/harmonic-types");
/**
 * 执行 Archive 流程
 */
async function archiveWorktree(context) {
    const { goalId, projectDir, loopCount } = context;
    console.log(`[archive-worktree] Archiving goal ${goalId}`);
    const worktreeManager = new goal_worktree_manager_1.GoalWorktreeManager(projectDir);
    const info = await worktreeManager.getCurrentInfo(goalId);
    // 1. 在 git 合并前，从 worktree 提取独有记忆
    let fusionResult = null;
    if (info.worktreeDir !== projectDir) {
        fusionResult = await mergeMemoryFromWorktree(info.worktreeDir, projectDir);
        if (fusionResult.added > 0 || fusionResult.conflicts > 0) {
            console.log(`[archive-worktree] Memory fusion: ${fusionResult.added} added, ${fusionResult.conflicts} conflicts`);
        }
    }
    // 2. 合并 Goal 分支到 main
    try {
        await worktreeManager.archive(info, 'merge');
        console.log(`[archive-worktree] Merged goal/${goalId} into main`);
    }
    catch (err) {
        console.error(`[archive-worktree] Merge failed: ${err.message}`);
        throw err;
    }
    // 3. 生成报告
    await generateReport(goalId, projectDir, loopCount, fusionResult);
    // 4. 更新 STATUS.md
    updateStatusArchive(goalId, projectDir);
    console.log(`[archive-worktree] Goal ${goalId} archived successfully`);
}
/**
 * 从 worktree 提取独有记忆到主项目
 */
async function mergeMemoryFromWorktree(sourceDir, targetDir) {
    const sourceMafw = path.join(sourceDir, '.mafw');
    const targetMafw = path.join(targetDir, '.mafw');
    const sourceMemPath = path.join(sourceMafw, 'memory', 'memories.json');
    if (!fs.existsSync(sourceMemPath)) {
        return { added: 0, conflicts: 0, fusionLog: false };
    }
    const sourceUnits = JSON.parse(fs.readFileSync(sourceMemPath, 'utf-8'));
    if (sourceUnits.length === 0) {
        return { added: 0, conflicts: 0, fusionLog: false };
    }
    const { HarmonicUnitFileStore } = await Promise.resolve().then(() => __importStar(require('../../gateway/src/memory/harmonic-file-store.js')));
    const store = new HarmonicUnitFileStore(targetMafw);
    const minhash = new minhash_merger_1.MinHashMerger();
    const targetIndex = store.indexManager_().getIndex();
    let added = 0;
    let conflicts = 0;
    for (const srcUnit of sourceUnits) {
        if (srcUnit.type === 'episodic')
            continue;
        const srcSig = minhash.generateSignature(srcUnit.primary_abstraction || '');
        let bestSim = 0;
        for (const tgtEntry of targetIndex.entries) {
            const tgtSig = minhash.generateSignature(tgtEntry.primary_abstraction || '');
            const sim = minhash.similarity(srcSig, tgtSig);
            if (sim > bestSim)
                bestSim = sim;
        }
        if (bestSim > 0.6) {
            conflicts++;
        }
        else {
            srcUnit.id = (0, harmonic_types_1.generateHarmonicId)();
            srcUnit.energy = 0.4;
            srcUnit.merged_from = [srcUnit.id];
            const now = new Date().toISOString();
            srcUnit.created_at = now;
            srcUnit.updated_at = now;
            await store.write(srcUnit);
            added++;
        }
    }
    if (added > 0 || conflicts > 0) {
        const fusionLogPath = path.join(targetMafw, 'fusion-log.jsonl');
        const logEntry = JSON.stringify({
            timestamp: new Date().toISOString(),
            source_worktree: sourceDir,
            added,
            conflicts,
        });
        fs.appendFileSync(fusionLogPath, logEntry + '\n', 'utf-8');
        return { added, conflicts, fusionLog: true };
    }
    return { added: 0, conflicts: 0, fusionLog: false };
}
/**
 * 生成报告（含融合结果）
 */
async function generateReport(goalId, projectDir, loopCount, fusion) {
    const reportsDir = path.join(projectDir, '.mafw/reports');
    if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
    }
    let fusionSection = '';
    if (fusion && (fusion.added > 0 || fusion.conflicts > 0)) {
        fusionSection = `
## Memory Fusion

- New memories extracted: ${fusion.added}
- Conflicts detected: ${fusion.conflicts}
- Fusion log: .mafw/fusion-log.jsonl
`;
    }
    const reportPath = path.join(reportsDir, `${goalId}.md`);
    const report = `# Report: ${goalId}

## Summary

- Goal: ${goalId}
- Loops: ${loopCount}
- Status: COMPLETED
- Completed: ${new Date().toISOString()}

## Artifacts

- Plan: waves.json
- Receipts: receipts/${goalId}/
- Reviews: reviews/${goalId}-loop*.md
## Notes

Goal completed successfully after ${loopCount} loop(s).
${fusionSection}`;
    fs.writeFileSync(reportPath, report, 'utf-8');
    console.log(`[archive-worktree] Report generated: ${reportPath}`);
}
/**
 * 更新 STATUS.md 为 COMPLETED
 */
function updateStatusArchive(goalId, projectDir) {
    const statusPath = path.join(projectDir, '.mafw/STATUS.md');
    if (!fs.existsSync(statusPath)) {
        return;
    }
    const content = fs.readFileSync(statusPath, 'utf-8');
    // 更新对应 Goal 的状态
    const updated = content.replace(new RegExp(`(goalId: "${goalId}"[\s\S]*?state:) "[^"]*"`, 'g'), `$1 "COMPLETED"`);
    fs.writeFileSync(statusPath, updated, 'utf-8');
    console.log(`[archive-worktree] STATUS.md updated for ${goalId}`);
}
//# sourceMappingURL=archive-worktree.js.map