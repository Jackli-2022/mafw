/**
 * 内置 opencode runtime —— 契约的"恒等实现"：能力全满（Tier 2），
 * 其事件/消息形状即归一化的目标形状。新 runtime 插件以本文件为参照。
 */
import { AgentRuntime, fullCapabilities } from './contract';
import { createOpencodeAdapter } from '../opencode-adapter';

export interface OpencodeRuntimeConfig {
  baseUrl: string;
  directory?: string;
  headers?: Record<string, string>;
}

export async function createOpencodeRuntime(config: OpencodeRuntimeConfig): Promise<AgentRuntime> {
  const client = await createOpencodeAdapter(config);
  return Object.assign(client, {
    name: 'opencode' as const,
    capabilities: fullCapabilities(),
    /** MAFW_SERVER_SERVE_URL 指向外部 serve 时 gateway 不监管进程（信息性，一期不接线）。 */
    external: !!process.env.MAFW_SERVER_SERVE_URL,
    async healthCheck(): Promise<boolean> {
      try {
        const res = await fetch(`${config.baseUrl}/global/health`, {
          headers: config.headers,
          signal: AbortSignal.timeout(3000),
        } as any);
        return res.ok;
      } catch {
        return false;
      }
    },
  });
}
