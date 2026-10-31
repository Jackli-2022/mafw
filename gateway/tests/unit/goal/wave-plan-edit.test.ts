import { editWaveTask, findWaveTask } from '../../../src/core/goal/wave-plan-edit';

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
});
