// 项目注册 vs 当前项目选择（2026-10-31）：
// POST /register 同时被「插件自动注册」和「桌面切换项目」使用。自动注册绝不能改写
// 当前项目——否则 runtime-root / "." 这类基础设施目录会被选成当前项目，工作台根
// 跟着跳到错误目录（实测 kv current-project 被 hourly 注册改成 runtime-root）。
import * as os from 'node:os';
import * as path from 'node:path';
import {
  parseRegisterIntent,
  isSelectableProject,
  pickCurrentProject,
} from '../../src/runtime/project-selection';

const RUNTIME_ROOT = path.join(os.homedir(), '.mafw', 'runtime-root');
const PROJ = path.resolve('/work/proj');
const OTHER = path.resolve('/work/other');
const REG_BODY = { projectDir: PROJ, mafwDir: path.join(PROJ, '.mafw') };

describe('parseRegisterIntent', () => {
  test('缺 projectDir/mafwDir → null', () => {
    expect(parseRegisterIntent({})).toBeNull();
    expect(parseRegisterIntent({ projectDir: PROJ })).toBeNull();
    expect(parseRegisterIntent({ mafwDir: path.join(PROJ, '.mafw') })).toBeNull();
  });

  test('默认 setCurrent=false（自动注册不得切换当前项目）', () => {
    expect(parseRegisterIntent(REG_BODY))
      .toEqual({ projectDir: PROJ, mafwDir: path.join(PROJ, '.mafw'), setCurrent: false });
  });

  test('显式 setCurrent: true（SDK project.setCurrent）→ 选中', () => {
    expect(parseRegisterIntent({ ...REG_BODY, setCurrent: true })?.setCurrent).toBe(true);
  });

  test('非布尔值不当成 true（strict）', () => {
    expect(parseRegisterIntent({ ...REG_BODY, setCurrent: 'yes' })?.setCurrent).toBe(false);
    expect(parseRegisterIntent({ ...REG_BODY, setCurrent: 1 })?.setCurrent).toBe(false);
  });

  test('空白字符串无效', () => {
    expect(parseRegisterIntent({ projectDir: '  ', mafwDir: path.join(PROJ, '.mafw') })).toBeNull();
  });
});

describe('isSelectableProject', () => {
  test('runtime root 不是可选择的当前项目（含混合斜杠；win32 大小写不敏感）', () => {
    expect(isSelectableProject(RUNTIME_ROOT, RUNTIME_ROOT)).toBe(false);
    expect(isSelectableProject(RUNTIME_ROOT.replace(/\\/g, '/') + '/', RUNTIME_ROOT)).toBe(false);
    if (process.platform === 'win32') {
      expect(isSelectableProject(RUNTIME_ROOT.toLowerCase(), RUNTIME_ROOT)).toBe(false);
    }
  });

  test('"." / 相对路径 / 空 → 不可选', () => {
    expect(isSelectableProject('.', RUNTIME_ROOT)).toBe(false);
    expect(isSelectableProject('', RUNTIME_ROOT)).toBe(false);
    expect(isSelectableProject('relative/proj', RUNTIME_ROOT)).toBe(false);
    expect(isSelectableProject(null, RUNTIME_ROOT)).toBe(false);
  });

  test('普通绝对项目目录 → 可选', () => {
    expect(isSelectableProject(PROJ, RUNTIME_ROOT)).toBe(true);
    expect(isSelectableProject(PROJ + '-wt-feature', RUNTIME_ROOT)).toBe(true);
  });
});

describe('pickCurrentProject', () => {
  const registered = [RUNTIME_ROOT, '.', PROJ, OTHER];

  test('stored 有效且已注册 → 保留用户选择', () => {
    expect(pickCurrentProject({ stored: OTHER, registered, runtimeRoot: RUNTIME_ROOT })).toBe(OTHER);
  });

  test('stored 是 runtime root → 回退第一个可选项目（修复被污染的状态）', () => {
    expect(pickCurrentProject({ stored: RUNTIME_ROOT, registered, runtimeRoot: RUNTIME_ROOT })).toBe(PROJ);
  });

  test('stored 是 "." → 回退第一个可选项目', () => {
    expect(pickCurrentProject({ stored: '.', registered, runtimeRoot: RUNTIME_ROOT })).toBe(PROJ);
  });

  test('stored 未注册 → 回退第一个可选项目', () => {
    expect(pickCurrentProject({ stored: path.resolve('/gone'), registered, runtimeRoot: RUNTIME_ROOT })).toBe(PROJ);
  });

  test('全部是基础设施目录 → null', () => {
    expect(pickCurrentProject({ stored: RUNTIME_ROOT, registered: [RUNTIME_ROOT, '.'], runtimeRoot: RUNTIME_ROOT }))
      .toBeNull();
  });
});
