/**
 * session-ending Hook �?异常兜底
 *
 * 职责�?
 *   1. Session 正常结束时遍�?state 文件反查 sessionId
 *   2. 检�?state 是否已更新（nextAction !== WAIT_PHASE_COMPLETE�?
 *   3. 如果 Skill Entry 因为异常没来得及更新 state，写入异常状�?
 *   4. Scheduler 下一�?poll 会读取新 nextAction，重�?Session
 *
 * 设计原则�?
 *   - 只兜底，不承载主路径状态更�?
 *   - 遍历所�?state 文件，不假设 sessionId 格式包含 goalId
 *   - 如果 state 已正常更新，无操�?
 */
export interface HookContext {
    sessionId: string;
    projectDir?: string;
}
export declare function sessionEndingHook(hookContext: HookContext): Promise<void>;
//# sourceMappingURL=session-ending.d.ts.map