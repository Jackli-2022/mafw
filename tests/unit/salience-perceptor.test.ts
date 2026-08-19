import { calculateSalience } from '../../gateway/src/core/memory/salience-perceptor';

describe('calculateSalience', () => {
  it('returns 1.5 for high-salience content', () => {
    expect(calculateSalience('Critical error: database crash')).toBe(1.5);
    expect(calculateSalience('Critical system failure')).toBe(1.5);
    expect(calculateSalience('Emergency failover activated')).toBe(1.5);
  });

  it('returns 0.5 for low-salience content', () => {
    expect(calculateSalience('Success: process completed')).toBe(0.5);
    expect(calculateSalience('Debug: verbose logging')).toBe(0.5);
    expect(calculateSalience('Info: normal operation')).toBe(0.5);
  });

  it('returns 1.0 for neutral content', () => {
    expect(calculateSalience('Updated configuration file')).toBe(1.0);
    expect(calculateSalience('')).toBe(1.0);
  });
});
