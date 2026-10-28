/**
 * runtime 插件返回值"声明 vs 实现"一致性校验（分严重级）。
 *
 * 目标：插件"跑起来了但有几个接口没实现"必须在激活/切换期就暴露，而不是
 * 运行时深处才炸（报错点远离原因、静默 fail-open 无迹可查）。
 *
 * 三级语义：
 *   hard       — 契约必选面缺失（session 全套 11 方法 / eventStream 的
 *                global.event / providerConfigApi 的 provider.list、app.agents、
 *                config.get|update / tools 注册通道 registerTools+nativeTools）。
 *                调用方据此回退内置 runtime。
 *   downgraded — 声明了能力位但缺对应可选实现（nativeApprovals→permissionReply、
 *                completionApi→completion.complete 等）。能力位被强制写回 false
 *                （作用于 rt.capabilities 的拷贝，不改插件共享对象），对应功能
 *                走 503 能力门而非运行时 TypeError。
 *   warnings   — 非阻断缺口（可选 session.update、healthCheck、getBaseUrl、
 *                permissionList、turnBudgetApi 信任声明）。只记录，不改变行为。
 */
import type { AgentRuntime, RuntimeCapabilities } from './contract';

export interface RuntimeValidation {
  hard: string[];
  downgraded: string[];
  warnings: string[];
}

const SESSION_REQUIRED_BY_SESSION_API = [
  'create', 'promptAsync', 'prompt', 'messages',
  'get', 'delete', 'abort', 'list', 'todo', 'children', 'summarize',
] as const;

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFn(v: unknown): v is Function {
  return typeof v === 'function';
}

/** 能力位 → 所需实现（全部满足才保留声明；缺失则降级该位）。 */
const CAPABILITY_REQUIREMENTS: Array<{ cap: keyof RuntimeCapabilities; label: string; satisfied: (rt: any) => boolean }> = [
  { cap: 'nativeApprovals', label: 'session.permissionReply', satisfied: (rt) => isFn(rt.session?.permissionReply) },
  { cap: 'questionApi', label: 'session.question.{list,reply,reject}', satisfied: (rt) =>
      isObject(rt.session?.question) && isFn(rt.session.question.list) && isFn(rt.session.question.reply) && isFn(rt.session.question.reject) },
  { cap: 'sessionBranchApi', label: 'session.fork + session.revert', satisfied: (rt) =>
      isFn(rt.session?.fork) && isFn(rt.session?.revert) },
  { cap: 'diffApi', label: 'session.diff + session.vcs.apply', satisfied: (rt) =>
      isFn(rt.session?.diff) && isFn(rt.session?.vcs?.apply) },
  { cap: 'completionApi', label: 'completion.complete', satisfied: (rt) => isFn(rt.completion?.complete) },
  { cap: 'agentConfigApi', label: 'agents.install', satisfied: (rt) => isFn(rt.agents?.install) },
  { cap: 'agentProcessApi', label: 'agentProcess.restart', satisfied: (rt) => isFn(rt.agentProcess?.restart) },
  { cap: 'sessionStorageApi', label: 'session.listByDirectory', satisfied: (rt) => isFn(rt.session?.listByDirectory) },
  { cap: 'instructionsApi', label: 'session.instructions.{list,put,remove}', satisfied: (rt) =>
      isObject(rt.session?.instructions) && isFn(rt.session.instructions.list) &&
      isFn(rt.session.instructions.put) && isFn(rt.session.instructions.remove) },
  { cap: 'discoveryApi', label: 'discovery.{list,loadSkill}', satisfied: (rt) =>
      isObject(rt.discovery) && isFn(rt.discovery.list) && isFn(rt.discovery.loadSkill) },
];

export function validateRuntime(rt: AgentRuntime, source: string): RuntimeValidation {
  const out: RuntimeValidation = { hard: [], downgraded: [], warnings: [] };
  if (!isObject(rt)) {
    out.hard.push(`${source}: runtime must be an object (got ${typeof rt})`);
    return out;
  }

  if (typeof rt.name !== 'string' || !rt.name) {
    out.hard.push(`${source}: runtime.name must be a non-empty string (got ${typeof rt.name})`);
  }
  const caps = rt.capabilities;
  if (!isObject(caps)) {
    out.hard.push(`${source}: runtime.capabilities must be an object (got ${typeof caps})`);
    return out;
  }

  // ── hard：契约必选面 ──────────────────────────────────────────────────
  if (caps.sessionApi) {
    if (!isObject(rt.session)) {
      out.hard.push(`${source}: declares sessionApi but session is missing`);
    } else {
      for (const method of SESSION_REQUIRED_BY_SESSION_API) {
        if (!isFn((rt.session as any)[method])) {
          out.hard.push(`${source}: declares sessionApi but session.${method} is missing (not a function)`);
        }
      }
    }
  }
  if (caps.eventStream) {
    const ev = rt.global as any;
    if (!isObject(ev) || !isFn(ev.event)) {
      out.hard.push(`${source}: declares eventStream but global.event is missing (not a function)`);
    }
  }
  if (caps.providerConfigApi) {
    if (!isFn((rt as any).provider?.list)) {
      out.hard.push(`${source}: declares providerConfigApi but provider.list is missing (not a function)`);
    }
    if (!isFn((rt as any).app?.agents)) {
      out.hard.push(`${source}: declares providerConfigApi but app.agents is missing (not a function)`);
    }
    if (!isFn((rt as any).config?.get) || !isFn((rt as any).config?.update)) {
      out.hard.push(`${source}: declares providerConfigApi but config.get/config.update is missing (not a function)`);
    }
  }
  // ── hard：工具注册通道（Tier-0 必选，无条件——非能力门控） ─────────────
  const tools = (rt as any).tools;
  if (!isObject(tools) || !isFn(tools.registerTools)) {
    out.hard.push(`${source}: tools.registerTools is missing (not a function) — MAFW basic tools have no path to your agents (Tier-0 required)`);
  }
  if (!isObject(tools) || !isFn(tools.nativeTools)) {
    out.hard.push(`${source}: tools.nativeTools is missing (not a function; returning [] is valid) — tool classification falls back to the static union table`);
  }
  if (out.hard.length > 0) return out; // 必选面已破，能力降级无意义

  // ── downgraded：能力位声明 vs 可选实现 ────────────────────────────────
  // 写回 capabilities 的拷贝——插件可能共享同一个 capabilities 常量对象
  // （pi 的 PI_CAPABILITIES），直接改字段会污染后续实例。
  let effectiveCaps: RuntimeCapabilities | null = null;
  const downgrade = (cap: keyof RuntimeCapabilities, label: string) => {
    if (!effectiveCaps) effectiveCaps = { ...caps };
    (effectiveCaps as any)[cap] = false;
    out.downgraded.push(
      `${source}: declares ${cap} but ${label} is missing — capability downgraded to false ` +
      `(gated features will 503 instead of failing at runtime)`,
    );
  };
  for (const req of CAPABILITY_REQUIREMENTS) {
    if ((caps as any)[req.cap] && !req.satisfied(rt)) downgrade(req.cap, req.label);
  }
  if (effectiveCaps) (rt as any).capabilities = effectiveCaps;

  // ── warnings：非阻断缺口 ─────────────────────────────────────────────
  if (caps.sessionApi && isObject(rt.session) && !isFn((rt.session as any).update)) {
    out.warnings.push(
      `${source}: session.update is missing — session rename (PATCH /api/sessions/:id) will fail at runtime`,
    );
  }
  if (caps.nativeApprovals && isFn((rt.session as any)?.permissionReply) && !isFn((rt.session as any)?.permissionList)) {
    out.warnings.push(
      `${source}: nativeApprovals declared with permissionReply but session.permissionList is missing — approval polling will be empty`,
    );
  }
  if (!isFn((rt as any).healthCheck)) {
    out.warnings.push(
      `${source}: healthCheck is missing — runtime will be treated as permanently unhealthy ` +
      `(owned runtimes will try to spawn serve; external runtimes degrade to MCP-only)`,
    );
  }
  if (!isFn((rt as any).getBaseUrl)) {
    out.warnings.push(`${source}: getBaseUrl is missing — reverse proxy falls back to the configured serve URL`);
  }
  if (caps.turnBudgetApi) {
    out.warnings.push(
      `${source}: declares turnBudgetApi — trusting the runtime to enforce maxTurns/maxCostUsd natively; ` +
      `gateway BudgetGuard will NOT be attached (a false claim silently disables goal budgets)`,
    );
  }
  return out;
}
