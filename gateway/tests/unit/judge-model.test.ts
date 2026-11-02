import { resolveJudgeModel } from '../../src/memory/judge-model';

describe('resolveJudgeModel', () => {
  test('explicit judgeModel wins over workerModel', () => {
    const m = resolveJudgeModel({
      workerModel: { providerID: 'opencode', modelID: 'free-flash' },
      judgeModel: { providerID: 'deepseek', modelID: 'deepseek-chat' },
    });
    expect(m).toEqual({ providerID: 'deepseek', modelID: 'deepseek-chat' });
  });

  test('falls back to workerModel when judgeModel is absent', () => {
    const m = resolveJudgeModel({ workerModel: { providerID: 'opencode', modelID: 'free-flash' } });
    expect(m).toEqual({ providerID: 'opencode', modelID: 'free-flash' });
  });

  test('a half-filled judgeModel is ignored rather than half-used', () => {
    const m = resolveJudgeModel({
      workerModel: { providerID: 'opencode', modelID: 'free-flash' },
      judgeModel: { providerID: 'deepseek' },
    });
    expect(m).toEqual({ providerID: 'opencode', modelID: 'free-flash' });
  });

  test('no model configured at all → null', () => {
    expect(resolveJudgeModel(undefined)).toBeNull();
    expect(resolveJudgeModel({})).toBeNull();
    expect(resolveJudgeModel({ workerModel: {} })).toBeNull();
  });
});
