"use strict";
/**
 * Archive Worktree Tool — Archive tool 函数
 *
 * 职责：
 *   1. 合并 Goal 分支到 main
 *   2. 生成报告
 *   3. 更新 STATUS.md
 *   4. 清理临时资源
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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const goal_worktree_manager_1 = require("../engine/goal-worktree-manager");
/**
 * 执行 Archive 流程
 */
async function archiveWorktree(context) {
    const { goalId, projectDir, loopCount } = context;
    console.log(`[archive-worktree] Archiving goal ${goalId}`);
    // 1. 合并 Goal 分支到 main
    const worktreeManager = new goal_worktree_manager_1.GoalWorktreeManager(projectDir);
    const info = await worktreeManager.getCurrentInfo(goalId);
    try {
        await worktreeManager.archive(info, 'merge');
        console.log(`[archive-worktree] Merged goal/${goalId} into main`);
    }
    catch (err) {
        console.error(`[archive-worktree] Merge failed: ${err.message}`);
        throw err;
    }
    // 2. 生成报告
    await generateReport(goalId, projectDir, loopCount);
    // 3. 更新 STATUS.md
    updateStatusArchive(goalId, projectDir);
    console.log(`[archive-worktree] Goal ${goalId} archived successfully`);
}
/**
 * 生成报告
 */
async function generateReport(goalId, projectDir, loopCount) {
    const reportsDir = path.join(projectDir, '.opencode/mafw/reports');
    if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
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
`;
    fs.writeFileSync(reportPath, report, 'utf-8');
    console.log(`[archive-worktree] Report generated: ${reportPath}`);
}
/**
 * 更新 STATUS.md 为 COMPLETED
 */
function updateStatusArchive(goalId, projectDir) {
    const statusPath = path.join(projectDir, '.opencode/mafw/STATUS.md');
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