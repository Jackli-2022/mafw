/**
 * Automation action provider capability (kernel-v2 Phase 2).
 *
 * Action handlers are replaceable; rule validation, cron scheduling and the
 * Goal/Pod state machine stay in the core AutomationEngine. `run()` isolates
 * missing/unhealthy/throwing actions and never throws into the scheduler.
 */

import type {
  CapabilityHealth,
  CapabilityRegistry,
  CapabilityScope,
  CapabilityTier,
} from '../capability-registry';

export interface AutomationActionInput {
  ruleId: string;
  source?: 'cron' | 'event' | 'user';
  [key: string]: unknown;
}

export interface AutomationActionProvider {
  id: string;
  handler(input: AutomationActionInput): Promise<unknown>;
  health?: () => CapabilityHealth;
  dispose?(): void | Promise<void>;
}

export type AutomationRunResult =
  | { ok: true; value: unknown }
  | { ok: false; error: 'missing' | 'failed'; message: string };

export interface AutomationCapability {
  resolve(type: string, scope?: CapabilityScope): AutomationActionProvider;
  actions(scope?: CapabilityScope): Array<{ id: string; tier: CapabilityTier }>;
  run(
    type: string,
    input: AutomationActionInput,
    scope?: CapabilityScope,
  ): Promise<AutomationRunResult>;
}

function healthOf(action: AutomationActionProvider): CapabilityHealth {
  try {
    return action.health?.() ?? 'healthy';
  } catch {
    return 'failed';
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createAutomationCapability(
  registry: CapabilityRegistry<AutomationActionProvider>,
): AutomationCapability {
  function find(type: string, scope?: CapabilityScope): AutomationActionProvider | undefined {
    return registry.list(scope).find((item) => item.id === type)?.value;
  }

  return {
    resolve(type: string, scope?: CapabilityScope): AutomationActionProvider {
      const action = find(type, scope);
      if (!action) throw new Error(`unknown automation action: ${type}`);
      return action;
    },

    actions(scope?: CapabilityScope) {
      return registry.list(scope).map(({ id, tier }) => ({ id, tier }));
    },

    async run(
      type: string,
      input: AutomationActionInput,
      scope?: CapabilityScope,
    ): Promise<AutomationRunResult> {
      const action = find(type, scope);
      if (!action) {
        return {
          ok: false,
          error: 'missing',
          message: `unknown automation action: ${type}`,
        };
      }
      if (healthOf(action) === 'failed') {
        return {
          ok: false,
          error: 'failed',
          message: `automation action is unhealthy: ${type}`,
        };
      }
      try {
        return { ok: true, value: await action.handler(input) };
      } catch (error) {
        return { ok: false, error: 'failed', message: messageOf(error) };
      }
    },
  };
}

export function registerAutomationAction(
  registry: CapabilityRegistry<AutomationActionProvider>,
  action: AutomationActionProvider,
  tier: CapabilityTier = 'builtin',
  scope?: CapabilityScope,
): void {
  registry.register(
    tier,
    {
      id: action.id,
      value: action,
      ...(action.health ? { health: action.health } : {}),
      ...(action.dispose ? { dispose: () => action.dispose!() } : {}),
    },
    scope,
  );
}
