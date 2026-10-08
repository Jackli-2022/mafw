// IdentityRegistry —— MAFW agent 身份的单一事实源
// （spec docs/superpowers/specs/2026-10-08-runtime-neutral-agent-identity-design.md）。
//
// 身份注入走「物化（materialization）+ 绑定」：runtime adapter 把 IdentitySpec 渲染成
// 自家原生格式（opencode agent md / pi prompts+extension），prompt 以原生 agent 选择器绑定。
// 本模块只提供数据与纯派生，无副作用。
//
// 原生侧（nativePermissions/nativeTools）直接复用既有 builder，保证物化产物与今天
// 逐字节等价、零漂移；policy 是网关策略层的单一事实源（中立类别词汇）。
import { AgentDefinition, AgentPermissions } from './agent-definition';
import { getManagerAgentDefinition } from '../skills/manager-agent-config';
import { buildMemoryCuratorDefinition } from '../skills/memory-curator-agent';

export interface IdentityPolicy {
  /** 绝对拒绝：类别标签（file-edit/shell/subagent/web/readonly）或工具名 */
  deny: string[];
  /** 白名单存在时未列出即拒：工具名（支持 mafw_* 前缀通配）或类别标签 */
  allowlist?: string[];
}

export interface IdentitySpec {
  name: string;
  description: string;
  scope: 'primary' | 'worker';
  systemPrompt: string;
  color?: string;
  model?: { providerID: string; modelID: string };
  policy: IdentityPolicy;
  /** 物化逃生舱：原生 AgentDefinition 的 permissions（含 permissions.tools 规则面） */
  nativePermissions?: AgentPermissions;
  /** 物化逃生舱：原生 AgentDefinition 顶层 tools 布尔面（opencode '*' 硬禁用） */
  nativeTools?: Record<string, boolean>;
}

export interface IdentityRegistry {
  list(): IdentitySpec[];
  get(name: string): IdentitySpec | undefined;
}

export type ToolCategory = 'file-edit' | 'shell' | 'subagent' | 'web' | 'readonly';

/** v1 内置类别表：opencode + pi（工具名 → 中立类别）。未来 runtime 经 loader extras 声明。 */
const TOOL_CATEGORY_TABLES: Record<string, Record<string, ToolCategory>> = {
  opencode: {
    edit: 'file-edit', write: 'file-edit', apply_patch: 'file-edit', multiedit: 'file-edit',
    bash: 'shell',
    task: 'subagent',
    webfetch: 'web',
    read: 'readonly', grep: 'readonly', glob: 'readonly', ls: 'readonly', list: 'readonly',
  },
  pi: {
    edit: 'file-edit', write: 'file-edit', apply_patch: 'file-edit',
    bash: 'shell',
    task: 'subagent',
    webfetch: 'web',
    read: 'readonly', grep: 'readonly', glob: 'readonly', ls: 'readonly', list: 'readonly',
  },
};

export function resolveToolCategory(toolName: string, runtimeName: string): ToolCategory | null {
  return TOOL_CATEGORY_TABLES[runtimeName]?.[toolName] ?? null;
}

/** deny 类别 → 原生权限键（无 nativePermissions 逃生舱时的派生用） */
const DENY_CATEGORY_TO_NATIVE: Record<ToolCategory, (p: AgentPermissions) => void> = {
  'file-edit': (p) => { p.edit = 'deny'; },
  shell: (p) => { p.bash = 'deny'; },
  subagent: (p) => { p.task = { ...(p.task ?? {}), general: 'deny' }; },
  web: () => { /* opencode 无 web 权限键——webfetch 经 tools 面禁；无操作 */ },
  readonly: () => { /* 拒只读无意义 */ },
};

/** 纯策略判定：'deny' | 'allow' | null（落穿——白名单不存在且未命中 deny） */
export function policyDecides(
  policy: IdentityPolicy,
  toolName: string,
  categoryOf: (t: string) => ToolCategory | null,
): 'allow' | 'deny' | null {
  const cat = categoryOf(toolName);
  if (policy.deny.includes(toolName) || (cat !== null && policy.deny.includes(cat))) return 'deny';
  if (!policy.allowlist) return null;
  const listed = policy.allowlist.some((e) =>
    e.endsWith('*') ? toolName.startsWith(e.slice(0, -1)) : e === toolName || e === cat,
  );
  return listed ? 'allow' : 'deny';
}

function buildBuiltins(): IdentitySpec[] {
  const mgr = getManagerAgentDefinition();
  const curator = buildMemoryCuratorDefinition();
  return [
    {
      name: 'manager',
      description: mgr.description,
      scope: 'primary',
      systemPrompt: mgr.systemPrompt,
      color: mgr.color,
      policy: {
        deny: ['file-edit', 'subagent'],
        allowlist: ['mafw_*', 'question', 'plan_exit', 'shell', 'readonly'],
      },
      nativePermissions: mgr.permissions,
      nativeTools: mgr.tools,
    },
    {
      name: 'memory-curator',
      description: curator.description,
      scope: 'worker',
      systemPrompt: curator.systemPrompt,
      color: curator.color,
      policy: {
        deny: ['file-edit', 'shell', 'web'],
        allowlist: ['mafw_add_memory', 'mafw_search_hybrid', 'mafw_supersede_memory', 'readonly'],
      },
      nativePermissions: curator.permissions,
      nativeTools: curator.tools,
    },
  ];
}

export function createBuiltinIdentityRegistry(): IdentityRegistry {
  const builtins = buildBuiltins();
  return {
    list: () => builtins.slice(),
    get: (name) => builtins.find((s) => s.name === name),
  };
}

/** 从注册表条目派生原生 AgentDefinition（物化器输入）——native 逃生舱原样透传，保证字节等价。 */
export function toAgentDefinition(spec: IdentitySpec): AgentDefinition {
  let permissions: AgentPermissions;
  if (spec.nativePermissions) {
    permissions = { ...spec.nativePermissions };
  } else {
    permissions = {};
    for (const entry of spec.policy.deny) {
      const applier = DENY_CATEGORY_TO_NATIVE[entry as ToolCategory];
      if (applier) applier(permissions);
    }
  }
  return {
    description: spec.description,
    mode: spec.scope === 'primary' ? 'primary' : 'subagent',
    ...(spec.color ? { color: spec.color } : {}),
    ...(spec.model ? { model: spec.model.modelID } : {}),
    systemPrompt: spec.systemPrompt,
    permissions,
    ...(spec.nativeTools ? { tools: spec.nativeTools } : {}),
  };
}
