/**
 * Automation Engine — Gateway 子模块
 *
 * 职责：
 *   1. 读取 automations/*.json 规则
 *   2. 注册 Cron 定时器
 *   3. 触发 Skill 执行发现
 *   4. 处理结果 → Triage 或 Goal
 *
 * 核心原则：只发现工作，不执行工作
 */
export interface AutomationRule {
    id: string;
    enabled: boolean;
    trigger: {
        type: 'cron';
        schedule: string;
        timezone: string;
    };
    skill: string;
    args: Record<string, any>;
    onResult: {
        type: 'triage' | 'goal';
        auto_confirm?: boolean;
        template?: string;
    };
    goal_defaults?: {
        maxLoops?: number;
        metrics?: Record<string, {
            target: number;
            unit: string;
        }>;
    };
}
export declare class AutomationEngine {
    private rules;
    private timers;
    private mafwDir;
    constructor(mafwDir: string);
    /**
     * 加载所有自动化规则
     */
    loadRules(): void;
    /**
     * 启动所有定时器
     */
    start(): void;
    /**
     * 停止所有定时器
     */
    stop(): void;
    /**
     * 调度单个规则
     */
    private scheduleRule;
    /**
     * 执行规则（触发 Skill）
     */
    executeRule(id: string): Promise<void>;
    /**
     * 创建 Triage 项
     */
    private createTriage;
    /**
     * 创建 Goal（直接执行，无需 Triage）
     */
    private createGoal;
}
//# sourceMappingURL=automation-engine.d.ts.map