import { PodError, PodStore, type PodMemberRole, type PodMemberRow } from './pod-store';

export class PodAccess {
  constructor(private readonly store: PodStore) {}

  requireMember(sessionId: string, allowed: PodMemberRole[]): PodMemberRow {
    const member = this.store.getMemberBySession(sessionId);
    if (!member) throw new PodError(403, `session is not a pod member: ${sessionId}`);
    if (!allowed.includes(member.role)) {
      throw new PodError(403, `role ${member.role} is not allowed for this action`);
    }
    return member;
  }
}
