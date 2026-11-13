// Automation <-> unified plugin action bridge.
//
// Automation rules reference package actions as `plugin:<package>:<action>`.
// The engine keeps local handlers first; this adapter only resolves namespaced
// actions that the committed PluginActionRegistry actually has.
import type { ExternalActionResolver } from '../automation-engine';

const PLUGIN_ACTION_PATTERN =
  /^plugin:([A-Za-z0-9][A-Za-z0-9._-]*):([A-Za-z0-9][A-Za-z0-9._-]*)$/;

export interface PluginAutomationActionDeps {
  has: (packageName: string, action: string) => boolean;
  invoke: (packageName: string, action: string, input: unknown) => Promise<unknown>;
}

export function pluginAutomationActionType(packageName: string, action: string): string {
  return `plugin:${packageName}:${action}`;
}

export function createPluginAutomationActionResolver(
  deps: PluginAutomationActionDeps,
): ExternalActionResolver {
  return (type) => {
    const match = PLUGIN_ACTION_PATTERN.exec(type);
    if (!match) return undefined;
    const packageName = match[1]!;
    const action = match[2]!;
    if (!deps.has(packageName, action)) return undefined;
    return {
      handler: async (rule, _engine, source) => {
        const input: Record<string, unknown> = {
          ...(rule.args ?? {}),
          ruleId: rule.id,
        };
        if (source) input.source = source;
        await deps.invoke(packageName, action, input);
      },
    };
  };
}
