/**
 * Host surface for the native opencode definition (Phase 4 W2).
 *
 * The gateway composition root reads config/credentials/completion/health/base
 * URL/process primitives/proxy headers/provider transport through this seam
 * only. No gateway import, no bridge.
 */
import type { RuntimeHostSurface } from '@mafw/runtime-contract';
import type { OpencodeRuntime } from './types';

export function createOpencodeHost(runtime: OpencodeRuntime): RuntimeHostSurface {
  const host: RuntimeHostSurface = {};
  if (runtime.config) host.config = runtime.config;
  if (runtime.credentials) host.credentials = runtime.credentials;
  if (runtime.completion) host.completion = runtime.completion;
  if (typeof runtime.healthCheck === 'function') host.healthCheck = () => runtime.healthCheck!();
  if (typeof runtime.getBaseUrl === 'function') host.getBaseUrl = () => runtime.getBaseUrl!();
  if (runtime.agentProcess) host.agentProcess = runtime.agentProcess;
  if (typeof runtime.proxyHeaders === 'function') host.proxyHeaders = () => runtime.proxyHeaders!();
  if (typeof runtime.resolveProviderTransport === 'function') {
    host.resolveProviderTransport = (providerID) => runtime.resolveProviderTransport!(providerID);
  }
  return host;
}
