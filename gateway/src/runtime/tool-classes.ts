/**
 * 工具语义类别层 —— 工具名 → ToolClass 的 gateway 单一事实源。
 *
 * 跨 runtime 工具命名各异（opencode `bash`/v2 `shell`、pi `bash`、Claude `Bash`、
 * codex `command_execution`；搜索区最大分歧：`grep/glob/list` vs `grep/find/ls`
 * vs `Grep/Glob`）——此前工具知识散落在审批只读名单 / 身份类别表 / 渲染 switch
 * 五层隐式契约（调研 docs/research/2026-10-13-tool-identity-layer-research.md）。
 * 本模块以**并集单表**收敛（名字空间跨平台几乎不冲突；缺省 other），对齐业界
 * ACP ToolKind / dsh ToolCallKind 的「名字自由 + 语义类别」形态。
 *
 * spec：docs/superpowers/specs/2026-10-13-tool-class-layer-design.md
 */

export type TOOL_CLASS =
  | 'readonly'   // 读文件/上下文（read）
  | 'search'     // 搜索/查找/列举（grep、glob、find、ls、list）——渲染层上下文组同集
  | 'file-edit'  // 写/改文件（write、edit、apply_patch、file_change）
  | 'shell'      // 命令执行（bash、shell、command_execution）
  | 'subagent'   // 子代理派发（task、subagent、Agent、collab_tool_call）
  | 'web'        // 网络（webfetch、websearch、web_search）
  | 'plan'       // 任务清单/计划（todowrite、TodoWrite、todo_list）
  | 'other';     // 未知/自定义工具（MCP、插件注册）——消费方自行兜底

/** 并集表（小写 key；查询大小写不敏感——Claude PascalCase 归一命中）。 */
const TOOL_CLASS_TABLE: Record<string, TOOL_CLASS> = {
  // readonly
  read: 'readonly',
  // search
  grep: 'search', glob: 'search', find: 'search', ls: 'search', list: 'search',
  // file-edit
  write: 'file-edit', edit: 'file-edit', apply_patch: 'file-edit', multiedit: 'file-edit',
  notebookedit: 'file-edit', file_change: 'file-edit',
  // shell
  bash: 'shell', shell: 'shell', powershell: 'shell', command_execution: 'shell',
  // subagent
  task: 'subagent', subagent: 'subagent', agent: 'subagent', collab_tool_call: 'subagent',
  // web
  webfetch: 'web', websearch: 'web', web_search: 'web',
  // plan
  todowrite: 'plan', todo_list: 'plan',
};

/** 工具名 → 语义类别（未知/自定义 → 'other'；大小写不敏感）。 */
export function toolClassOf(toolName: string | undefined | null): TOOL_CLASS {
  if (!toolName) return 'other';
  return TOOL_CLASS_TABLE[String(toolName).toLowerCase()] ?? 'other';
}

/** 只读判定（审批 read-only 档放行依据）：readonly + search 同为无副作用面。 */
export function isReadOnlyClass(cls: TOOL_CLASS): boolean {
  return cls === 'readonly' || cls === 'search';
}

/**
 * wire enrich（additive）：tool part 快照补 `part.toolClass` 可选字段。
 * 纯函数（原地补缺省 key，已有值不覆写）——handleOpencodeEvent 单点调用；
 * opencode 路径 passProperties 深拷贝 / pi 路径 assembler 新建对象，无 aliasing。
 */
export function enrichToolClass(evt: { type?: string; payload?: { type?: string; properties?: any } }): void {
  const type = evt?.payload?.type ?? evt?.type;
  if (type !== 'part.updated') return;
  const part = evt?.payload?.properties?.part;
  if (!part || part.type !== 'tool' || part.toolClass !== undefined) return;
  part.toolClass = toolClassOf(part.tool);
}
