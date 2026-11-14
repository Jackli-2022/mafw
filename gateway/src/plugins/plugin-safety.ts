/**
 * Phase 6 safety policy: safe mode, quarantine, failure counting and the
 * kill switch. The policy never deletes package files and never decides
 * whether a package is trusted — it only decides whether activation is
 * currently allowed and records why.
 */
import type { PackageStateStore } from './package-state-store';
import type { PluginAuditStore } from './plugin-audit-store';
import type { PackageLastGoodStore } from './package-last-good';

export type PluginBlockReason = 'safe-mode' | 'quarantined' | 'disabled' | null;

export interface PluginSafetyDeps {
  state: PackageStateStore;
  host: Pick<{ deactivate(name: string): Promise<boolean>; deactivateAll(): Promise<string[]> },
    'deactivate' | 'deactivateAll'>;
  audit: Pick<PluginAuditStore, 'append'>;
  /** `MAFW_SAFE_MODE=1` / `mafw start --safe-mode`: this boot only. */
  oneRunSafeMode?: boolean;
  /** Phase 6C rollback snapshots. */
  lastGood?: Pick<PackageLastGoodStore, 'snapshot' | 'restore'>;
  /** Health window before a new version is promoted. Default 5 minutes. */
  healthWindowMs?: number;
  /** Tests set false to reconcile manually. Default true. */
  autoConfirm?: boolean;
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

  /** Marks a newly committed version as awaiting its health window. */
  beginHealthCheck(name: string, meta: { version?: string; fingerprint: string }): void {
    this.deps.state.updateInstalled(name, {
      pendingHealthCheck: {
        ...(meta.version !== undefined ? { version: meta.version } : {}),
        fingerprint: meta.fingerprint,
        startedAt: new Date().toISOString(),
      },
    });
    if (this.deps.autoConfirm === false) return;
    const timer = setTimeout(() => this.confirmHealthCheck(name), this.deps.healthWindowMs ?? 5 * 60 * 1000);
    timer.unref?.();
  }

  /** Promotes the current version to last-known-good after a healthy window. */
  confirmHealthCheck(name: string): void {
    const installed = this.deps.state.getInstalled(name);
    const pending = installed?.pendingHealthCheck;
    if (!installed || !pending) return;
    if (installed.fingerprint !== pending.fingerprint) return;
    this.deps.lastGood?.snapshot(name, {
      ...(pending.version !== undefined ? { version: pending.version } : {}),
      fingerprint: pending.fingerprint,
    });
    this.deps.state.updateInstalled(name, {
      pendingHealthCheck: undefined,
      lastKnownGood: {
        ...(pending.version !== undefined ? { version: pending.version } : {}),
        fingerprint: pending.fingerprint,
        savedAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Boot-time reconcile: a pending health check means the previous process
   * died before confirming. Restore last-known-good before activation.
   */
  async reconcilePendingHealthChecks(): Promise<{ rolledBack: string[]; quarantined: string[] }> {
    const rolledBack: string[] = [];
    const quarantined: string[] = [];
    for (const [name, installed] of Object.entries(this.deps.state.read().installed)) {
      const pending = installed.pendingHealthCheck;
      if (!pending) continue;
      const restored = this.deps.lastGood?.restore(name) ?? false;
      if (!restored) {
        this.quarantine(name, 'health window was not confirmed and no last-known-good is available');
        quarantined.push(name);
        continue;
      }
      this.deps.state.updateInstalled(name, {
        pendingHealthCheck: undefined,
        degraded: {
          reason: 'unconfirmed health window; restored last-known-good on boot',
          at: new Date().toISOString(),
          ...(pending.version !== undefined ? { version: pending.version } : {}),
        },
      });
      this.auditRollback(name, pending.version);
      rolledBack.push(name);
    }
    return { rolledBack, quarantined };
  }

  private auditRollback(name: string, version?: string): void {
    this.deps.audit.append({
      action: 'rollback',
      package: name,
      ...(version !== undefined ? { version } : {}),
      result: 'ok',
      detail: { reason: 'restored last-known-good on boot' },
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
