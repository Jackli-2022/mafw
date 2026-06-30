/**
 * mafw-goal Skill Entry — Goal Interview Agent
 *
 * 职责：
 *   1. 接收用户输入的目标描述
 *   2. 进行多轮追问（3-5 个问题）
 *   3. 生成 Goal Charter
 *   4. 用户确认后写入：
 *      - goals/{goalId}.md
 *      - requests/{goalId}.json
 *      - state/{goalId}.json (nextAction: CREATE_PLAN_SESSION)
 *      - STATUS.md
 *   5. 返回确认结果给 TUI
 *
 * 调用方式：TUI 中 /goal 命令 → context.runSkill('mafw-goal', { text: '...' })
 */
export interface GoalSkillContext {
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
    projectDir: string;
}
export interface InterviewResult {
    goalId: string;
    title: string;
    metrics: Record<string, {
        target: number;
        unit: string;
    }>;
    boundaries: string[];
    scope: {
        include: string[];
        exclude: string[];
    };
    risks: any[];
    priority: string;
    maxLoops: number;
    parallel: boolean;
    remoteCli?: {
        host: string;
        projectDir: string;
        syncOnExecute: boolean;
        testCommand: string;
    };
}
export declare function mafwGoalEntry(context: GoalSkillContext): Promise<InterviewResult>;
//# sourceMappingURL=entry.d.ts.map