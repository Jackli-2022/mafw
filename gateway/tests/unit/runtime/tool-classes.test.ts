import {
  toolClassOf, isReadOnlyClass, enrichToolClass, TOOL_CLASS,
  setToolClassOverlay, clearToolClassOverlay,
} from '../../../src/runtime/tool-classes';

describe('toolClassOf（并集单表，大小写不敏感）', () => {
  const samples: Array<[string, TOOL_CLASS]> = [
    // opencode v1 + v2
    ['read', 'readonly'], ['grep', 'search'], ['glob', 'search'], ['list', 'search'],
    ['bash', 'shell'], ['shell', 'shell'], ['task', 'subagent'], ['subagent', 'subagent'],
    ['edit', 'file-edit'], ['write', 'file-edit'], ['apply_patch', 'file-edit'],
    ['webfetch', 'web'], ['websearch', 'web'], ['todowrite', 'plan'],
    // pi（含此前漏登的 find——bug 2 修复的根基）
    ['find', 'search'], ['ls', 'search'],
    // Claude（PascalCase 归一命中）
    ['Read', 'readonly'], ['Grep', 'search'], ['Glob', 'search'],
    ['Bash', 'shell'], ['PowerShell', 'shell'], ['Edit', 'file-edit'], ['Write', 'file-edit'],
    ['NotebookEdit', 'file-edit'], ['Agent', 'subagent'], ['WebFetch', 'web'],
    ['WebSearch', 'web'], ['TodoWrite', 'plan'],
    // codex（条目类型名即工具类别）
    ['command_execution', 'shell'], ['file_change', 'file-edit'],
    ['web_search', 'web'], ['todo_list', 'plan'], ['collab_tool_call', 'subagent'],
    // 未知/自定义（MCP、插件）
    ['mafw_media_speak', 'other'], ['mafw_mafw_search_hybrid', 'other'],
    ['some_future_tool', 'other'],
    // 边界
    ['', 'other'],
  ];
  it.each(samples)('%s → %s', (name, cls) => {
    expect(toolClassOf(name)).toBe(cls);
  });

  it('null/undefined → other', () => {
    expect(toolClassOf(undefined)).toBe('other');
    expect(toolClassOf(null)).toBe('other');
  });
});

describe('isReadOnlyClass', () => {
  it('readonly + search 均只读（审批 read-only 档放行集）', () => {
    expect(isReadOnlyClass('readonly')).toBe(true);
    expect(isReadOnlyClass('search')).toBe(true);
    expect(isReadOnlyClass('shell')).toBe(false);
    expect(isReadOnlyClass('file-edit')).toBe(false);
    expect(isReadOnlyClass('other')).toBe(false);
  });
});

describe('enrichToolClass（wire additive 字段）', () => {
  it('tool part 快照补 part.toolClass', () => {
    const evt = { payload: { type: 'part.updated', properties: { part: { type: 'tool', tool: 'bash', state: { status: 'running', input: { command: 'ls' } } } } } };
    enrichToolClass(evt);
    expect(evt.payload.properties.part.toolClass).toBe('shell');
  });

  it('未知工具 → other（MCP/插件自由名）', () => {
    const evt = { payload: { type: 'part.updated', properties: { part: { type: 'tool', tool: 'mafw_mafw_search_hybrid' } } } };
    enrichToolClass(evt);
    expect(evt.payload.properties.part.toolClass).toBe('other');
  });

  it('已有 toolClass 不覆写；非 tool part / 非 part.updated 不动；text part 不加字段', () => {
    const preset = { payload: { type: 'part.updated', properties: { part: { type: 'tool', tool: 'bash', toolClass: 'file-edit' } } } };
    enrichToolClass(preset);
    expect(preset.payload.properties.part.toolClass).toBe('file-edit');
    const text = { payload: { type: 'part.updated', properties: { part: { type: 'text', text: 'hi' } } } };
    enrichToolClass(text);
    expect(text.payload.properties.part.toolClass).toBeUndefined();
    const idle = { payload: { type: 'turn.completed', properties: {} } };
    enrichToolClass(idle);
    expect(idle.payload.properties).toEqual({});
  });

  it('part.tool 缺席（畸形）→ other 且不抛', () => {
    const evt = { payload: { type: 'part.updated', properties: { part: { type: 'tool' } } } };
    expect(() => enrichToolClass(evt)).not.toThrow();
    expect(evt.payload.properties.part.toolClass).toBe('other');
  });
});

describe('toolClassOverlay（runtime 声明优先于并集表）', () => {
  afterEach(() => clearToolClassOverlay());

  it('overlay 优先于并集表', () => {
    setToolClassOverlay([{ name: 'list', toolClass: 'shell' }]);
    expect(toolClassOf('list')).toBe('shell');
  });

  it('声明表外新名字生效（大小写归一）', () => {
    setToolClassOverlay([{ name: 'InspectFile', toolClass: 'readonly' }]);
    expect(toolClassOf('inspectfile')).toBe('readonly');
    expect(toolClassOf('InspectFile')).toBe('readonly');
  });

  it('无效条目跳过并报告，好条目照常应用', () => {
    const r = setToolClassOverlay([
      { name: 'good_tool', toolClass: 'web' },
      { name: '', toolClass: 'web' },
      { name: 42, toolClass: 'web' },
      { name: 'bad_class', toolClass: 'nonsense' },
    ]);
    expect(r.applied).toBe(1);
    expect(r.invalid).toHaveLength(3);
    expect(toolClassOf('good_tool')).toBe('web');
  });

  it('重复 set 整体替换（热切换语义）', () => {
    setToolClassOverlay([{ name: 'a', toolClass: 'web' }]);
    setToolClassOverlay([{ name: 'b', toolClass: 'shell' }]);
    expect(toolClassOf('a')).toBe('other');
    expect(toolClassOf('b')).toBe('shell');
  });

  it('clear 后回落并集表', () => {
    setToolClassOverlay([{ name: 'list', toolClass: 'shell' }]);
    clearToolClassOverlay();
    expect(toolClassOf('list')).toBe('search');
  });

  it('enrichToolClass 经 overlay 生效（消费方零改动）', () => {
    setToolClassOverlay([{ name: 'my_read', toolClass: 'readonly' }]);
    const evt = { payload: { type: 'part.updated', properties: { part: { type: 'tool', tool: 'my_read' } } } };
    enrichToolClass(evt);
    expect(evt.payload.properties.part.toolClass).toBe('readonly');
  });
});
