import { generateHarmonicId, HarmonicUnit } from '../../src/memory/harmonic-types';

describe('Harmonic Types', () => {
  it('generates unique IDs', () => {
    const a = generateHarmonicId();
    const b = generateHarmonicId();
    expect(a).not.toBe(b);
    expect(a.startsWith('mem_')).toBe(true);
  });

  it('supports all type values', () => {
    const types: HarmonicUnit['type'][] = ['episodic', 'semantic', 'procedural'];
    types.forEach(t => {
      const unit: HarmonicUnit = {
        id: generateHarmonicId(), type: t,
        primary_abstraction: 'test', cue_anchors: [], memory_value: '',
        energy: 0.5, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      };
      expect(unit.type).toBe(t);
    });
  });

  it('merged_from is optional', () => {
    const unit: HarmonicUnit = {
      id: 'test', type: 'semantic',
      primary_abstraction: 'test', cue_anchors: ['a'], memory_value: 'v',
      energy: 0.5, created_at: '', updated_at: ''
    };
    expect(unit.merged_from).toBeUndefined();
  });
});
