/**
 * Serve 进程唯一所有者：kill / spawn / 就绪等待 / 健康探测。
 * 从 index.ts 下沉（原 killProcessOnPort + startServe + isServeHealthy 的动作段）。
 * kill 与 spawn 都是 runtime 契约原语（killServePort / agentProcess.spawnServe），
 * 本模块只做通用编排；gateway 编排层（recoverServe/watchdog）在其上叠加事件流重订。
 * deps 全部注入以便单测；生产装配见 index.ts。
 */

export interface ServeSupervisorDeps {
  port: number;
  host?: string;
  external: boolean;
  killPort: (port: number) => void;
  spawn: (opts: { host: string; port: number; timeoutMs: number; onOutput?: (chunk: string) => void }) => Promise<{ url: string; close: () => void }>;
  probe: (url: string) => Promise<boolean>;
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
  const host = deps.host ?? '127.0.0.1';
  const probeIntervalMs = deps.probeIntervalMs ?? 500;
  const probeTimeoutMs = deps.probeTimeoutMs ?? 60_000;

  let instance: { url: string; close: () => void } | undefined;
  let starting: Promise<string> | undefined;

  const refused = () => new Error('external agent process is not managed by the gateway');

  const spawnAndWait = async (): Promise<string> => {
    instance = await deps.spawn({ host, port: deps.port, timeoutMs: probeTimeoutMs });
    const deadline = Date.now() + probeTimeoutMs;
    while (Date.now() < deadline) {
      if (await deps.probe(instance.url)) return instance.url;
      await new Promise(r => setTimeout(r, probeIntervalMs));
    }
    throw new Error(`serve did not become healthy within ${probeTimeoutMs}ms`);
  };

  return {
    get owned() { return !deps.external; },
    async ensureStarted(): Promise<string> {
      if (deps.external) throw refused();
      if (instance && await deps.probe(instance.url)) return instance.url;
      if (starting) return starting;
      starting = (async () => {
        try {
          deps.killPort(deps.port);
          instance = undefined;
          return await spawnAndWait();
        } finally { starting = undefined; }
      })();
      return starting;
    },
    async restart(): Promise<string> {
      if (deps.external) throw refused();
      if (starting) return starting;
      starting = (async () => {
        try {
          deps.killPort(deps.port);
          instance?.close();
          instance = undefined;
          return await spawnAndWait();
        } finally { starting = undefined; }
      })();
      return starting;
    },
    async health(): Promise<boolean> {
      if (!instance) return false;
      return deps.probe(instance.url);
    },
    close() {
      try { instance?.close(); } catch { /* ignore */ }
      instance = undefined;
    },
  };
}
