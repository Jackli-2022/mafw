// opencode 适配器的 agent 角色标注：opencode 的默认 agent / 规划模式只在这里解析，
// 中性 DTO 只暴露 `default` / `planning` 标记（前端不认 runtime 名）。
import {
  annotateAgentRoles,
  defaultAgentNameFromConfig,
} from '../../../src/runtime/opencode-adapter';

describe('opencode agent role annotation', () => {
  it('defaultAgentNameFromConfig: 多文档配置取最后声明的 default_agent', () => {
    expect(defaultAgentNameFromConfig(null)).toBeNull();
    expect(defaultAgentNameFromConfig({})).toBeNull();
    expect(defaultAgentNameFromConfig([{ info: {} }, { info: { default_agent: 'plan' } }])).toBe('plan');
    expect(defaultAgentNameFromConfig([{ info: { default_agent: 'plan' } }, { info: { default_agent: '  ' } }])).toBe('plan');
    expect(defaultAgentNameFromConfig([{ info: { default_agent: ' build ' } }])).toBe('build');
  });

  it('annotateAgentRoles: 默认 agent 标记 default，内置 plan 标记 planning', () => {
    const out = annotateAgentRoles(
      [
        { name: 'Build', mode: 'primary' },
        { name: 'Plan', mode: 'primary' },
        { name: 'General', mode: 'subagent' },
      ],
      null,
    );
    expect(out[0]).toMatchObject({ name: 'Build', default: true });
    expect(out[1]).toMatchObject({ name: 'Plan', planning: true });
    expect(out[1]).not.toHaveProperty('default');
    expect(out[2]).not.toHaveProperty('default');
    expect(out[2]).not.toHaveProperty('planning');
  });

  it('annotateAgentRoles: config.default_agent 覆盖内置回退（大小写不敏感）', () => {
    const out = annotateAgentRoles([{ name: 'Build' }, { name: 'Plan' }], 'Plan');
    expect(out[0]).not.toHaveProperty('default');
    expect(out[1]).toMatchObject({ default: true, planning: true });
  });

  it('annotateAgentRoles: 畸形条目原样保留（fail-open）', () => {
    expect(annotateAgentRoles(null, null)).toEqual([]);
    expect(annotateAgentRoles([null, {}, { name: 123 }], null)).toEqual([null, {}, { name: 123 }]);
  });
});
