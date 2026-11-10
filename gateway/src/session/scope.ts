// gateway/src/session/scope.ts
// Scope of a session record: who owns this session and under which boundaries.
// One record per sessionID; the scope is the ownership answer.

export interface SessionScope {
  kind: 'project' | 'goal' | 'probe' | 'worker' | 'lead' | 'internal';
  projectId?: string;
  goalId?: string;
  revision?: number;
  podId?: string;
  memberId?: string;
  role?: string;
}
