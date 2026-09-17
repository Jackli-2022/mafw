/**
 * Serve 进程唯一编排者：adopt / kill / spawn / 就绪等待。
 * 从 index.ts 下沉（原 killProcessOnPort + startServe + isServeHealthy 的动作段）。
 * 原则：gateway 只编排，不实现——健康检测经 runtime 契约（health()）、
 * 地址归 runtime（baseUrl()）、kill/spawn 都是 runtime 原语，gateway 不传
 * host/port（serve 端口是 runtime 实现细节）。deps 全部注入以便单测。
 */

export interface ServeSupervisorDeps {
  /** runtime 是否持有启停原语（agentProcess.spawnServe）——late-bound：
   *  runtime 可热切换（opencode↔pi），每次调用现读，防旧判定残留。 */
  managed: () => boolean;
  /** 健康检测唯一真相源：runtime 契约 healthCheck()。gateway 不自带探测。 */
  health: () => Promise<boolean>;
  /** 当前 agent 后端地址（runtime.getBaseUrl()），供返回值/日志。 */
  baseUrl: () => string;
  /** runtime 原语：清场（杀遗留 serve 端口占用者）。 */
  killServe: () => void;
  /** runtime 原语：拉起 server 进程。gateway 不传 host/port。 */
  spawn: (opts: { timeoutMs: number }) => Promise<{ url: string; close: () => void }>;
  probeIntervalMs?: number;
  probeTimeoutMs?: number;
}

export interface ServeSupervisor {
  readonly owned: boolean;
  ensureStarted(): Promise<string>;
  restart(): Promise<string>;
  health(): Promise<boolean>;
  close(): void;
}

export function createServeSupervisor(deps: ServeSupervisorDeps): ServeSupervisor {
  const probeIntervalMs = deps.probeIntervalMs ?? 500;
  const probeTimeoutMs = deps.probeTimeoutMs ?? 60_000;

  let instance: { url: string; close: () => void } | undefined;
  let starting: Promise<string> | undefined;

  const refused = () => new Error('unmanaged runtime: gateway holds no start/stop primitives');

  const spawnAndWait = async (): Promise<string> => {
    instance = await deps.spawn({ timeoutMs: probeTimeoutMs });
    const deadline = Date.now() + probeTimeoutMs;
    while (Date.now() < deadline) {
      if (await deps.health()) return deps.baseUrl();
      await new Promise(r => setTimeout(r, probeIntervalMs));
    }
    throw new Error(`runtime did not become healthy within ${probeTimeoutMs}ms`);
  };

  return {
    get owned() { return deps.managed(); },
    async ensureStarted(): Promise<string> {
      if (!deps.managed()) throw refused();
      // Adopt：runtime 健康（含用户自管/已有监听）直接收养，绝不 kill——
      // 健康判定来自 runtime 契约，gateway 不构造候选 URL。
      if (await deps.health()) return deps.baseUrl();
      if (starting) return starting;
      starting = (async () => {
        try {
          deps.killServe();
          instance = undefined;
          return await spawnAndWait();
        } finally { starting = undefined; }
      })();
      return starting;
    },
    async restart(): Promise<string> {
      if (!deps.managed()) throw refused();
      if (starting) return starting;
      starting = (async () => {
        try {
          deps.killServe();
          instance?.close();
          instance = undefined;
          return await spawnAndWait();
        } finally { starting = undefined; }
      })();
      return starting;
    },
    async health(): Promise<boolean> {
      return deps.health();
    },
    close() {
      try { instance?.close(); } catch { /* ignore */ }
      instance = undefined;
    },
  };
}
