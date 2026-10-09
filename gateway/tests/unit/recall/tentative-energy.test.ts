import { capTentativeEnergy } from '../../../src/recall/turn-pipeline';

describe('capTentativeEnergy', () => {
  test('tentative anchor caps energy at 0.35', () => {
    const u = { cue_anchors: ['tentative', 'gateway'], energy: 0.9 } as any;
    expect(capTentativeEnergy(u).energy).toBe(0.35);
  });
  test('non-tentative untouched', () => {
    expect(capTentativeEnergy({ cue_anchors: ['gateway'], energy: 0.9 } as any).energy).toBe(0.9);
  });
  test('already-low tentative untouched', () => {
    expect(capTentativeEnergy({ cue_anchors: ['tentative'], energy: 0.2 } as any).energy).toBe(0.2);
  });
  test('missing cues untouched', () => {
    expect(capTentativeEnergy({ energy: 0.9 } as any).energy).toBe(0.9);
  });
});
