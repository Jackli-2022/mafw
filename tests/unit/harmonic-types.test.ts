import { generateHarmonicId, HarmonicUnit } from '../../src/memory/harmonic-types';

describe('Harmonic Types', () => {
  it('generates unique IDs', () => {
    const a = generateHarmonicId();
    const b = generateHarmonicId();
    expect(a).not.toBe(b);
    expect(a.startsWith('mem_')).toBe(true);
  });

  it('supports all memory_type values', () => {
    const types: HarmonicUnit['memory_type'][] = ['episodic', 'semantic', 'procedural', 'global'];
    types.forEach(t => {
      const unit: HarmonicUnit = {
        id: generateHarmonicId(), goal_id: null, memory_type: t,
        primary_abstraction: 'test', cue_anchors: [], memory_value: '',
        energy: 0.5, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      };
      expect(unit.memory_type).toBe(t);
    });
  });

  it('merged_from is optional', () => {
    const unit: HarmonicUnit = {
      id: 'test', goal_id: 'g1', memory_type: 'semantic',
      primary_abstraction: 'test', cue_anchors: ['a'], memory_value: 'v',
      energy: 0.5, created_at: '', updated_at: ''
    };
    expect(unit.merged_from).toBeUndefined();
  });
});
