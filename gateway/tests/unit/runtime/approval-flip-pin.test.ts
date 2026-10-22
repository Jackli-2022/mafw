import { TOOL_CLASS_TABLE, toolClassOf } from '../../../src/runtime/tool-classes';
import { isReadOnlyTool } from '../../../src/core/approval/safety-classifier';

/**
 * 审批零翻转钉扎（design §3 反目标 / plan Review Focus #1）。
 * 背景（2026-10-22 builder check Q1）：mafw_* 若进 TOOL_CLASS_TABLE，
 * policyDecides 的 deny-class 先于 allowlist 判定会翻转——manager（deny
 * file-edit/subagent）的 mafw_add_memory/create_goal 等 ~15 工具从 allow 变
 * auto-deny；curator（deny file-edit）的 mafw_add_memory 被类拒绝。
 * mafw_* 的注解走 MAFW_TOOL_ANNOTATIONS 专属表（annotationsForTool），
 * 审批消费的 TOOL_CLASS_TABLE 永远不收 mafw_*。
 */
describe('审批零翻转钉扎（TOOL_CLASS_TABLE 与 mafw_* 隔离）', () => {
  it('TOOL_CLASS_TABLE 无任何 mafw_* 键（类 deny 不可能波及网关工具）', () => {
    const offenders = Object.keys(TOOL_CLASS_TABLE).filter(k => k.startsWith('mafw_'));
    expect(offenders).toEqual([]);
  });
  it('mafw_* 的类别解析保持现状（other = 落 allowlist 名字匹配，非类判定）', () => {
    expect(toolClassOf('mafw_add_memory')).toBe('other');
    expect(toolClassOf('mafw_search_hybrid')).toBe('other');
    expect(toolClassOf('mafw_restart_agent')).toBe('other');
    expect(toolClassOf('mafw_python')).toBe('other');
  });
  it('isReadOnlyTool 对 mafw_* 保持现状（全部 false——注解不是审批权威）', () => {
    for (const name of ['mafw_search_hybrid', 'mafw_get_memory', 'mafw_add_memory', 'mafw_python', 'mafw_desktop_screenshot']) {
      expect(isReadOnlyTool(name)).toBe(false);
    }
  });
  it('runtime 原生工具判定不受影响（回归锚）', () => {
    expect(toolClassOf('read')).toBe('readonly');
    expect(toolClassOf('bash')).toBe('shell');
    expect(isReadOnlyTool('read')).toBe(true);
    expect(isReadOnlyTool('bash')).toBe(false);
  });
});
