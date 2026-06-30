/**
 * mafw-plan Skill Entry — Plan Agent（独立 Session）
 *
 * 【关键】状态更新是主路径，写在函数末尾，不依赖 hook
 *
 * 职责：
 *   1. 读取 Goal Charter (L1)
 *   2. 读取相关 Lessons (L2 检索)
 *   3. 加载 Parametric Δ (L3 注入)
 *   4. 拼接完整 Prompt
 *   5. 调用 LLM
 *   6. 解析回复为 waves.json
 *   7. 写入 tasks/{id}.md
 *   8. 【显式】更新 state.json → nextAction: CREATE_EXECUTE_SESSION
 *
 * 调用方式：Scheduler 创建 Plan Session → 发送 /skill mafw-plan {goalId}
 */
export interface SkillContext {
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
export declare function mafwPlanEntry(context: SkillContext): Promise<void>;
//# sourceMappingURL=entry.d.ts.map