import type { log } from '../core/utils/logger';
import type { PromptFn } from '../media/media-service';
import type { AgentRuntime, RuntimeCapabilities, RuntimeCredentials } from '../runtime/contract';
import type { UsageStatsProvider } from '../usage/plugin-context';

/** 统一插件包上下文 —— 三个 legacy ctx（usage/media/runtime）的超集。 */
export interface PluginPackageContext {
  log: typeof log;
  /** fetch，默认 60s 超时 */
  fetch: (url: string, opts?: RequestInit) => Promise<Response>;
  /** 读 opencode auth.json 的 provider key（经 runtime credentials 链） */
  apiKey: (provider: string) => string | null;
  /** plugins.<name>.config；缺省回退 legacy 三段 pluginConfig（usage→media→runtime），全缺省 {} */
  pluginConfig: () => Record<string, any>;
  credentials?: RuntimeCredentials;
  projectDir: string;
  gatewayPort: number;
  usage: UsageStatsProvider;
}

export interface MediaContributionSpec {
  /** 缺省 = 包名 */
  name?: string;
  modalities: string[];
  createPrompt?: (ctx: PluginPackageContext) => Promise<PromptFn>;
  engine?: 'pi';
  fixPayload?: (payload: any) => any;
}

export interface RuntimeContributionSpec {
  /** 缺省 = 包名 */
  name?: string;
  capabilities?: Partial<RuntimeCapabilities>;
  external?: boolean;
  createRuntime: (ctx: PluginPackageContext) => Promise<AgentRuntime>;
}

export interface PluginContributions {
  /** legacy usage 插件模块形状：{ name, type?, plan?, fetch(ctx), configSchema? } */
  usage?: Record<string, any>;
  media?: MediaContributionSpec;
  runtime?: RuntimeContributionSpec;
  /** v1 仅登记展示，不激活（desktop 进程侧加载不变） */
  uiTools?: Record<string, unknown>;
}

export interface RuntimePackageEntry {
  name: string;
  createRuntime: (ctx: any) => Promise<AgentRuntime>;
  capabilities: Partial<RuntimeCapabilities>;
  external: boolean;
  source: string;
}

export interface UsagePackageEntry {
  mod: Record<string, any>;
  source: string;
}

export interface MediaPackageEntry {
  name: string;
  prompt: PromptFn;
  modalities: string[];
  source: string;
}

export interface PackageManifest {
  name: string;
  version?: string;
  main?: string;
}

export interface PackageDescriptor {
  name: string;
  mainFile: string;
  manifest?: PackageManifest;
  /** 目录包时的子目录绝对路径（watcher 用） */
  pkgDir?: string;
}

export interface PackageState {
  name: string;
  source: string;
  status: 'ok' | 'error';
  error?: string;
  contributions: string[];
  version?: string;
}
