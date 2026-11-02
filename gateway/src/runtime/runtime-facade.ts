/**
 * RuntimeFacade —— gateway 业务核心唯一可见的 runtime 面。
 *
 * RawRuntime（原生 SDK / 原生事件流 / 方言解析器）只存在于本模块闭包与 Runtime
 * Ingress 内。facade 只复制契约公开面，并把 global.event 固定为翻译后的流；
 * 任何 __mafw* wiring、resolveEventEntry 或 RawRuntime 原型都不会暴露。
 */
import type { EventMappingEntry, TranslationHooks } from './event-mapper';
import type { AgentRuntime } from './contract';
import { wrapDialectEventStream } from './event-stream-wiring';
import { normalizeFacadeHistory } from './normalize-messages';
import { RuntimeAccess } from './runtime-access';

export const RUNTIME_FACADE: unique symbol = Symbol('mafw.runtimeFacade');

export interface RuntimeFacade extends AgentRuntime {
  readonly [RUNTIME_FACADE]: true;
  readonly access: RuntimeAccess;
  rewireEvents(): Promise<string>;
}

export interface RuntimeFacadeOptions {
  entry: EventMappingEntry;
  isCanonical: (type: string) => boolean;
  hooks?: TranslationHooks & { onNoMappings?: () => void };
  onHistoryViolation?: (reason: string) => void;
}

const PUBLIC_KEYS = [
  'name', 'capabilities', 'external', 'session', 'shell', 'provider', 'app',
  'discovery', 'mcp', 'config', 'tools', 'completion', 'credentials', 'agents',
  'getBaseUrl', 'healthCheck', 'agentProcess', 'semantics', 'dispose',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** 复制公开通道；函数绑定回原 owner，结果对象没有 RawRuntime 原型链。 */
function cloneChannel(value: any, seen = new WeakMap<object, any>()): any {
  if (Array.isArray(value)) return value.map((v) => cloneChannel(v, seen));
  if (!isPlainObject(value)) return value;
  const existing = seen.get(value);
  if (existing) return existing;
  const out: Record<string, any> = {};
  seen.set(value, out);
  for (const [key, child] of Object.entries(value)) {
    out[key] = typeof child === 'function'
      ? child.bind(value)
      : cloneChannel(child, seen);
  }
  return out;
}

export async function createRuntimeFacade(
  raw: AgentRuntime,
  options: RuntimeFacadeOptions,
): Promise<RuntimeFacade> {
  const hasEventStream = typeof (raw as any)?.global?.event === 'function';
  if (hasEventStream) {
    await wrapDialectEventStream(raw, options.entry, options.isCanonical, options.hooks);
  }

  const facade: Record<PropertyKey, any> = {};
  for (const key of PUBLIC_KEYS) {
    const value = (raw as any)[key];
    if (value === undefined) continue;
    facade[key] = cloneChannel(value);
  }

  Object.defineProperty(facade, 'activeDialect', {
    enumerable: true,
    get: () => (raw as any).activeDialect,
  });
  if (hasEventStream) {
    facade.global = {
      event: async () => {
        const result = await (raw as any).global.event();
        const source = result?.stream ?? result;
        if (!source || typeof source[Symbol.asyncIterator] !== 'function') return result;
        const stream = (async function* () {
          for await (const evt of source) {
            const type = evt?.payload?.type ?? evt?.type;
            if (typeof type !== 'string' || !options.isCanonical(type)) {
              options.hooks?.onUnmatched?.(typeof type === 'string' ? type : 'malformed');
              continue;
            }
            yield evt;
          }
        })();
        return result?.stream ? { ...result, stream } : stream;
      },
    };
  }
  if (typeof facade.session?.messages === 'function') {
    const readMessages = facade.session.messages as (opts: any) => Promise<any>;
    facade.session.messages = async (opts: any) => {
      const result = await readMessages(opts);
      return {
        ...result,
        data: normalizeFacadeHistory(raw, result?.data, options.onHistoryViolation),
      };
    };
  }
  facade.access = new RuntimeAccess(raw);
  facade.rewireEvents = () => wrapDialectEventStream(raw);
  Object.defineProperty(facade, RUNTIME_FACADE, { value: true, enumerable: false });
  return facade as RuntimeFacade;
}
