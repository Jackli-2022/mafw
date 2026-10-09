// G1 authority preservation (AuthMem-Bench arXiv:2608.01679): provenance must
// survive consolidation. Schema field + write-path annotation + consume-side
// validation. Legacy entries (no field) are treated as lowest authority.
import { normalizeAuthority, higherAuthority } from '../../../src/core/memory/harmonic-types';
import { buildOKF } from '../../../src/memory/okf-writer';
import { parseOKF } from '../../../src/memory/okf-parser';
import { buildInsightUnit } from '../../../src/recall/reflection';
import { evaluatePromotion } from '../../../src/memory/skill-promotion';
import { formatAgentPriors, formatPinnedProfile } from '../../../src/recall/inject-format';
import { handleAgentPriors } from '../../../src/routes/agent-priors';

describe('normalizeAuthority', () => {
  it('accepts the four authority levels', () => {
    for (const a of ['user', 'agent', 'tool', 'pipeline']) {
      expect(normalizeAuthority(a)).toBe(a);
    }
  });
  it('returns undefined for absent (caller applies default)', () => {
    expect(normalizeAuthority(undefined)).toBeUndefined();
    expect(normalizeAuthority(null)).toBeUndefined();
  });
  it('returns null for invalid values', () => {
    expect(normalizeAuthority('god')).toBeNull();
    expect(normalizeAuthority(42)).toBeNull();
  });
});

describe('higherAuthority (merge: authority only rises, pipeline never elevates)', () => {
  it('user is never demoted', () => {
    expect(higherAuthority('user', 'pipeline')).toBe('user');
    expect(higherAuthority('pipeline', 'user')).toBe('user');
    expect(higherAuthority('user', 'agent')).toBe('user');
  });
  it('pipeline + agent → agent', () => {
    expect(higherAuthority('agent', 'pipeline')).toBe('agent');
    expect(higherAuthority('pipeline', 'tool')).toBe('tool');
  });
  it('absent (legacy) counts as pipeline', () => {
    expect(higherAuthority(undefined, undefined)).toBe('pipeline');
    expect(higherAuthority(undefined, 'user')).toBe('user');
  });
});

describe('G1 write-path annotation', () => {
  it('OKF round-trip preserves authority', () => {
    const okf = buildOKF({
      id: 'mem_1_x', type: 'semantic', primary_abstraction: 'p', cue_anchors: [],
      memory_value: 'v', energy: 0.8, created_at: 'c', updated_at: 'u', authority: 'user',
    } as any);
    const parsed = parseOKF(okf);
    expect(parsed.unit.authority).toBe('user');
  });

  it('reflection insights are fixed to pipeline authority (inferred, never self-elevated)', () => {
    const unit = buildInsightUnit({ category: 'insight', content: 'x' }, 'sess', '2026-10-09');
    expect(unit.authority).toBe('pipeline');
  });
});

describe('G1 consume-side validation', () => {
  it('skill promotion G6: pipeline without verified anchor is not materialized', () => {
    const base = { need7d: 5, energy: 0.9, body: '1. step one\n2. step two', verified: false, daysSinceRevision: 30, existingSkillCount: 0 };
    const pipeline = evaluatePromotion({ ...base, authority: 'pipeline' });
    expect(pipeline.eligible).toBe(false);
    expect(pipeline.reasons.some((r) => r.includes('G6'))).toBe(true);
    // verified pipeline MAY promote (G6 is about unverified inference)
    expect(evaluatePromotion({ ...base, authority: 'pipeline', verified: true }).eligible).toBe(true);
    // user without verified is rejected by G3 (not G6) — G6 must not add a reason
    const userUnverified = evaluatePromotion({ ...base, authority: 'user' });
    expect(userUnverified.eligible).toBe(false);
    expect(userUnverified.reasons.some((r) => r.includes('G6'))).toBe(false);
  });

  it('agent-priors: pipeline failure patterns get a soft score penalty and a badge', async () => {
    const mk = (authority?: string) => ({
      id: `e-${authority ?? 'legacy'}`, type: 'semantic', primary_abstraction: `pat-${authority ?? 'legacy'}`,
      cue_anchors: ['cat:failure'], energy: 0.9, salience: 1, superseded_by: undefined, authority,
    });
    const deps = {
      l5: { getTop: () => ({ axioms: [], heuristics: [] }) },
      getIndex: () => ({ entries: [mk('user'), mk('pipeline')] }),
    };
    const { block } = await handleAgentPriors(deps as any);
    expect(block).toContain('[user]');
    expect(block).toContain('[pipeline]');
    // user entry must outrank the equal-energy pipeline entry
    expect(block!.indexOf('pat-user')).toBeLessThan(block!.indexOf('pat-pipeline'));
  });

  it('pinned profile marks non-user entries as needing confirmation', () => {
    const { profile } = formatPinnedProfile([
      { id: 'a', primary_abstraction: 'p1', memory_value: 'user fact', authority: 'user' } as any,
      { id: 'b', primary_abstraction: 'p2', memory_value: 'inferred fact', authority: 'pipeline' } as any,
    ]);
    expect(profile).toContain('user fact');
    expect(profile).toContain('[待确认]');
    expect(profile!.indexOf('[待确认]')).toBeLessThan(profile!.indexOf('inferred fact'));
  });
});
