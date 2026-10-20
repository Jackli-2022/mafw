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

/** runtime 声明的工具类别 overlay（优先于并集表；小写归一）。 */
const toolClassOverlay = new Map<string, TOOL_CLASS>();

/** 跨 runtime 工具别名 → opencode canonical 名（形状兼容才准入——调研 §2.2 矩阵；
 * opencode 自有名（bash/read/…）不进表，经 TOOL_CLASS_TABLE 小写命中返回自身）。 */
const TOOL_CANONICAL_TABLE: Record<string, string> = {
  // shell 域（input.command 键收敛）
  command_execution: 'bash', powershell: 'bash',
  // search/列举域（pattern+path / path 键收敛）
  ls: 'list', find: 'glob',
  // file-edit 域
  file_change: 'edit',
  // subagent 域
  collab_tool_call: 'task',
  // web 域
  web_search: 'websearch',
  // plan 域
  todo_list: 'todowrite',
};

/** runtime 声明的 canonical 覆盖（优先于静态表；小写归一）。 */
const toolCanonicalOverlay = new Map<string, string>();

const TOOL_CLASS_VALUES = new Set<string>([
  'readonly', 'search', 'file-edit', 'shell', 'subagent', 'web', 'plan', 'other',
]);

/** 工具名 → 语义类别（未知/自定义 → 'other'；大小写不敏感；runtime 声明 overlay 优先）。 */
export function toolClassOf(toolName: string | undefined | null): TOOL_CLASS {
  if (!toolName) return 'other';
  const lower = String(toolName).toLowerCase();
  return toolClassOverlay.get(lower) ?? TOOL_CLASS_TABLE[lower] ?? 'other';
}

/** 只读判定（审批 read-only 档放行依据）：readonly + search 同为无副作用面。 */
export function isReadOnlyClass(cls: TOOL_CLASS): boolean {
  return cls === 'readonly' || cls === 'search';
}

/** 工具名 → opencode canonical 名（undefined = 未知名不硬猜）。解析链：overlay 声明 → 静态别名表 → 已是 opencode 名（并集表命中）→ undefined。 */
export function canonicalToolOf(toolName: string | undefined | null): string | undefined {
  if (!toolName) return undefined;
  const lower = String(toolName).toLowerCase();
  return toolCanonicalOverlay.get(lower) ?? TOOL_CANONICAL_TABLE[lower]
    ?? (TOOL_CLASS_TABLE[lower] ? lower : undefined);
}

/**
 * wire enrich（additive）：tool part 快照补 `part.toolClass` + `part.canonicalTool`。
 * 纯函数（原地补缺省 key，已有值不覆写）——handleOpencodeEvent 单点调用；
 * opencode 路径 passProperties 深拷贝 / pi 路径 assembler 新建对象，无 aliasing。
 */
export function enrichToolIdentity(evt: { type?: string; payload?: { type?: string; properties?: any } }): void {
  const type = evt?.payload?.type ?? evt?.type;
  if (type !== 'part.updated') return;
  const part = evt?.payload?.properties?.part;
  if (!part || part.type !== 'tool') return;
  if (part.toolClass === undefined) part.toolClass = toolClassOf(part.tool);
  if (part.canonicalTool === undefined) part.canonicalTool = canonicalToolOf(part.tool);
}

/** 历史 enrich（messages 路由出口，全 runtime）：tool parts 补两字段，幂等，fail-open 由调用方包裹。 */
export function enrichHistoryParts(messages: any[]): void {
  if (!Array.isArray(messages)) return;
  for (const m of messages) {
    const parts = m?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (part?.type !== 'tool') continue;
      if (part.toolClass === undefined) part.toolClass = toolClassOf(part.tool);
      if (part.canonicalTool === undefined) part.canonicalTool = canonicalToolOf(part.tool);
    }
  }
}

/**
 * 激活期注入 runtime 声明的工具类别（整体替换——热切换语义）。无效条目
 * （空名/非法 class）跳过并报告，由调用方 warning。spec 2026-10-15 §7。
 */
export function setToolClassOverlay(entries: Array<{ name: unknown; toolClass: unknown; canonical?: unknown }>): { applied: number; invalid: string[] } {
  toolClassOverlay.clear();
  toolCanonicalOverlay.clear();
  const invalid: string[] = [];
  let applied = 0;
  for (const e of entries ?? []) {
    const name = typeof e?.name === 'string' ? e.name.trim().toLowerCase() : '';
    const cls = e?.toolClass;
    if (!name || typeof cls !== 'string' || !TOOL_CLASS_VALUES.has(cls)) {
      invalid.push(JSON.stringify(e));
      continue;
    }
    if (e.canonical !== undefined) {
      if (typeof e.canonical !== 'string' || !e.canonical.trim()) {
        invalid.push(JSON.stringify(e));
        continue;
      }
      toolCanonicalOverlay.set(name, e.canonical.trim().toLowerCase());
    }
    toolClassOverlay.set(name, cls as TOOL_CLASS);
    applied++;
  }
  return { applied, invalid };
}

/** 清空 overlay（回落并集表；测试隔离用）。 */
export function clearToolClassOverlay(): void {
  toolClassOverlay.clear();
  toolCanonicalOverlay.clear();
}
