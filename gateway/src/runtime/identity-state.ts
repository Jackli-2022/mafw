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
 *
 * 用 Proxy 转发：只覆写 promptAsync/prompt，**其余方法（messages/list/get/delete/todo/fork…）
 * 一律透传**——此前返回两方法对象整体替换 rt.session，导致 session.messages is not a function，
 * 会话列表/历史全空（v4.21.0 回归，2026-10-09 修）。
 */
export function withIdentityPrompt<
  S extends { sessionID: string; agent?: string },
  T extends { promptAsync(o: any): Promise<any>; prompt(o: any): Promise<any> },
>(
  session: T,
  state: IdentityState,
  runtimeName: () => string,
  isRegistryIdentity: (name: string) => boolean,
): T {
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
  return new Proxy(session as any, {
    get(target, prop, receiver) {
      if (prop === 'promptAsync') return (o: S) => target.promptAsync(apply(o));
      if (prop === 'prompt') return (o: S) => target.prompt(apply(o));
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as unknown as T;
}

/** GET /api/agents 合并：注册表身份在前（source: 'mafw'），runtime 原生在后（source: 'runtime'），同名去重。
 *  materialized === false 的注册表身份被滤出（当前 runtime 上 agent 参数会被剥离，
 *  列出它是 UX 谎言）；被滤出的名字不占去重——runtime 侧同名条目以 source:'runtime' 落穿。 */
export function mergeAgentLists(
  registryItems: Array<{ name: string; description: string; scope: string; materialized?: boolean }>,
  runtimeAgents: any[],
): any[] {
  const visible = registryItems.filter((i) => i.materialized !== false);
  const out: any[] = visible.map((i) => ({
    name: i.name,
    description: i.description,
    mode: i.scope === 'primary' ? 'primary' : 'subagent',
    source: 'mafw',
  }));
  const seen = new Set(visible.map((i) => i.name));
  for (const a of Array.isArray(runtimeAgents) ? runtimeAgents : []) {
    if (a && typeof a.name === 'string' && !seen.has(a.name)) {
      seen.add(a.name);
      out.push({ ...a, source: 'runtime' });
    }
  }
  return out;
}
