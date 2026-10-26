import { readFileSync } from 'fs';
import { join } from 'path';

/** P0-2 接线（2026-10-22 契约缺口研究）：SessionPromptOpts.maxTurns/maxCostUsd
 *  契约字段此前 HTTP 面不接收、BudgetGuard 只挂 goal 会话——本测试钉扎
 *  index.ts 的生产接线（路由解构 → prompt 前挂载 → 回合终态清理）。 */
const src = readFileSync(join(__dirname, '../../../src/index.ts'), 'utf8');

describe('prompt 预算接线（wiring 源码断言）', () => {
  it('promptAsync 路由解构 maxTurns/maxCostUsd', () => {
    expect(src).toContain('const { message, parts, agent, model, maxTurns, maxCostUsd, delivery, idempotencyKey, expectReply, outputSchema } = body ? JSON.parse(body) : {};');
  });

  it('promptAsync 调用前挂 per-prompt 预算（顺序：attach 先于 promptAsync）', () => {
    const attach = src.indexOf('this.attachBudgetGuardForPrompt(sessionID, maxTurns, maxCostUsd);');
    const send = src.indexOf('await this.sdkSession.promptAsync(sessionID, message, parts, agent, model, outputSchema, {');
    expect(attach).toBeGreaterThan(0);
    expect(send).toBeGreaterThan(0);
    expect(attach).toBeLessThan(send); // step 事件在 prompt 执行中流出，guard 必须先挂
  });

  it('attachBudgetGuardForPrompt 方法存在且走 resolvePromptBudget 裁决', () => {
    expect(src).toContain('private attachBudgetGuardForPrompt(sessionID: string, maxTurns?: number, maxCostUsd?: number): void');
    expect(src).toContain('resolvePromptBudget(');
    expect(src).toContain("decision === 'skip-empty' || decision === 'skip-goal'");
  });

  it('回合三终态清理 per-prompt guard（防预算泄漏到后续无预算 prompt）', () => {
    expect(src).toMatch(/MAFW\.turnCompleted \|\| type === MAFW\.turnFailed \|\| type === MAFW\.turnAborted/);
    expect(src).toContain('this.promptBudgetSessions.delete(sessionID)');
  });

  it('per-prompt 来源标记字段存在', () => {
    expect(src).toMatch(/promptBudgetSessions = new Set<string>\(\)/);
  });
});
