/**
 * D2 Task 1（RED-first）：`handleRuntimeEvent` 抽取为有序 stage 表后的**拓扑守卫**。
 *
 * 表的位置就是执行顺序（Ruling D2-R1：没有 `order: number` 冗余字段），因此
 * 拓扑约束一律用 `stageIndex(name)` 比较表达——名字是稳定锚点，插入/重排会被
 * 这里抓住，而不是靠人工读 277 行 if 链。
 *
 * 钉的是 legacy 链里的 5 条**只写在注释里**的次序契约（Ruling D2-R3）：
 *   - approval 先于 internal drop（内部会话 fail-safe 必须在 memoryWorker 丢弃前生效）；
 *   - conformance tap 先于 internal drop（tap 要看到该会话全量事件）；
 *   - autoCheckpoint 先于 memoryWorker 早退（门控在 runAutoCheckpoint 内，role 门兜底）；
 *   - enrichToolIdentity 先于 conformance tap（tap 快照必须看到 toolClass）；
 *   - internalFilter 先于 trajectoryHandle（worker 的 token 噪声不得进 trajectory）；
 *   - finalBroadcast 恒为最后一段（派生广播先于 passthrough）。
 *
 * 模块在 Task 2 之前不存在——导入失败本身就是 RED。
 */
import { DISPATCH_STAGES, stageIndex } from '../../../src/runtime/event-dispatch';

describe('D2 dispatch stage table', () => {
  it('is a non-empty ordered array with unique stage names', () => {
    expect(Array.isArray(DISPATCH_STAGES)).toBe(true);
    expect(DISPATCH_STAGES.length).toBeGreaterThan(0);
    const names = DISPATCH_STAGES.map((s) => s.name);
    expect(names.every((name) => typeof name === 'string' && name.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every stage exposes matches + run', () => {
    for (const stage of DISPATCH_STAGES) {
      expect(typeof stage.matches).toBe('function');
      expect(typeof stage.run).toBe('function');
    }
  });

  it('approval policy runs before the internal-session drop', () => {
    expect(stageIndex('approvalPolicy')).toBeLessThan(stageIndex('internalFilter'));
  });

  it('conformance tap runs before the internal-session drop', () => {
    expect(stageIndex('conformanceTap')).toBeLessThan(stageIndex('internalFilter'));
  });

  it('auto-checkpoint runs before the memoryWorker early return', () => {
    expect(stageIndex('autoCheckpoint')).toBeLessThan(stageIndex('internalFilter'));
  });

  it('tool identity enrichment runs before the conformance tap snapshot', () => {
    expect(stageIndex('enrichToolIdentity')).toBeLessThan(stageIndex('conformanceTap'));
  });

  it('the worker drop runs before trajectory accumulation', () => {
    expect(stageIndex('internalFilter')).toBeLessThan(stageIndex('trajectoryHandle'));
  });

  it('the passthrough broadcast is the final stage', () => {
    expect(stageIndex('finalBroadcast')).toBe(DISPATCH_STAGES.length - 1);
  });
});
