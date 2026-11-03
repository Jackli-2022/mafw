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
import type { RuntimeCapabilities } from './contract';
import { getManagerAgentDefinition } from '../skills/manager-agent-config';
import { buildMemoryCuratorDefinition } from '../skills/memory-curator-agent';
import { getLeadAgentDefinition } from '../skills/lead-identity';
import { getTechLeadAgentDefinition } from '../skills/tech-lead-identity';
import { getPluginCreatorAgentDefinition } from '../skills/plugin-creator-identity';

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
  /**
   * 物化前置能力（纯声明门）：runtime 必须把该能力声明为 true 才物化本身份。
   * 用于「身份本身可翻译、但它依赖的工具/技能只有某类 runtime 才有」的场景
   * （`mafw-create` 的 inspect/manager 工具与随包 skill 都是插件宿主产物）。
   */
  requiresCapability?: keyof RuntimeCapabilities;
  /** 物化逃生舱：原生 AgentDefinition 的 permissions（含 permissions.tools 规则面） */
  nativePermissions?: AgentPermissions;
  /** 物化逃生舱：原生 AgentDefinition 顶层 tools 布尔面（opencode '*' 硬禁用） */
  nativeTools?: Record<string, boolean>;
  /**
   * 已退役身份：仅为既有会话可读而保留物化（当前唯一成员是 `manager`）。
   * 新代码不得选择 deprecated 身份——业务解析走 `resolveIdentityAlias()`。
   */
  deprecated?: boolean;
}

export interface IdentityRegistry {
  list(): IdentitySpec[];
  get(name: string): IdentitySpec | undefined;
}

/**
 * 已退役身份 → 现行身份。`manager` 是 Lead 的历史名：既有 manager 会话继续可读写，
 * 但用户界面、Pod roster 与新逻辑只使用 Lead（spec §3.1，不形成第二个协调身份）。
 */
const DEPRECATED_IDENTITY_ALIASES: Readonly<Record<string, string>> = { manager: 'lead' };

/** 业务层身份名解析：别名解析到现行身份，其余原样返回。 */
export function resolveIdentityAlias(name: string): string {
  return DEPRECATED_IDENTITY_ALIASES[name] ?? name;
}

export type ToolCategory = 'file-edit' | 'shell' | 'subagent' | 'web' | 'readonly';

/**
 * 工具类别解析（v2026-10-13 收敛）：并集单表 tool-classes.ts（跨 runtime 名字
 * 归一：opencode/pi 小写名、Claude PascalCase、codex 条目类型名）——原 per-runtime
 * 双表已删（pi 表漏 find 曾致 manager 误 auto-deny；未知 runtime 整表 miss 的
 * allowlist 语义反转一并消除）。ToolClass → ToolCategory 映射：search→readonly
 * （同为无副作用面）；plan/other → null（落穿 policy，由裸名/前缀规则裁决）。
 */
import { toolClassOf, TOOL_CLASS } from './tool-classes';

const CLASS_TO_CATEGORY: Partial<Record<TOOL_CLASS, ToolCategory>> = {
  readonly: 'readonly',
  search: 'readonly',
  'file-edit': 'file-edit',
  shell: 'shell',
  subagent: 'subagent',
  web: 'web',
};

/** runtimeName 参数保留兼容（并集表无需分 runtime；未来 per-runtime 覆盖再启用）。 */
export function resolveToolCategory(toolName: string, _runtimeName?: string): ToolCategory | null {
  return CLASS_TO_CATEGORY[toolClassOf(toolName)] ?? null;
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
  const lead = getLeadAgentDefinition();
  const curator = buildMemoryCuratorDefinition();
  const techLead = getTechLeadAgentDefinition();
  const creator = getPluginCreatorAgentDefinition();
  return [
    {
      // Lead：用户可感知的唯一协调身份（替换 Manager，spec §3.1）。
      name: 'lead',
      description: lead.description,
      scope: 'primary',
      systemPrompt: lead.systemPrompt,
      color: lead.color,
      policy: {
        deny: ['file-edit', 'subagent'],
        allowlist: ['mafw_*', 'question', 'plan_exit', 'shell', 'readonly'],
      },
      nativePermissions: lead.permissions,
      nativeTools: lead.tools,
    },
    {
      // deprecated 别名：既有 manager 会话仍按原样物化与读取，但不再对社会公开。
      // 业务解析请用 resolveIdentityAlias('manager') → 'lead'。
      name: 'manager',
      description: mgr.description,
      scope: 'primary',
      systemPrompt: mgr.systemPrompt,
      color: mgr.color,
      deprecated: true,
      policy: {
        deny: ['file-edit', 'subagent'],
        allowlist: ['mafw_*', 'question', 'plan_exit', 'shell', 'readonly'],
      },
      nativePermissions: mgr.permissions,
      nativeTools: mgr.tools,
    },
    {
      // Creator：统一插件包的 primary 身份（spec 2026-11-03 §15.2）。身份只做薄权限壳；
      // 详细教程在 skills/plugin-creator/SKILL.md。skill 必须显式进 allowlist——原生
      // tools['*']=false 已禁全部工具，漏掉它 Creator 自己就加载不了随包技能。
      name: 'mafw-create',
      description: creator.description,
      scope: 'primary',
      systemPrompt: creator.systemPrompt,
      // 工具（mafw_plugin_inspect/manager）与随包 plugin-creator 技能都来自
      // OpenCode 插件宿主；没有它们的 runtime（pi）不物化这个身份。
      requiresCapability: 'pluginCreatorApi',
      policy: {
        deny: ['shell', 'web', 'subagent'],
        allowlist: [
          'readonly', 'file-edit', 'skill', 'question', 'plan_exit', 'todowrite',
          'mafw_plugin_inspect', 'mafw_plugin_manager',
          'mafw_add_memory', 'mafw_search_hybrid', 'mafw_get_memory',
        ],
      },
      nativePermissions: creator.permissions,
      nativeTools: creator.tools,
    },
    {
      name: 'mafw-tech-lead',
      // Tech Lead：Goal 级调研/规划。只读项目 + web + Pod/记忆；无 file-edit、无 shell
      // （需要副作用验证时委托 Builder Spike）。模型与 goal 节点身份一致（gateway 钉模型）。
      description: techLead.description,
      scope: 'worker',
      model: { providerID: 'gateway', modelID: 'volcengine/deepseek-v4.1-flash' },
      systemPrompt: techLead.systemPrompt,
      policy: {
        deny: ['file-edit', 'shell'],
        allowlist: [
          'readonly', 'web',
          'mafw_get_goal_status', 'mafw_get_deltas',
          'mafw_search_hybrid', 'mafw_add_memory', 'mafw_get_memory',
          'mafw_pin_memory', 'mafw_supersede_memory',
          'mafw_pod_*',
        ],
      },
      nativePermissions: techLead.permissions,
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
      model: { providerID: 'gateway', modelID: 'volcengine/deepseek-v4.1-flash' },
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
        allowlist: ['readonly', 'mafw_get_goal_status', 'mafw_get_deltas', 'mafw_search_hybrid', 'mafw_pod_*'],
      },
    },
    {
      name: 'mafw-execute',
      description: 'MAFW goal 编排 execute 节点：按 waves.json 执行任务，产出 receipts。全权限。',
      scope: 'worker',
      model: { providerID: 'gateway', modelID: 'volcengine/deepseek-v4.1-flash' },
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
      model: { providerID: 'gateway', modelID: 'volcengine/deepseek-v4.1-flash' },
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
        allowlist: ['readonly', 'shell', 'mafw_get_goal_status', 'mafw_search_hybrid', 'mafw_pod_*'],
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

/**
 * 物化前置判定（纯函数）：无能力要求 → 可物化；有要求 → runtime 必须显式声明 true。
 * 缺失声明（旧插件/未知 runtime）按不支持处理，绝不默认放行。
 */
export function identityMaterializable(
  spec: IdentitySpec,
  capabilities: RuntimeCapabilities,
): boolean {
  if (!spec.requiresCapability) return true;
  return capabilities[spec.requiresCapability] === true;
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
    // W1 修复：opencode agent 的 model 是 provider/model 完整引用——只序列化
    // modelID 会物化出无 provider 的悬空引用（潜伏 bug，首个钉模型的身份暴露）。
    ...(spec.model ? { model: `${spec.model.providerID}/${spec.model.modelID}` } : {}),
    systemPrompt: spec.systemPrompt,
    permissions,
    ...(spec.nativeTools ? { tools: spec.nativeTools } : {}),
  };
}
