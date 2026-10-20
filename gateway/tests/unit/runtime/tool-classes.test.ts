import {
  toolClassOf, isReadOnlyClass, enrichToolIdentity, enrichHistoryParts, TOOL_CLASS,
  setToolClassOverlay, clearToolClassOverlay, canonicalToolOf,
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

describe('enrichToolIdentity（wire additive 双字段）', () => {
  it('tool part 快照补 part.toolClass + part.canonicalTool', () => {
    const evt = { payload: { type: 'part.updated', properties: { part: { type: 'tool', tool: 'bash', state: { status: 'running', input: { command: 'ls' } } } } } };
    enrichToolIdentity(evt);
    expect(evt.payload.properties.part.toolClass).toBe('shell');
    expect(evt.payload.properties.part.canonicalTool).toBe('bash');
  });

  it('未知工具 → other + canonicalTool 不硬猜（undefined）', () => {
    const evt = { payload: { type: 'part.updated', properties: { part: { type: 'tool', tool: 'mafw_mafw_search_hybrid' } } } };
    enrichToolIdentity(evt);
    expect(evt.payload.properties.part.toolClass).toBe('other');
    expect(evt.payload.properties.part.canonicalTool).toBeUndefined();
  });

  it('别名工具 → canonicalTool 翻译（command_execution → bash）', () => {
    const evt = { payload: { type: 'part.updated', properties: { part: { type: 'tool', tool: 'command_execution', state: { input: { command: 'ls' } } } } } };
    enrichToolIdentity(evt);
    expect(evt.payload.properties.part.canonicalTool).toBe('bash');
  });

  it('已有 toolClass/canonicalTool 不覆写；非 tool part / 非 part.updated 不动', () => {
    const preset = { payload: { type: 'part.updated', properties: { part: { type: 'tool', tool: 'bash', toolClass: 'file-edit', canonicalTool: 'keep' } } } };
    enrichToolIdentity(preset);
    expect(preset.payload.properties.part.toolClass).toBe('file-edit');
    expect(preset.payload.properties.part.canonicalTool).toBe('keep');
    const text = { payload: { type: 'part.updated', properties: { part: { type: 'text', text: 'hi' } } } };
    enrichToolIdentity(text);
    expect(text.payload.properties.part.toolClass).toBeUndefined();
    const idle = { payload: { type: 'turn.completed', properties: {} } };
    enrichToolIdentity(idle);
    expect(idle.payload.properties).toEqual({});
  });

  it('part.tool 缺席（畸形）→ other 且不抛', () => {
    const evt = { payload: { type: 'part.updated', properties: { part: { type: 'tool' } } } };
    expect(() => enrichToolIdentity(evt)).not.toThrow();
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

  it('enrichToolIdentity 经 overlay 生效（消费方零改动）', () => {
    setToolClassOverlay([{ name: 'my_read', toolClass: 'readonly' }]);
    const evt = { payload: { type: 'part.updated', properties: { part: { type: 'tool', tool: 'my_read' } } } };
    enrichToolIdentity(evt);
    expect(evt.payload.properties.part.toolClass).toBe('readonly');
  });
});

describe('A canonical 翻译层', () => {
  afterEach(() => clearToolClassOverlay());

  it('canonicalToolOf 解析链：overlay > 静态别名表 > opencode 名小写 > undefined', () => {
    expect(canonicalToolOf('command_execution')).toBe('bash');
    expect(canonicalToolOf('ls')).toBe('list');
    expect(canonicalToolOf('find')).toBe('glob');
    expect(canonicalToolOf('file_change')).toBe('edit');
    expect(canonicalToolOf('collab_tool_call')).toBe('task');
    expect(canonicalToolOf('web_search')).toBe('websearch');
    expect(canonicalToolOf('todo_list')).toBe('todowrite');
    expect(canonicalToolOf('powershell')).toBe('bash');
    expect(canonicalToolOf('Bash')).toBe('bash');   // 大小写归一
    expect(canonicalToolOf('Read')).toBe('read');
    expect(canonicalToolOf('bash')).toBe('bash');   // 已是 opencode 名 → 恒等
    expect(canonicalToolOf('mafw_python')).toBeUndefined(); // 未知名不硬猜
    setToolClassOverlay([{ name: 'my_search', toolClass: 'search', canonical: 'grep' }]);
    expect(canonicalToolOf('my_search')).toBe('grep'); // overlay 优先
  });

  it('enrichHistoryParts：历史消息 tool parts 补两字段（幂等、非 tool 跳过）', () => {
    const msgs: any[] = [
      { info: { id: 'm1' }, parts: [{ type: 'tool', tool: 'ls', state: { input: { path: '/x' } } }, { type: 'text', text: 'hi' }] },
    ];
    enrichHistoryParts(msgs);
    expect(msgs[0].parts[0].toolClass).toBe('search');
    expect(msgs[0].parts[0].canonicalTool).toBe('list');
    expect(msgs[0].parts[1].toolClass).toBeUndefined();
    enrichHistoryParts(msgs); // 幂等
    expect(msgs[0].parts[0].canonicalTool).toBe('list');
    expect(enrichHistoryParts(undefined as any)).toBeUndefined(); // 非数组不抛
  });

  it('setToolClassOverlay 接受 canonical 声明（非法 canonical 忽略并报 invalid）', () => {
    const { applied, invalid } = setToolClassOverlay([
      { name: 'ls', toolClass: 'search', canonical: 'list' },
      { name: 'bad', toolClass: 'search', canonical: 42 },
    ]);
    expect(applied).toBe(1);
    expect(invalid).toHaveLength(1);
    expect(canonicalToolOf('ls')).toBe('list');
    // 无 canonical 声明的条目照常（名字本身即 canonical）
    setToolClassOverlay([{ name: 'my_tool', toolClass: 'other' }]);
    expect(canonicalToolOf('my_tool')).toBeUndefined();
  });
});
