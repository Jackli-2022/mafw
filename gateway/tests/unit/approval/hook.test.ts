import { applyApprovalPolicy } from '../../../src/core/approval/hook';
import { ApprovalPolicyService, ApprovalPolicyDeps } from '../../../src/core/approval/policy-service';
import { ApprovalFacet } from '../../../src/runtime/normalize';
import { AgentRuntime } from '../../../src/runtime/contract';

function makePolicy(overrides: Partial<ApprovalPolicyDeps> = {}): ApprovalPolicyService {
  return new ApprovalPolicyService({
    getInternalRole: () => undefined,
    allowlistMatches: () => false,
    loadMode: async () => 'auto',
    saveMode: async () => {},
    onModeChanged: () => {},
    ...overrides,
  });
}

function makeRuntime() {
  const replies: Array<[string, string, string]> = [];
  const rt = {
    session: {
      permissionReply: async (sid: string, rid: string, reply: string) => {
        replies.push([sid, rid, reply]);
        return true;
      },
    },
  } as unknown as AgentRuntime;
  return { rt, replies };
}

const FACET: ApprovalFacet = { requestId: 'req-1', toolName: 'bash', patterns: [], metadata: { args: { command: 'npm test' } } };

describe('applyApprovalPolicy', () => {
  it('auto+safe → mafwPolicy 附加 + permissionReply("once") fire-and-forget', async () => {
    const policy = makePolicy();
    await policy.getMode('s1'); // 懒加载完成（evaluate 同步路径按已加载 mode 判定）
    const { rt, replies } = makeRuntime();
    const props: any = {};
    applyApprovalPolicy(policy, rt, FACET, 's1', props);
    expect(props.mafwPolicy.action).toBe('auto-approve');
    await new Promise((r) => setTimeout(r, 10));
    expect(replies).toContainEqual(['s1', 'req-1', 'once']);
  });

  it('internal session → mafwPolicy.auto-deny + permissionReply("reject")', async () => {
    const policy = makePolicy({ getInternalRole: () => 'btw' });
    const { rt, replies } = makeRuntime();
    const props: any = {};
    applyApprovalPolicy(policy, rt, FACET, 's1', props);
    expect(props.mafwPolicy.action).toBe('auto-deny');
    await new Promise((r) => setTimeout(r, 10));
    expect(replies).toContainEqual(['s1', 'req-1', 'reject']);
  });

  it('dangerous → mafwPolicy.human + 不回复（人答复）', async () => {
    const policy = makePolicy();
    const { rt, replies } = makeRuntime();
    const props: any = {};
    applyApprovalPolicy(policy, rt, { ...FACET, metadata: { args: { command: 'rm -rf /' } } }, 's1', props);
    expect(props.mafwPolicy.action).toBe('human');
    expect(props.mafwPolicy.verdict).toBe('dangerous');
    await new Promise((r) => setTimeout(r, 10));
    expect(replies.length).toBe(0);
  });

  it('permissionReply 抛错 → 不抛出（fail-open，props.mafwPolicy 保留）', async () => {
    const policy = makePolicy();
    await policy.getMode('s1');
    const rt = { session: { permissionReply: async () => { throw new Error('bridge gone'); } } } as unknown as AgentRuntime;
    const props: any = {};
    expect(() => applyApprovalPolicy(policy, rt, FACET, 's1', props)).not.toThrow();
    expect(props.mafwPolicy.action).toBe('auto-approve');
  });

  it('evaluate 抛错 → 不附加 mafwPolicy（当 human 处理）', () => {
    const policy = makePolicy({ getInternalRole: () => { throw new Error('boom'); } });
    const { rt } = makeRuntime();
    const props: any = {};
    expect(() => applyApprovalPolicy(policy, rt, FACET, 's1', props)).not.toThrow();
    expect(props.mafwPolicy).toBeUndefined();
  });

  it('runtime 无 permissionReply（能力缺失）→ 不抛出', async () => {
    const policy = makePolicy();
    await policy.getMode('s1');
    const props: any = {};
    expect(() => applyApprovalPolicy(policy, null, FACET, 's1', props)).not.toThrow();
    expect(props.mafwPolicy.action).toBe('auto-approve');
  });

  // Creator (Phase 2) asks through the host pipeline; every check/test/install/
  // remove prompt carries `metadata.forceHuman`. Auto mode would otherwise reply
  // "once" with no human in the loop.
  const CREATOR_FACET: ApprovalFacet = {
    requestId: 'req-creator',
    toolName: 'mafw_plugin_manager',
    patterns: ['install acme draft=acme'],
    metadata: { forceHuman: true },
  };

  it('forceHuman metadata in auto mode → human + no permissionReply', async () => {
    const policy = makePolicy();
    await policy.getMode('s1'); // auto (loaded)
    const { rt, replies } = makeRuntime();
    const props: any = {};
    applyApprovalPolicy(policy, rt, CREATOR_FACET, 's1', props);
    expect(props.mafwPolicy.action).toBe('human');
    await new Promise((r) => setTimeout(r, 10));
    expect(replies).toEqual([]);

    // Guard against a vacuous pass: the same facet without the flag is auto-approved.
    const plain: any = {};
    applyApprovalPolicy(policy, rt, { ...CREATOR_FACET, metadata: {} }, 's1', plain);
    expect(plain.mafwPolicy.action).toBe('auto-approve');
  });

  it('forceHuman wins over an internal-role session (no silent auto-deny)', async () => {
    const policy = makePolicy({ getInternalRole: () => 'btw' });
    const { rt, replies } = makeRuntime();
    const props: any = {};
    applyApprovalPolicy(policy, rt, CREATOR_FACET, 's1', props);
    expect(props.mafwPolicy.action).toBe('human');
    await new Promise((r) => setTimeout(r, 10));
    expect(replies).toEqual([]);
  });

  it('forceHuman on the props envelope is honored the same way', async () => {
    const policy = makePolicy();
    await policy.getMode('s1');
    const { rt, replies } = makeRuntime();
    const props: any = { forceHuman: true };
    applyApprovalPolicy(policy, rt, { ...FACET, toolName: 'mafw_plugin_manager' }, 's1', props);
    expect(props.mafwPolicy.action).toBe('human');
    await new Promise((r) => setTimeout(r, 10));
    expect(replies).toEqual([]);
  });
});
