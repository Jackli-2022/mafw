/**
 * mafw-review Skill Entry — Review Agent（独立 Session）
 *
 * 【关键】状态更新是主路径，写在函数末尾
 *
 * 职责：
 *   1. 读取 Goal Charter 指标
 *   2. 读取 receipts/{goalId}/
 *   3. 读取 git diff
 *   4. 读取远程 CLI 测试结果（如果配置）
 *   5. 拼接 Review Prompt
 *   6. 调用 LLM 审查
 *   7. 返回 verdict
 *   8. 写入 reviews/{goalId}-loop{loop}.md
 *   9. 如果失败，写入 lessons/{goalId}-loop{loop}.md
 *   10. LessonCompactor 压缩为 YAML (L2)
 *   11. MemoryExtractor 提取 Δ (L3)
 *   12. 【显式】更新 state.json → nextAction: CHECK_VERDICT
 *
 * 调用方式：Scheduler 创建 Review Session → 发送 /skill mafw-review {goalId}
 */
export interface ReviewSkillContext {
    message: string;
    llm: {
        chat: (options: {
            model: string;
            messages: any[];
        }) => Promise<{
            content: string;
        }>;
    };
    config: {
        model: string;
    };
    sessionId: string;
}
export declare function mafwReviewEntry(context: ReviewSkillContext): Promise<void>;
//# sourceMappingURL=entry.d.ts.map