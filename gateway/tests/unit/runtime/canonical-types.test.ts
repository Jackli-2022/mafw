/**
 * canonical-types —— flat canonical 消息/部件类型契约测试。
 * spec: docs/superpowers/specs/2026-10-21-runtime-canonical-v3-design.md §3.1
 * （字段完备 + 透传变体；identity 字段承重——桌面按 part.id upsert、
 *  assembler 以 id 做 live/历史去重）
 */
import { isMafwMessage, isMafwPart } from '../../../src/runtime/canonical-types';

describe('canonical-types flat 契约', () => {
  it('接受最小 flat 消息（role 必填；content 可选——事件载荷形态可缺省）', () => {
    expect(isMafwMessage({ role: 'user', content: [] })).toBe(true);
    expect(isMafwMessage({ role: 'assistant' })).toBe(true);
  });

  it('拒绝 v1 信封形状 {info, parts}', () => {
    expect(isMafwMessage({ info: { role: 'user' }, parts: [] })).toBe(false);
  });

  it('透传变体：未知 part 类型被接受，守卫不吞字段（校验非变换）', () => {
    const part = { id: 'p1', type: 'compaction', anything: 'kept', nested: { a: 1 } };
    expect(isMafwPart(part)).toBe(true);
    expect((part as Record<string, unknown>).anything).toBe('kept');
    expect((part as Record<string, unknown>).nested).toEqual({ a: 1 });
  });

  it('tool part 四种 state.status 均合法（pending/running/completed/error）', () => {
    for (const status of ['pending', 'running', 'completed', 'error'] as const) {
      expect(isMafwPart({
        id: 't1', type: 'tool', callID: 'c1', tool: 'bash',
        state: { status, input: { command: 'ls' } },
      })).toBe(true);
    }
  });

  it('step-finish 带 cost/tokens 合法（trajectory/BudgetGuard 主干字段）', () => {
    expect(isMafwPart({
      id: 's1', type: 'step-finish',
      cost: { total: 0.01 }, tokens: { input: 100, output: 50 },
    })).toBe(true);
  });

  it('部件守卫拒绝缺 id / 缺 type / 非对象', () => {
    expect(isMafwPart({ type: 'text', text: 'x' })).toBe(false); // 缺 id
    expect(isMafwPart({ id: 'x' })).toBe(false); // 缺 type
    expect(isMafwPart(null)).toBe(false);
    expect(isMafwPart('text')).toBe(false);
  });

  it('消息守卫：role 非法 / content 非数组 / content 项非合法部件 → false', () => {
    expect(isMafwMessage({ role: 'system', content: [] })).toBe(false);
    expect(isMafwMessage({ role: 'user', content: 'hi' })).toBe(false);
    expect(isMafwMessage({ role: 'user', content: [{ noType: true }] })).toBe(false);
    expect(isMafwMessage(null)).toBe(false);
  });
});
