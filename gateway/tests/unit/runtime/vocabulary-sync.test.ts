/**
 * 词汇单源交叉钉扎：gateway 侧常量镜像（mafw-vocabulary.ts）与 SDK
 * 事件 union（packages/gateway-sdk/src/events.ts，客户端契约单源）双向一致。
 * 任一侧加词忘同步另一侧 → 此测试红，指向两处之一。
 */
import { MAFW, MAFW_RUNTIME_EVENT_NAMES, MAFW_FLAT_EVENT_NAMES } from '../../../src/runtime/mafw-vocabulary';
import { RUNTIME_EVENT_TYPES, FLAT_EVENT_TYPES } from '../../../../packages/gateway-sdk/src/events';

const sorted = (a: readonly string[]) => [...a].sort();

describe('mafw-vocabulary ↔ SDK events 双向一致', () => {
  it('runtime 事件名全集双向相等', () => {
    expect(sorted(MAFW_RUNTIME_EVENT_NAMES)).toEqual(sorted(RUNTIME_EVENT_TYPES));
  });

  it('扁平广播名全集双向相等', () => {
    expect(sorted(MAFW_FLAT_EVENT_NAMES)).toEqual(sorted(FLAT_EVENT_TYPES));
  });

  it('MAFW 常量无重复值（turn 合并不慎撞名会在此暴露）', () => {
    const values = Object.values(MAFW);
    expect(new Set(values).size).toBe(values.length);
  });

  it('关键语义锚点抽查', () => {
    expect(MAFW.turnCompleted).toBe('turn.completed');
    expect(MAFW.partUpdated).toBe('part.updated');
    expect(MAFW.planUpdated).toBe('plan.updated');
    expect(MAFW.usageUpdated).toBe('usage.updated');
    expect(MAFW.envelope).toBe('mafw_event');
  });
});
