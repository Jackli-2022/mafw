/**
 * Plugin tool contributions (kernel-v2 Phase 3).
 *
 * A package contributes tools with a local name; the registry namespaces them
 * as `plugin:<package>:<tool>` and adapts them to the existing
 * `MafwToolRegistration` shape used by `RuntimeTools.registerTools`.
 *
 * Failure isolation is the contract: unknown, unhealthy, throwing and
 * timed-out tools return `isError: true` and never throw into the runtime.
 */

import type { MafwToolRegistration } from '../runtime/contract';

export interface ToolExecutionContext {
  sessionID: string;
  signal?: AbortSignal;
}

export interface ToolContribution {
  packageName: string;
  name: string;
  title?: string;
  description: string;
  parameters: Record<string, any>;
  outputSchema?: Record<string, any>;
  timeoutMs?: number;
  scope?: 'global' | 'session';
  /** Required when scope === 'session'. */
  sessionID?: string;
  execute(
    input: unknown,
    ctx: ToolExecutionContext,
  ): Promise<{ text: string; isError?: boolean }>;
  health?: () => 'healthy' | 'degraded' | 'failed';
  dispose?(): void | Promise<void>;
}

export interface ToolDiagnostic {
  name: string;
  packageName: string;
  scope: 'global' | 'session';
  state: 'healthy' | 'degraded' | 'failed';
}

export interface ToolContributionRegistry {
  register(contribution: ToolContribution): () => void;
  list(sessionID?: string): ToolContribution[];
  resolve(name: string, sessionID?: string): ToolContribution | undefined;
  factory(): (sessionID: string) => MafwToolRegistration[];
  invoke(
    name: string,
    input: unknown,
    ctx: ToolExecutionContext,
  ): Promise<{ text: string; isError?: boolean }>;
  diagnostics(): ToolDiagnostic[];
  dispose(): Promise<void>;
}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

interface Entry {
  contribution: ToolContribution;
  version: number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function healthOf(contribution: ToolContribution): ToolDiagnostic['state'] {
  try {
    return contribution.health?.() ?? 'healthy';
  } catch {
    return 'failed';
  }
}

function fullNameOf(contribution: ToolContribution): string {
  return `plugin:${contribution.packageName}:${contribution.name}`;
}

export function createToolContributionRegistry(options: {
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
} = {}): ToolContributionRegistry {
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 60_000;
  const maxTimeoutMs = options.maxTimeoutMs ?? 120_000;
  const entries = new Map<string, Entry>();
  let nextVersion = 0;
  let disposed = false;

  function assertOpen(): void {
    if (disposed) throw new Error('tool registry is disposed');
  }

  function validate(contribution: ToolContribution): void {
    if (!NAME_PATTERN.test(contribution.packageName)) {
      throw new Error(`invalid package name: ${contribution.packageName}`);
    }
    if (!NAME_PATTERN.test(contribution.name)) {
      throw new Error(`invalid tool name: ${contribution.name}`);
    }
    if (typeof contribution.execute !== 'function') {
      throw new Error(`tool ${contribution.name} has no execute()`);
    }
    if (!contribution.description) {
      throw new Error(`tool ${contribution.name} has no description`);
    }
    if (contribution.scope === 'session' && !contribution.sessionID) {
      throw new Error(`session-scoped tool ${contribution.name} requires sessionID`);
    }
    if (contribution.timeoutMs !== undefined) {
      if (
        !Number.isInteger(contribution.timeoutMs) ||
        contribution.timeoutMs <= 0 ||
        contribution.timeoutMs > maxTimeoutMs
      ) {
        throw new Error(
          `tool ${contribution.name} timeoutMs must be between 1 and ${maxTimeoutMs}`,
        );
      }
    }
  }

  function visible(contribution: ToolContribution, sessionID?: string): boolean {
    if (contribution.scope !== 'session') return true;
    return contribution.sessionID === sessionID;
  }

  function resolveEntry(name: string, sessionID?: string): Entry | undefined {
    const entry = entries.get(name);
    if (!entry) return undefined;
    return visible(entry.contribution, sessionID) ? entry : undefined;
  }

  function toRegistration(
    contribution: ToolContribution,
    sessionID: string,
  ): MafwToolRegistration {
    const name = fullNameOf(contribution);
    return {
      name,
      ...(contribution.title ? { label: contribution.title } : {}),
      description: contribution.description,
      parameters: contribution.parameters,
      ...(contribution.outputSchema ? { outputSchema: contribution.outputSchema } : {}),
      execute: (params, signal) => invoke(name, params, { sessionID, signal }),
    };
  }

  async function invoke(
    name: string,
    input: unknown,
    ctx: ToolExecutionContext,
  ): Promise<{ text: string; isError?: boolean }> {
    if (disposed) return { text: 'tool registry is disposed', isError: true };
    const entry = resolveEntry(name, ctx.sessionID);
    if (!entry) return { text: `unknown tool: ${name}`, isError: true };

    const contribution = entry.contribution;
    if (healthOf(contribution) === 'failed') {
      return { text: `tool unavailable: ${name}`, isError: true };
    }
    if (ctx.signal?.aborted) {
      return { text: `tool aborted: ${name}`, isError: true };
    }

    const timeoutMs = Math.min(contribution.timeoutMs ?? defaultTimeoutMs, maxTimeoutMs);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    ctx.signal?.addEventListener('abort', onAbort, { once: true });

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`tool timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });
      const result = await Promise.race([
        contribution.execute(input, {
          sessionID: ctx.sessionID,
          signal: controller.signal,
        }),
        timeout,
      ]);
      return {
        text: typeof result?.text === 'string' ? result.text : '',
        ...(result?.isError ? { isError: true } : {}),
      };
    } catch (error) {
      return { text: `tool failed: ${messageOf(error)}`, isError: true };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      ctx.signal?.removeEventListener('abort', onAbort);
    }
  }

  return {
    register(contribution: ToolContribution): () => void {
      assertOpen();
      validate(contribution);
      const name = fullNameOf(contribution);
      const version = ++nextVersion;
      entries.set(name, { contribution, version });
      return () => {
        if (entries.get(name)?.version === version) entries.delete(name);
      };
    },

    list(sessionID?: string): ToolContribution[] {
      if (disposed) return [];
      return [...entries.values()]
        .map((entry) => entry.contribution)
        .filter((contribution) => visible(contribution, sessionID));
    },

    resolve(name: string, sessionID?: string): ToolContribution | undefined {
      return resolveEntry(name, sessionID)?.contribution;
    },

    factory() {
      return (sessionID: string) =>
        [...entries.values()]
          .map((entry) => entry.contribution)
          .filter((contribution) => visible(contribution, sessionID))
          .map((contribution) => toRegistration(contribution, sessionID));
    },

    invoke,

    diagnostics(): ToolDiagnostic[] {
      if (disposed) return [];
      return [...entries.entries()].map(([name, entry]) => ({
        name,
        packageName: entry.contribution.packageName,
        scope: entry.contribution.scope ?? 'global',
        state: healthOf(entry.contribution),
      }));
    },

    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      const all = [...entries.values()].reverse();
      entries.clear();
      for (const entry of all) {
        try {
          await entry.contribution.dispose?.();
        } catch {
          /* tool teardown is fail-open */
        }
      }
    },
  };
}
