// IdentityState —— session→identity 绑定（内存）+ (runtime, identity) 物化状态
// + prompt 包装器（物化车道 1 的绑定执行点）+ GET /api/agents 列表合并。
//
// 绑定不持久化：gateway 驱动会话在创建/恢复时重新登记（ensureManagerSession 启动遍历），
// 回合级绑定（用户选身份）在 session.idle 清除。
// （spec docs/superpowers/specs/2026-10-08-runtime-neutral-agent-identity-design.md §3.2/3.4）

export interface IdentityBinding {
  identity: string;
  kind: 'session' | 'turn';
}

export class IdentityState {
  private bindings = new Map<string, IdentityBinding>();
  private materialized = new Map<string, boolean>(); // key: `${runtime}|${identity}`

  bind(sessionID: string, identity: string, kind: 'session' | 'turn'): void {
    // session 绑定优先于 turn：已存在 session 绑定时 turn 不覆盖
    const existing = this.bindings.get(sessionID);
    if (existing?.kind === 'session' && kind === 'turn') return;
    this.bindings.set(sessionID, { identity, kind });
  }

  unbind(sessionID: string): void {
    this.bindings.delete(sessionID);
  }

  get(sessionID: string): IdentityBinding | undefined {
    return this.bindings.get(sessionID);
  }

  clearTurnBindings(sessionID: string): void {
    if (this.bindings.get(sessionID)?.kind === 'turn') this.bindings.delete(sessionID);
  }

  setMaterialized(runtimeName: string, identity: string, ok: boolean): void {
    this.materialized.set(`${runtimeName}|${identity}`, ok);
  }

  isMaterialized(runtimeName: string, identity: string): boolean {
    return this.materialized.get(`${runtimeName}|${identity}`) === true;
  }

  resetMaterialization(runtimeName: string): void {
    const prefix = `${runtimeName}|`;
    for (const k of this.materialized.keys()) {
      if (k.startsWith(prefix)) this.materialized.delete(k);
    }
  }
}

/**
 * prompt 包装器（物化车道 1 的绑定执行点）：
 * - 绑定 + 已物化 + 未指定 agent → 注入 agent = identity 名
 * - agent 是注册表身份且未物化 → 剥离（防未知 agent 报错；该 runtime 走车道 2/3 时身份不经 agent）
 * - 非注册表 agent（build/plan 等 runtime 原生）原样透传
 */
export function withIdentityPrompt<S extends { sessionID: string; agent?: string }>(
  session: { promptAsync(o: S): Promise<any>; prompt(o: S): Promise<any> },
  state: IdentityState,
  runtimeName: () => string,
  isRegistryIdentity: (name: string) => boolean,
): { promptAsync(o: S): Promise<any>; prompt(o: S): Promise<any> } {
  const apply = (opts: S): S => {
    if (opts.agent) {
      if (isRegistryIdentity(opts.agent) && !state.isMaterialized(runtimeName(), opts.agent)) {
        const { agent: _drop, ...rest } = opts as any;
        return rest as S;
      }
      return opts;
    }
    const binding = state.get(opts.sessionID);
    if (binding && state.isMaterialized(runtimeName(), binding.identity)) {
      return { ...opts, agent: binding.identity } as S;
    }
    return opts;
  };
  return {
    promptAsync: (o: S) => session.promptAsync(apply(o)),
    prompt: (o: S) => session.prompt(apply(o)),
  };
}

/** GET /api/agents 合并：注册表身份在前（source: 'mafw'），runtime 原生在后（source: 'runtime'），同名去重 */
export function mergeAgentLists(
  registryItems: Array<{ name: string; description: string; scope: string }>,
  runtimeAgents: any[],
): any[] {
  const out: any[] = registryItems.map((i) => ({
    name: i.name,
    description: i.description,
    mode: i.scope === 'primary' ? 'primary' : 'subagent',
    source: 'mafw',
  }));
  const seen = new Set(registryItems.map((i) => i.name));
  for (const a of Array.isArray(runtimeAgents) ? runtimeAgents : []) {
    if (a && typeof a.name === 'string' && !seen.has(a.name)) {
      seen.add(a.name);
      out.push({ ...a, source: 'runtime' });
    }
  }
  return out;
}
