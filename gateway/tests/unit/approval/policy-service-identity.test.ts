import { ApprovalPolicyService, PolicyDecision } from '../../../src/core/approval/policy-service';
import { createBuiltinIdentityRegistry } from '../../../src/runtime/identity-registry';

const registry = createBuiltinIdentityRegistry();

function makePolicy(
  opts: { identity?: { name: string; internal: boolean }; internalRole?: string } = {},
) {
  return new ApprovalPolicyService({
    getInternalRole: (sid) => (sid === 'sess-1' ? opts.internalRole : undefined),
    getIdentity: (sid) => (sid === 'sess-1' ? opts.identity : undefined),
    getPolicy: (name) => registry.get(name)?.policy,
    runtimeName: () => 'opencode',
    allowlistMatches: () => false,
    loadMode: async () => 'read-only',
    saveMode: async () => {},
    onModeChanged: () => {},
  });
}

const cand = (toolName: string) => ({ toolName, patterns: [], metadata: {} });

describe('identity evaluation order (spec 3.3)', () => {
  it('internal manager session: whitelisted tool auto-approves (unattended), not blanket-denied', () => {
    const svc = makePolicy({ identity: { name: 'manager', internal: true }, internalRole: 'manager' });
    expect(svc.evaluate('sess-1', cand('mafw_set_goal')).action).toBe('auto-approve');
    expect(svc.evaluate('sess-1', cand('bash')).action).toBe('auto-approve');
  });

  it('internal manager session: file-edit denied with identity-prefixed reason', () => {
    const svc = makePolicy({ identity: { name: 'manager', internal: true }, internalRole: 'manager' });
    const d: PolicyDecision = svc.evaluate('sess-1', cand('edit'));
    expect(d.action).toBe('auto-deny');
    expect(d.reason).toContain('identity policy (manager)');
  });

  it('internal manager session: unlisted tool denied (webfetch)', () => {
    const svc = makePolicy({ identity: { name: 'manager', internal: true }, internalRole: 'manager' });
    expect(svc.evaluate('sess-1', cand('webfetch')).action).toBe('auto-deny');
  });

  it('user-driven identity pick: whitelisted tool falls through to mode (read-only keeps bash human)', () => {
    const svc = makePolicy({ identity: { name: 'manager', internal: false } });
    expect(svc.evaluate('sess-1', cand('bash')).action).toBe('human');
    expect(svc.evaluate('sess-1', cand('edit')).action).toBe('auto-deny');
  });

  it('internal session WITHOUT identity binding still blanket-denied (unchanged)', () => {
    const svc = makePolicy({ internalRole: 'manager' });
    expect(svc.evaluate('sess-1', cand('mafw_set_goal')).action).toBe('auto-deny');
  });

  it('unbound session: existing three-tier flow unchanged', () => {
    const svc = makePolicy({});
    expect(svc.evaluate('sess-2', cand('read')).action).toBe('auto-approve');
  });
});
