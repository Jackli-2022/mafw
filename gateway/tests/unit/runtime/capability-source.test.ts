import { minimalCapabilities, type RuntimeCapabilities } from '../../../src/runtime/contract';
import {
  deriveUndeclaredCapabilities,
  resolveDeclaredCapabilities,
  stampDeclaredCapabilities,
} from '../../../src/runtime/capability-source';
import type { ContractSubject } from '../../../src/runtime/coverage';

function subjectFor(rt: any): ContractSubject {
  return { rt, source: 'file' };
}

describe('resolveDeclaredCapabilities', () => {
  test('merges module declarations over the Tier-0 baseline', () => {
    const caps = resolveDeclaredCapabilities({ eventStream: true });
    expect(caps.sessionApi).toBe(true);
    expect(caps.eventStream).toBe(true);
    expect(caps.nativeApprovals).toBe(false);
  });

  test('undefined module capabilities = baseline only', () => {
    expect(resolveDeclaredCapabilities(undefined)).toEqual(minimalCapabilities());
  });
});

describe('stampDeclaredCapabilities', () => {
  test('overwrites instance declaration and reports differing keys', () => {
    const rt: any = { capabilities: { sessionApi: true, eventStream: false } };
    const declared = { ...minimalCapabilities(), eventStream: true };
    const msg = stampDeclaredCapabilities(rt, declared);
    expect(rt.capabilities.eventStream).toBe(true);
    expect(rt.capabilities).toEqual(declared);
    expect(msg).toContain('eventStream');
  });

  test('instance without capabilities is stamped silently', () => {
    const rt: any = {};
    const msg = stampDeclaredCapabilities(rt, minimalCapabilities());
    expect(msg).toBeNull();
    expect(rt.capabilities.sessionApi).toBe(true);
  });

  test('stamp stays writable for activation-time downgrades', () => {
    const rt: any = {};
    stampDeclaredCapabilities(rt, { ...minimalCapabilities(), eventStream: true } as RuntimeCapabilities);
    rt.capabilities.eventStream = false; // activation downgrade path must keep working
    expect(rt.capabilities.eventStream).toBe(false);
  });
});

describe('deriveUndeclaredCapabilities', () => {
  test('enables a capability whose single presence surface is implemented', () => {
    const rt: any = {
      name: 'x',
      capabilities: minimalCapabilities(),
      completion: { complete: async () => ({ text: '' }) },
    };
    const out = deriveUndeclaredCapabilities(subjectFor(rt), rt.capabilities);
    expect(out.caps.completionApi).toBe(true);
    expect(out.warnings.join(' ')).toContain('completionApi');
    expect(out.warnings.join(' ')).toContain('process.completion');
  });

  test('does not enable when only part of the gated surfaces exist', () => {
    const rt: any = { name: 'x', capabilities: minimalCapabilities(), mcp: { list: async () => [] } };
    const out = deriveUndeclaredCapabilities(subjectFor(rt), rt.capabilities);
    expect(out.caps.mcpApi).toBeFalsy();
    expect(out.warnings).toHaveLength(0);
  });

  test('already-declared capabilities are left alone (no warning)', () => {
    const rt: any = {
      name: 'x',
      capabilities: { ...minimalCapabilities(), completionApi: true },
      completion: { complete: async () => ({ text: '' }) },
    };
    const out = deriveUndeclaredCapabilities(subjectFor(rt), rt.capabilities);
    expect(out.caps.completionApi).toBe(true);
    expect(out.warnings).toHaveLength(0);
  });

  test('declarations alone never auto-enable eventStream (no implementation evidence)', () => {
    const rt: any = {
      name: 'x',
      capabilities: minimalCapabilities(),
      global: { event: async () => ({ stream: (async function* () {})() }) },
    };
    const subject: any = {
      rt,
      source: 'file',
      declaration: {
        eventSource: { typePath: '$.type' },
        eventMappings: [{ from: 'x', to: 'turn.completed' }],
        transformEvent: () => null,
      },
    };
    const out = deriveUndeclaredCapabilities(subject, rt.capabilities);
    expect(out.caps.eventStream).toBe(false);
  });

  test('requires-based derivation enables sessionApi when all session methods exist', () => {
    const session: any = {};
    for (const m of ['create', 'promptAsync', 'prompt', 'messages', 'get', 'delete', 'abort', 'list', 'todo', 'children', 'summarize']) {
      session[m] = async () => ({});
    }
    const rt: any = { name: 'x', capabilities: { ...minimalCapabilities(), sessionApi: false }, session };
    const out = deriveUndeclaredCapabilities(subjectFor(rt), rt.capabilities);
    expect(out.caps.sessionApi).toBe(true);
  });

  test('explicit false is never auto-enabled (revertUndoApi compat case)', () => {
    const rt: any = {
      name: 'x',
      capabilities: { ...minimalCapabilities(), revertUndoApi: false },
      session: { unrevert: async () => {} },
    };
    // 没有显式键保护时会打开（证明这个方法存在就会触发派生）
    expect(deriveUndeclaredCapabilities(subjectFor(rt), rt.capabilities).caps.revertUndoApi).toBe(true);
    // 显式 false = 作者决定（语义不可逆），永不覆盖
    const guarded = deriveUndeclaredCapabilities(subjectFor(rt), rt.capabilities, new Set(['revertUndoApi']));
    expect(guarded.caps.revertUndoApi).toBe(false);
  });

  test('attested/behavior capabilities are never auto-enabled', () => {
    const rt: any = { name: 'x', capabilities: minimalCapabilities() };
    const out = deriveUndeclaredCapabilities(subjectFor(rt), rt.capabilities);
    expect(out.caps.steerApi).toBe(false); // prompt.delivery.steer is conformance-verified, not presence
    expect(out.caps.turnBudgetApi).toBe(false);
  });
});
