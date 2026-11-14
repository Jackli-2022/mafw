/**
 * Phase 6 plugin trust audit.
 *
 * Every install / enable / disable / remove / reload / activation failure /
 * quarantine / kill-switch action goes through this store. Detail is filtered
 * to an allowlist so a token, environment value or absolute user path can
 * never leak into the audit table.
 */
import { randomUUID } from 'crypto';
import type { GatewayDatabase, PluginAuditRow } from '../memory/gateway-db';

export type PluginAuditAction =
  | 'install'
  | 'install.rejected'
  | 'enable'
  | 'disable'
  | 'remove'
  | 'reload'
  | 'apply'
  | 'activate.failed'
  | 'quarantine'
  | 'unquarantine'
  | 'safe-mode.on'
  | 'safe-mode.off'
  | 'rollback'
  | 'doctor';

export interface PluginAuditInput {
  action: PluginAuditAction;
  package?: string;
  version?: string;
  fingerprint?: string;
  principalKind?: string;
  principalMethod?: string;
  sessionId?: string;
  result: 'ok' | 'failed' | 'denied';
  detail?: Record<string, unknown>;
}

export interface PluginAuditEvent extends PluginAuditInput {
  id: string;
  at: string;
}

const DETAIL_ALLOWLIST = new Set([
  'reason',
  'permissions',
  'consent',
  'apiVersion',
  'kind',
  'host',
  'previousVersion',
  'restoredVersion',
  'doctorSummary',
]);

function filterDetail(detail: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!detail) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (DETAIL_ALLOWLIST.has(key) && value !== undefined) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export class PluginAuditStore {
  constructor(
    private readonly db: Pick<GatewayDatabase, 'appendPluginAudit' | 'listPluginAudit'>,
  ) {}

  /** Best-effort: a failed audit write returns false, never blocks the action. */
  append(input: PluginAuditInput): boolean {
    const event: PluginAuditEvent = {
      ...input,
      id: `pa_${randomUUID()}`,
      at: new Date().toISOString(),
      detail: filterDetail(input.detail),
    };
    return this.db.appendPluginAudit(event as PluginAuditRow);
  }

  list(query: { package?: string; limit?: number } = {}): PluginAuditEvent[] {
    const limit = Math.max(1, Math.min(500, Math.floor(query.limit ?? 100) || 100));
    return this.db.listPluginAudit({ package: query.package, limit }) as PluginAuditEvent[];
  }
}
