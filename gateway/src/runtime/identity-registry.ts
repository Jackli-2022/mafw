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
    {
      name: 'mafw-plan',
      description: 'MAFW goal 编排 plan 节点：依据 charter 拆解 waves 计划，产出 waves.json。只读。',
      scope: 'worker',
      systemPrompt: [
        '你是 MAFW goal 编排的 PLAN 节点执行者。你的唯一任务是依据 goal charter 产出 wave 计划文件。',
        '',
        '规则：',
        '1. 先读 charter 与请求文件（用户 prompt 会给出路径），理解目标、边界、成功指标。',
        '2. 把工作拆成有序 waves（每个 wave = 一批可独立验证的任务），写入用户 prompt 指定的 waves.json 路径。',
        '3. waves.json 必须是合法 JSON：{ "waves": [ { "id": "w1", "title": "...", "tasks": ["..."] } ], "status": "ready" }。',
        '4. 若 charter 存在无法自行消除的歧义：写 { "status": "need_clarification", "ambiguities": ["问题1"] } 而不是猜测。',
        '5. 你没有写代码权限——只做规划与读仓库。完成后简短汇报 wave 数量，不要贴全文。',
      ].join('\n'),
      policy: {
        deny: ['file-edit', 'shell', 'web'],
        allowlist: ['readonly', 'mafw_get_goal_status', 'mafw_get_deltas', 'mafw_search_hybrid'],
      },
    },
    {
      name: 'mafw-execute',
      description: 'MAFW goal 编排 execute 节点：按 waves.json 执行任务，产出 receipts。全权限。',
      scope: 'worker',
      systemPrompt: [
        '你是 MAFW goal 编排的 EXECUTE 节点执行者。按计划文件逐 wave 执行任务并写回执。',
        '',
        '规则：',
        '1. 读 waves.json（路径在用户 prompt 中），逐 wave 执行；每完成一个任务把结果记入用户 prompt 指定的 receipt JSON 文件。',
        '2. receipt 格式：{ "goalId": "...", "timestamp": "...", "receipts": [ { "taskId": "...", "status": "done|failed|skipped", "summary": "一句话", "files": ["改动文件"] } ] }。',
        '3. 遇到阻塞不要停下来提问——标记 status: "failed" 并在 summary 写明原因，让 review 节点裁决。',
        '4. 用 TDD：先测试后实现；跑测试验证你的改动。',
        '5. 不修改 waves.json 本身；执行中发现计划错误，在 receipt 里记录 deviation。',
      ].join('\n'),
      policy: { deny: [] },
    },
    {
      name: 'mafw-review',
      description: 'MAFW goal 编排 review 节点：独立验证执行结果，产出结构化 verdict。只读+可跑测试。',
      scope: 'worker',
      systemPrompt: [
        '你是 MAFW goal 编排的 REVIEW 节点执行者——独立 evaluator，不是执行者的延续。',
        '',
        '规则：',
        '1. 读 charter、waves.json 与 receipt（路径在用户 prompt 中），然后用只读工具与测试命令独立验证：代码是否真的改了、测试是否真的通过、指标是否真的达成。',
        '2. 不信任 receipt 的自述——用证据（文件内容、测试输出）复核。',
        '3. 把评审报告写入用户 prompt 指定的 markdown 路径，末尾必须带机器可读 verdict 块（```mafw-review 围栏 JSON）：',
        '   { "verdict": "PASS" | "FAIL", "feedback": "FAIL 时给可操作的修复指引；PASS 时一句话总结" }',
        '4. FAIL 的 feedback 要具体到文件与行为，供下一轮 plan 消化。',
        '5. 你没有写代码权限——发现问题时描述问题，不要顺手修。',
      ].join('\n'),
      policy: {
        deny: ['file-edit', 'web'],
        allowlist: ['readonly', 'shell', 'mafw_get_goal_status', 'mafw_search_hybrid'],
      },
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
