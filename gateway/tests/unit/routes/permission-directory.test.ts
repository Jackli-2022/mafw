import { resolveApprovalDirectory } from '../../../src/routes/permission';

describe('resolveApprovalDirectory', () => {
  test('explicit query wins', () => {
    expect(resolveApprovalDirectory({
      explicit: 'C:/work/query',
      currentProjectDir: 'C:/work/current',
      projectDir: 'C:/work/startup',
    })).toBe('C:/work/query');
  });

  test('current project wins over the gateway startup directory', () => {
    // 桌面切换项目后 this.projectDir 不变；审批列表必须跟随当前项目，
    // 否则 Creator 的 check/test 审批在 UI 上永远不可见。
    expect(resolveApprovalDirectory({
      explicit: null,
      currentProjectDir: 'C:/work/current',
      projectDir: 'C:/work/startup',
    })).toBe('C:/work/current');
  });

  test('falls back to the startup directory and ignores blanks', () => {
    expect(resolveApprovalDirectory({
      explicit: '   ',
      currentProjectDir: '',
      projectDir: 'C:/work/startup',
    })).toBe('C:/work/startup');
    expect(resolveApprovalDirectory({})).toBeUndefined();
  });
});
