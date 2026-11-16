// gateway/tests/unit/pod/pod-event-model.test.ts
// Deterministic severity rules: the event layer must never depend on an LLM to
// decide whether a human or the Lead needs to hear about something.
import {
  classifyGoalArchive,
  classifyMemberMessage,
  goalDedupeKey,
  memberDedupeKey,
} from '../../../src/core/pod/pod-event-model';

describe('classifyGoalArchive', () => {
  it.each(['PASS', 'UNREVIEWED'] as const)(
    '%s is a p1 human result',
    (verdict) => {
      expect(classifyGoalArchive({ verdict })).toMatchObject({
        kind: 'goal.result',
        severity: 'p1',
        audience: 'human',
        reason: 'result',
      });
    },
  );

  it.each(['FAIL', 'MAX_RETRIES', 'ERROR'] as const)(
    '%s is a p1 Lead failure event',
    (verdict) => {
      expect(classifyGoalArchive({ verdict })).toMatchObject({
        kind: 'goal.failed',
        severity: 'p1',
        audience: 'lead',
        reason: 'blocked',
      });
    },
  );

  it('CANCELLED is p3 (user cancelled on purpose)', () => {
    expect(classifyGoalArchive({ verdict: 'CANCELLED' })).toMatchObject({
      kind: 'goal.ended',
      severity: 'p3',
      audience: 'none',
    });
  });

  it('null verdict is p3', () => {
    expect(classifyGoalArchive({ verdict: null })).toMatchObject({
      kind: 'goal.ended',
      severity: 'p3',
      audience: 'none',
    });
  });
});

describe('classifyMemberMessage', () => {
  it('request to lead is p2', () => {
    expect(classifyMemberMessage({ kind: 'request', toMemberId: 'lead', leadMemberId: 'lead' })).toMatchObject({
      kind: 'member.request',
      severity: 'p2',
      audience: 'lead',
      reason: 'blocked',
    });
  });

  it('escalation to lead is p2', () => {
    expect(classifyMemberMessage({ kind: 'escalation', toMemberId: 'lead', leadMemberId: 'lead' })).toMatchObject({
      kind: 'member.escalation',
      severity: 'p2',
      audience: 'lead',
    });
  });

  it('request to builder is p3', () => {
    expect(classifyMemberMessage({ kind: 'request', toMemberId: 'builder', leadMemberId: 'lead' })).toMatchObject({
      severity: 'p3',
      audience: 'none',
    });
  });

  it.each(['note', 'review', 'decision'])('%s is p3 even to lead', (kind) => {
    expect(classifyMemberMessage({ kind, toMemberId: 'lead', leadMemberId: 'lead' })).toMatchObject({
      severity: 'p3',
      audience: 'none',
    });
  });

  it('broadcast (no recipient) is p3', () => {
    expect(classifyMemberMessage({ kind: 'request', toMemberId: null, leadMemberId: 'lead' })).toMatchObject({
      severity: 'p3',
      audience: 'none',
    });
  });
});

describe('dedupe keys', () => {
  it('goal key carries revision and event kind', () => {
    expect(goalDedupeKey('g1', 2)).toBe('goal.result:g1:r2');
    expect(goalDedupeKey('g1', 1)).not.toBe(goalDedupeKey('g1', 2));
    expect(goalDedupeKey('g1', 2, 'goal.failed')).toBe('goal.failed:g1:r2');
    expect(goalDedupeKey('g1', 2, 'goal.failed')).not.toBe(goalDedupeKey('g1', 2));
  });

  it('member key carries message id', () => {
    expect(memberDedupeKey('escalation', 'm1', 'lead')).toBe('member.escalation:m1:lead');
    expect(memberDedupeKey('note', 'm1', null)).toBe('member.note:m1:*');
  });
});
