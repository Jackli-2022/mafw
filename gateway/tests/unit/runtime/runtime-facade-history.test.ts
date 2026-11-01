import { createRuntimeFacade } from '../../../src/runtime/runtime-facade';
import { normalizeFacadeHistory } from '../../../src/runtime/normalize-messages';

const flatUser = { id: 'm1', sessionID: 's1', role: 'user', content: [{ id: 'p1', type: 'text', text: 'hi' }] };

function wireUser(id = 'legacy'): any {
  return {
    info: { id, sessionID: 's1', role: 'user', time: { created: 1 } },
    parts: [{ id: `${id}_p`, sessionID: 's1', messageID: id, type: 'text', text: 'legacy' }],
  };
}

describe('normalizeFacadeHistory', () => {
  it('passes flat canonical messages through', () => {
    expect(normalizeFacadeHistory({ session: {} } as any, [flatUser])).toEqual([flatUser]);
  });

  it('rescues legacy {info,parts} output through the second-chance translator', () => {
    const violations: string[] = [];
    const out = normalizeFacadeHistory({ session: {} } as any, [wireUser()], (r) => violations.push(r));
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('legacy');
    expect(out[0].role).toBe('user');
    expect(violations.join(' ')).toContain('legacy');
  });

  it('keeps only valid members from a mixed array', () => {
    const out = normalizeFacadeHistory({ session: {} } as any, [flatUser, { bogus: true }, wireUser('w1')]);
    expect(out.map((m) => m.id)).toEqual(['m1', 'w1']);
  });

  it('returns [] for non-array input instead of raw fallback', () => {
    const violations: string[] = [];
    expect(normalizeFacadeHistory({ session: {} } as any, { not: 'array' }, (r) => violations.push(r))).toEqual([]);
    expect(violations.join(' ')).toContain('non-array');
  });

  it('returns [] when declared normalizeMessages throws', () => {
    const violations: string[] = [];
    const rt: any = { session: { normalizeMessages: () => { throw new Error('boom'); } } };
    expect(normalizeFacadeHistory(rt, [flatUser], (r) => violations.push(r))).toEqual([]);
    expect(violations.join(' ')).toContain('boom');
  });
});

describe('RuntimeFacade history integration', () => {
  it('reports dropped raw messages through the facade violation hook', async () => {
    const reasons: string[] = [];
    const raw: any = {
      name: 'fake',
      capabilities: { eventStream: false },
      session: {
        async messages() { return { data: [{ rawSdkShape: true }] }; },
      },
    };
    const facade = await createRuntimeFacade(raw, {
      entry: {},
      isCanonical: () => true,
      onHistoryViolation: (reason) => reasons.push(reason),
    });
    const result = await facade.session.messages({ sessionID: 's1' });
    expect(result.data).toEqual([]);
    expect(reasons.join(' ')).toContain('dropped');
  });

  it('filters invalid raw messages before the business core sees them', async () => {
    const raw: any = {
      name: 'fake',
      capabilities: { eventStream: false },
      session: {
        async messages() {
          return { data: [flatUser, { rawSdkShape: true }], nextCursor: 'c1' };
        },
      },
    };
    const facade = await createRuntimeFacade(raw, { entry: {}, isCanonical: () => true });
    const result = await facade.session.messages({ sessionID: 's1' });
    expect(result.data).toEqual([flatUser]);
    expect(result.nextCursor).toBe('c1');
  });
});
