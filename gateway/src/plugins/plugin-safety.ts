/**
 * Phase 6 safety policy: safe mode, quarantine, failure counting and the
 * kill switch. The policy never deletes package files and never decides
 * whether a package is trusted — it only decides whether activation is
 * currently allowed and records why.
 */
import type { PackageStateStore } from './package-state-store';
import type { PluginAuditStore } from './plugin-audit-store';

export type PluginBlockReason = 'safe-mode' | 'quarantined' | 'disabled' | null;

export interface PluginSafetyDeps {
  state: PackageStateStore;
  host: Pick<{ deactivate(name: string): Promise<boolean>; deactivateAll(): Promise<string[]> },
    'deactivate' | 'deactivateAll'>;
  audit: Pick<PluginAuditStore, 'append'>;
  /** `MAFW_SAFE_MODE=1` / `mafw start --safe-mode`: this boot only. */
  oneRunSafeMode?: boolean;
}

export interface SafetyPrincipal {
  principalKind?: string;
  principalMethod?: string;
}

const QUARANTINE_THRESHOLD = 3;

export class PluginSafety {
  constructor(private readonly deps: PluginSafetyDeps) {}

  blockedReason(name: string): PluginBlockReason {
    const { state } = this.deps;
    if (this.deps.oneRunSafeMode || state.isSafeMode()) return 'safe-mode';
    if (state.getQuarantine(name)) return 'quarantined';
    if (state.isDisabled(name)) return 'disabled';
    return null;
  }

  recordActivationFailure(
    name: string,
    version: string | undefined,
    reason: string,
  ): { quarantined: boolean } {
    const current = this.deps.state.getInstalled(name);
    const failures = (current?.consecutiveFailures ?? 0) + 1;
    this.deps.state.updateInstalled(name, {
      ...(version !== undefined ? { version } : {}),
      consecutiveFailures: failures,
      lastFailureAt: new Date().toISOString(),
    });
    this.deps.audit.append({
      action: 'activate.failed',
      package: name,
      ...(version !== undefined ? { version } : {}),
      result: 'failed',
      detail: { reason },
    });

    if (failures < QUARANTINE_THRESHOLD) return { quarantined: false };
    this.quarantine(
      name,
      `${QUARANTINE_THRESHOLD} consecutive activation failures: ${reason}`,
      { principalKind: 'system' },
    );
    return { quarantined: true };
  }

  recordActivationSuccess(name: string): void {
    this.deps.state.updateInstalled(name, {
      consecutiveFailures: 0,
      degraded: undefined,
    });
  }

  markDegraded(name: string, reason: string, version?: string): void {
    this.deps.state.updateInstalled(name, {
      degraded: {
        reason,
        at: new Date().toISOString(),
        ...(version !== undefined ? { version } : {}),
      },
    });
  }

  async kill(principal: SafetyPrincipal = {}): Promise<{ safeMode: true; stopped: string[] }> {
    this.deps.state.setSafeMode(true);
    const stopped = await this.deps.host.deactivateAll();
    this.deps.audit.append({
      action: 'safe-mode.on',
      result: 'ok',
      ...(principal.principalKind !== undefined
        ? { principalKind: principal.principalKind }
        : {}),
      ...(principal.principalMethod !== undefined
        ? { principalMethod: principal.principalMethod }
        : {}),
      detail: { reason: `stopped ${stopped.length} package(s)` },
    });
    return { safeMode: true, stopped };
  }

  /**
   * Clears safe mode. The caller reloads the host afterwards; disabled and
   * quarantined packages stay off because their blockers are independent.
   */
  async resume(principal: SafetyPrincipal = {}): Promise<{ safeMode: false; activated: string[] }> {
    this.deps.state.setSafeMode(false);
    this.deps.audit.append({
      action: 'safe-mode.off',
      result: 'ok',
      ...(principal.principalKind !== undefined
        ? { principalKind: principal.principalKind }
        : {}),
      ...(principal.principalMethod !== undefined
        ? { principalMethod: principal.principalMethod }
        : {}),
      detail: { reason: 'safe mode cleared' },
    });
    return { safeMode: false, activated: [] };
  }

  quarantine(name: string, reason: string, principal: SafetyPrincipal = {}): void {
    this.deps.state.setQuarantine({
      name,
      reason,
      at: new Date().toISOString(),
    });
    this.deps.audit.append({
      action: 'quarantine',
      package: name,
      result: 'ok',
      ...(principal.principalKind !== undefined
        ? { principalKind: principal.principalKind }
        : {}),
      detail: { reason },
    });
  }

  unquarantine(name: string, principal: SafetyPrincipal = {}): void {
    this.deps.state.clearQuarantine(name);
    this.deps.audit.append({
      action: 'unquarantine',
      package: name,
      result: 'ok',
      ...(principal.principalKind !== undefined
        ? { principalKind: principal.principalKind }
        : {}),
      detail: { reason: 'cleared by human request' },
    });
  }
}
