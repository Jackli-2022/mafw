import { annotationsForTool, MAFW_TOOL_ANNOTATIONS } from '../../../src/runtime/tool-classes';

describe('annotationsForTool 三级解析（spec §5.2）', () => {
  it('第一级：声明覆盖优先（浅合并：声明字段覆盖表值，未声明字段保留）', () => {
    expect(annotationsForTool('mafw_add_memory', { readOnlyHint: true }))
      .toEqual({ readOnlyHint: true, destructiveHint: false });
  });
  it('第二级：mafw 专属表命中（不查 TOOL_CLASS_TABLE）', () => {
    expect(annotationsForTool('mafw_search_hybrid')).toEqual({ readOnlyHint: true, idempotentHint: true });
    expect(annotationsForTool('mafw_python')).toEqual({ readOnlyHint: false, destructiveHint: true });
    expect(annotationsForTool('mafw_desktop_click')).toEqual({ readOnlyHint: false, destructiveHint: true });
    expect(annotationsForTool('mafw_load_state')).toEqual({ readOnlyHint: true });
  });
  it('第三级：runtime 原生工具走 TOOL_CLASS 派生', () => {
    expect(annotationsForTool('read', undefined, 'readonly')).toEqual({ readOnlyHint: true, idempotentHint: true });
    expect(annotationsForTool('bash', undefined, 'shell')).toEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: false });
    expect(annotationsForTool('task', undefined, 'subagent')).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    expect(annotationsForTool('webfetch', undefined, 'web')).toEqual({ readOnlyHint: false, openWorldHint: true });
    expect(annotationsForTool('x_unknown', undefined, 'other')).toEqual({});
    expect(annotationsForTool('edit', undefined, 'file-edit')).toEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: false });
  });
  it('三级全 miss → 声明非空返回声明，否则 undefined（不硬猜）', () => {
    expect(annotationsForTool('totally_unknown')).toBeUndefined();
    expect(annotationsForTool('totally_unknown', { readOnlyHint: true })).toEqual({ readOnlyHint: true });
    expect(annotationsForTool('totally_unknown', undefined, 'other')).toEqual({}); // other 类 = 空注解非 undefined
  });
  it('mafw_* 永不走 TOOL_CLASS 派生（表内名字优先，toolClass 参数被无视）', () => {
    expect(annotationsForTool('mafw_search_hybrid', undefined, 'file-edit'))
      .toEqual({ readOnlyHint: true, idempotentHint: true });
  });
  it('派生级声明同样浅合并', () => {
    expect(annotationsForTool('bash', { idempotentHint: true }, 'shell'))
      .toEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
  });
  // 完整性不做绝对数断言（AGENTS.md 39/40 自相矛盾、设计表手数 44）——
  // 真守卫是 Task 2/5 的关系性覆盖门：registry 全部名 + 六件套名 ∈ 本表。
});
