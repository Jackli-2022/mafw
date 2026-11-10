// gateway/src/session/views/internal-roles.ts
// internalSessionRoles as a registry view: role is a metadata overlay. When
// the view creates the record itself it owns it (scope kind 'internal' —
// delete unregisters); when another view owns the record (pool worker, lead,
// pod mirror), set/delete only patch metadata.role and the owner keeps the
// lifetime. Drop-in for the previous `Map<string, string>` surface.

import { SessionRegistry } from '../registry';

export class InternalRolesView {
  constructor(private readonly registry: SessionRegistry) {}

  get(sessionID: string): string | undefined {
    const role = this.registry.lookup(sessionID)?.metadata.role;
    return typeof role === 'string' ? role : undefined;
  }

  has(sessionID: string): boolean {
    return this.get(sessionID) !== undefined;
  }

  set(sessionID: string, role: string): void {
    if (!sessionID || !role) return;
    const existing = this.registry.lookup(sessionID);
    if (existing && existing.status === 'active') {
      // Foreign- or self-owned live record: patch the role in place.
      this.registry.updateMetadata(sessionID, { role });
      return;
    }
    // Absent — or lazily expired and not yet swept: re-register. Patching an
    // ended record would be silently dropped at the next sweep.
    this.registry.register({
      sessionID,
      scope: { kind: 'internal', role },
      metadata: { role },
    });
  }

  delete(sessionID: string): boolean {
    const existing = this.registry.lookup(sessionID);
    if (!existing) return false;
    const hadRole = existing.metadata.role !== undefined;
    if (!hadRole) return false; // Map.delete semantics: nothing to remove
    if (existing.scope.kind === 'internal') {
      // The view owns the record — remove it entirely.
      return this.registry.unregister(sessionID);
    }
    // Foreign-owned: clear only the role overlay; the owner's record survives.
    this.registry.updateMetadata(sessionID, { role: undefined });
    return true;
  }
}
