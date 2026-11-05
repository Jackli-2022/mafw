// 推理档位的 runtime 内部映射：opencode 用 model variant 表达推理强度，
// 适配器把契约 ThinkingLevel 映射到当前模型声明的 variants；gateway/前端不接触 variant 目录。
import { thinkingVariantForLevel } from '../../../src/runtime/opencode-adapter';

describe('opencode thinking level → model variant', () => {
  const gatewayVariants = [
    { id: 'fast', settings: { reasoningEffort: 'low' } },
    { id: 'balanced', settings: { reasoningEffort: 'medium' } },
    { id: 'deep', settings: { reasoningEffort: 'high' } },
    { id: 'max', settings: { reasoningEffort: 'max' } },
  ];

  it('按 reasoningEffort 精确映射；缺失档位取最近（平局取更高）', () => {
    expect(thinkingVariantForLevel(gatewayVariants, 'low')).toBe('fast');
    expect(thinkingVariantForLevel(gatewayVariants, 'medium')).toBe('balanced');
    expect(thinkingVariantForLevel(gatewayVariants, 'high')).toBe('deep');
    expect(thinkingVariantForLevel(gatewayVariants, 'max')).toBe('max');
    // minimal 缺档 → 最近 low；xhigh 缺档 → 平局取 max。
    expect(thinkingVariantForLevel(gatewayVariants, 'minimal')).toBe('fast');
    expect(thinkingVariantForLevel(gatewayVariants, 'xhigh')).toBe('max');
    // off 缺档 → 最低档（variant 未提供真正关闭时，降级到最低推理强度）。
    expect(thinkingVariantForLevel(gatewayVariants, 'off')).toBe('fast');
  });

  it('显式关闭档优先（none / disabled body）', () => {
    const withNone = [
      { id: 'none' },
      { id: 'low', settings: { reasoningEffort: 'low' } },
      { id: 'high', settings: { reasoningEffort: 'high' } },
      { id: 'max', settings: { reasoningEffort: 'max' } },
    ];
    expect(thinkingVariantForLevel(withNone, 'off')).toBe('none');
    expect(thinkingVariantForLevel(withNone, 'minimal')).toBe('low');
    // medium 缺档：low/high 平局 → 取更高（high）。
    expect(thinkingVariantForLevel(withNone, 'medium')).toBe('high');

    const disabled = [
      { id: 'disabled', body: { thinking: { type: 'disabled' } } },
      { id: 'high', settings: { reasoningEffort: 'high' } },
    ];
    expect(thinkingVariantForLevel(disabled, 'off')).toBe('disabled');
  });

  it('variant id 精确命中优先于 effort 推断', () => {
    const variants = [
      { id: 'max', settings: { reasoningEffort: 'low' } },
      { id: 'deep', settings: { reasoningEffort: 'max' } },
    ];
    expect(thinkingVariantForLevel(variants, 'max')).toBe('max');
    expect(thinkingVariantForLevel(variants, 'high')).toBe('deep');
  });

  it('无 variants / 无可用档位 → null（显式降级，不硬猜）', () => {
    expect(thinkingVariantForLevel(null, 'high')).toBeNull();
    expect(thinkingVariantForLevel([], 'high')).toBeNull();
    expect(thinkingVariantForLevel([{ id: 'weird' }], 'max')).toBeNull();
    expect(thinkingVariantForLevel([null, {}], 'low')).toBeNull();
  });
});
