import { resolvePromptBudget, PromptBudgetExisting } from '../../../src/core/prompt-budget';

describe('resolvePromptBudget（per-prompt 预算挂载裁决，P0-2 接线）', () => {
  it('两字段都缺 → skip-empty（无预算意图，不挂 guard）', () => {
    expect(resolvePromptBudget('none')).toBe('skip-empty');
    expect(resolvePromptBudget('none', undefined, undefined)).toBe('skip-empty');
  });

  it('非法值（0/负数/NaN）视为无预算 → skip-empty', () => {
    expect(resolvePromptBudget('none', 0, 0)).toBe('skip-empty');
    expect(resolvePromptBudget('none', -5, 0)).toBe('skip-empty');
    expect(resolvePromptBudget('none', Number.NaN)).toBe('skip-empty');
    expect(resolvePromptBudget('prompt', 0)).toBe('skip-empty');
  });

  it('无既有 guard + 有效预算 → attach', () => {
    expect(resolvePromptBudget('none', 10)).toBe('attach');
    expect(resolvePromptBudget('none', undefined, 0.5)).toBe('attach');
    expect(resolvePromptBudget('none', 3, 0.2)).toBe('attach');
  });

  it('既有 goal guard → skip-goal（goal 生命周期预算优先，防顶掉）', () => {
    expect(resolvePromptBudget('goal', 10)).toBe('skip-goal');
    expect(resolvePromptBudget('goal', undefined, 1.5)).toBe('skip-goal');
  });

  it('既有 per-prompt guard → replace（上次预算不泄漏到本次）', () => {
    expect(resolvePromptBudget('prompt', 10)).toBe('replace');
    expect(resolvePromptBudget('prompt', undefined, 0.3)).toBe('replace');
  });

  it('类型穷尽：PromptBudgetExisting 三值', () => {
    const all: PromptBudgetExisting[] = ['none', 'goal', 'prompt'];
    expect(all).toHaveLength(3);
  });
});
