/**
 * Write-side fidelity: identifiers buried in the body become retrievable cues.
 */
import { harvestIdentifierCues } from '../../../src/memory/cue-harvest';

describe('harvestIdentifierCues', () => {
  test('harvests camelCase, snake_case, paths and kebab filenames', () => {
    const body = 'Fixed searchScored and harmonic_index; see gateway/src/recall/fok-gate.ts and styles/main.min.css';
    const cues = harvestIdentifierCues(body);
    expect(cues).toContain('searchScored');
    expect(cues).toContain('harmonic_index');
    expect(cues).toContain('gateway/src/recall/fok-gate.ts');
    expect(cues).toContain('styles/main.min.css');
  });

  test('skips cues already present (case-insensitive) and ignores plain prose', () => {
    const body = 'searchScored was broken; the deployment rollout worked fine';
    const cues = harvestIdentifierCues(body, ['searchscored']);
    expect(cues).not.toContain('searchScored');
    expect(cues).toHaveLength(0);
  });

  test('respects the budget', () => {
    const body = 'alphaBeta gammaDelta deltaEpsilon zetaEta thetaIota kappaLambda muNu xiOmicron';
    expect(harvestIdentifierCues(body, [], { max: 3 })).toHaveLength(3);
  });

  test('drops short tokens and empty input', () => {
    expect(harvestIdentifierCues('aB cD', [], { minLen: 5 })).toHaveLength(0);
    expect(harvestIdentifierCues('', [])).toHaveLength(0);
  });

  test('no duplicates within one harvest', () => {
    const cues = harvestIdentifierCues('searchScored again searchScored', []);
    expect(cues.filter(c => c === 'searchScored')).toHaveLength(1);
  });
});
