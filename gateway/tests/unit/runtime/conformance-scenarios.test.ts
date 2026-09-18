import { SCENARIOS, evaluateScenario } from '../../../src/runtime/conformance-scenarios';

const ev = (type: string, at = 0) => ({ type, at });

describe('S1 chat-roundtrip evaluator', () => {
  it('passes on delta + terminal sequence', () => {
    const events = [ev('message.part.updated', 1), ev('message.part.delta', 2), ev('message.complete', 3)];
    expect(evaluateScenario('chat-roundtrip', events)).toEqual({ pass: true, failures: [] });
  });

  it('fails when no content event ever arrives (silent runtime)', () => {
    const events = [ev('session.idle', 1)];
    const r = evaluateScenario('chat-roundtrip', events);
    expect(r.pass).toBe(false);
    expect(r.failures.some((f) => f.includes('content'))).toBe(true);
  });

  it('fails when no terminal event (turn never settles)', () => {
    const events = [ev('message.part.updated', 1), ev('message.part.delta', 2)];
    const r = evaluateScenario('chat-roundtrip', events);
    expect(r.pass).toBe(false);
    expect(r.failures.some((f) => f.includes('terminal'))).toBe(true);
  });

  it('fails on error terminal (counts as failure with error note)', () => {
    const events = [ev('message.part.updated', 1), ev('message.error', 2)];
    const r = evaluateScenario('chat-roundtrip', events);
    expect(r.pass).toBe(false);
  });
});

describe('S2 session-lifecycle evaluator', () => {
  it('passes when created and deleted both observed via API', () => {
    expect(evaluateScenario('session-lifecycle', [], { created: true, deleted: true })).toEqual({ pass: true, failures: [] });
  });
  it('fails when created missing', () => {
    const r = evaluateScenario('session-lifecycle', [], { created: false, deleted: true });
    expect(r.pass).toBe(false);
  });
  it('fails when deleted missing (session leaked)', () => {
    const r = evaluateScenario('session-lifecycle', [], { created: true, deleted: false });
    expect(r.pass).toBe(false);
  });
});

describe('catalog', () => {
  it('has 2 scenarios with prompts and timeouts', () => {
    expect(SCENARIOS.length).toBe(2);
    for (const s of SCENARIOS) {
      expect(s.id).toBeTruthy();
      expect(s.timeoutMs).toBeGreaterThan(1000);
    }
  });
});
