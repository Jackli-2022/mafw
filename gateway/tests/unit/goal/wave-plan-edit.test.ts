import {
  addWaveTask,
  deleteWaveTask,
  editWaveTask,
  ensureWaveTaskIds,
  findWaveTask,
} from '../../../src/core/goal/wave-plan-edit';

const plan = () => ({
  taskType: 'feature',
  waves: [
    { id: 'w1', title: '地基', tasks: ['旧字符串任务', { title: '对象任务', acceptance: ['a'] }] },
    { id: 'w2', title: '收尾', tasks: [{ title: '三号', acceptance: ['x', 'y'] }] },
  ],
});

describe('wave-plan-edit', () => {
  test('findWaveTask locates by externalTaskId (positional id, wave id 可含连字符)', () => {
    expect(findWaveTask(plan(), 'w1-t2')).toEqual({ waveIndex: 0, taskIndex: 1 });
    expect(findWaveTask(plan(), 'w2-t1')).toEqual({ waveIndex: 1, taskIndex: 0 });
    expect(findWaveTask({ waves: [{ id: 'w-1', tasks: ['a', 'b'] }] }, 'w-1-t2'))
      .toEqual({ waveIndex: 0, taskIndex: 1 });
    expect(findWaveTask(plan(), 'w9-t1')).toBeNull();
  });

  test('editing a title keeps acceptance and other tasks untouched', () => {
    const before = plan();
    const next: any = editWaveTask(before, 'w2-t1', { title: '  新标题  ' });
    expect(next.waves[1].tasks[0]).toEqual({ title: '新标题', acceptance: ['x', 'y'] });
    expect(next.waves[0]).toBe(before.waves[0]);
    expect(before.waves[1].tasks[0]).toEqual({ title: '三号', acceptance: ['x', 'y'] });
  });

  test('adding acceptance to a string task upgrades it to an object task', () => {
    const next: any = editWaveTask(plan(), 'w1-t1', { acceptance: [' 跑通测试 ', '', '跑通测试'] });
    expect(next.waves[0].tasks[0]).toEqual({ title: '旧字符串任务', acceptance: ['跑通测试'] });
  });

  test('empty acceptance clears the field instead of storing []', () => {
    const next: any = editWaveTask(plan(), 'w2-t1', { acceptance: [] });
    expect(next.waves[1].tasks[0]).toEqual({ title: '三号' });
  });

  test('unknown task returns null; malformed plan returns null', () => {
    expect(editWaveTask(plan(), 'w9-t9', { title: 'x' })).toBeNull();
    expect(editWaveTask(null, 'w1-t1', { title: 'x' })).toBeNull();
    expect(editWaveTask({ waves: 'nope' }, 'w1-t1', { title: 'x' })).toBeNull();
  });

  test('acceptance is capped at 20 items / 500 chars', () => {
    const many = Array.from({ length: 25 }, (_v, i) => `标准 ${i}`);
    const next: any = editWaveTask(plan(), 'w2-t1', { acceptance: many });
    expect(next.waves[1].tasks[0].acceptance).toHaveLength(20);
    const long = editWaveTask(plan(), 'w2-t1', { acceptance: ['x'.repeat(600)] }) as any;
    expect(long.waves[1].tasks[0].acceptance[0]).toHaveLength(500);
  });

  test('ensureWaveTaskIds mints positional ids once and is idempotent', () => {
    const first = ensureWaveTaskIds(plan());
    expect(first.changed).toBe(true);
    const withIds: any = first.plan;
    expect(withIds.waves[0].tasks[0]).toEqual({ title: '旧字符串任务', taskId: 'w1-t1' });
    expect(withIds.waves[0].tasks[1]).toEqual({ title: '对象任务', acceptance: ['a'], taskId: 'w1-t2' });
    expect(withIds.waves[1].tasks[0].taskId).toBe('w2-t1');

    const again = ensureWaveTaskIds(withIds);
    expect(again.changed).toBe(false);
    expect(again.plan).toBe(withIds);
  });

  test('editing preserves the stable taskId', () => {
    const withIds: any = ensureWaveTaskIds(plan()).plan;
    const next: any = editWaveTask(withIds, 'w1-t2', { title: '改过' });
    expect(next.waves[0].tasks[1]).toMatchObject({ taskId: 'w1-t2', title: '改过', acceptance: ['a'] });
  });

  test('addWaveTask appends to the last wave with a fresh id', () => {
    const withIds: any = ensureWaveTaskIds(plan()).plan;
    const added = addWaveTask(withIds, null, { title: '新任务', acceptance: ['跑测试'] })!;
    const next: any = added.plan;
    expect(added.taskId).toBe('w2-t2');
    expect(next.waves[1].tasks).toHaveLength(2);
    expect(next.waves[1].tasks[1]).toMatchObject({ taskId: 'w2-t2', title: '新任务', acceptance: ['跑测试'] });
    // 已删过的 id 不复用
    const afterDelete = deleteWaveTask(next, 'w2-t1')!.plan as any;
    expect(addWaveTask(afterDelete, 'w2', { title: '再来一个' })!.taskId).toBe('w2-t3');
  });

  test('addWaveTask respects an explicit wave and rejects unknown waves/empty title', () => {
    const added = addWaveTask(plan(), 'w1', { title: '加到 w1' })!;
    expect((added.plan as any).waves[0].tasks).toHaveLength(3);
    expect(addWaveTask(plan(), 'w9', { title: 'x' })).toBeNull();
    expect(addWaveTask(plan(), null, { title: '   ' })).toBeNull();
    expect(addWaveTask({ waves: [] }, null, { title: 'x' })).toBeNull();
  });

  test('deleteWaveTask removes only the target and keeps wave + other ids', () => {
    const withIds: any = ensureWaveTaskIds(plan()).plan;
    const result = deleteWaveTask(withIds, 'w1-t1')!;
    const next: any = result.plan;
    expect(result.removed).toEqual({ taskId: 'w1-t1', waveId: 'w1', title: '旧字符串任务' });
    expect(next.waves[0].tasks).toEqual([{ title: '对象任务', acceptance: ['a'], taskId: 'w1-t2' }]);
    expect(next.waves).toHaveLength(2);
    expect(deleteWaveTask(next, 'w1-t1')).toBeNull();

    const emptied: any = deleteWaveTask({ waves: [{ id: 'w1', tasks: [{ title: 'a', taskId: 'w1-t1' }] }] }, 'w1-t1')!.plan;
    expect(emptied.waves[0].tasks).toEqual([]);
  });
});
