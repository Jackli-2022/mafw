import {
  DATA_PART_MAX_BYTES,
  dataPartNameOf,
  dataSizeBytes,
  isDataPart,
  isDataPartType,
  normalizeDataPartId,
} from '../../../src/core/data-parts/data-part';

describe('data part helpers', () => {
  it('isDataPartType accepts valid names and rejects others', () => {
    expect(isDataPartType('data-swarm')).toBe(true);
    expect(isDataPartType('data-a1_b-2')).toBe(true);
    expect(isDataPartType('data-')).toBe(false);
    expect(isDataPartType('data-A')).toBe(false); // 大写不允许
    expect(isDataPartType('data-' + 'x'.repeat(33))).toBe(false);
    expect(isDataPartType('tool')).toBe(false);
    expect(isDataPartType('data-a b')).toBe(false);
  });

  it('dataPartNameOf extracts the name only for valid types', () => {
    expect(dataPartNameOf('data-swarm')).toBe('swarm');
    expect(dataPartNameOf('data-a1_b-2')).toBe('a1_b-2');
    expect(dataPartNameOf('data-')).toBeNull();
    expect(dataPartNameOf('text')).toBeNull();
  });

  it('normalizeDataPartId prefixes, sanitizes and is idempotent', () => {
    expect(normalizeDataPartId('swarm-status')).toBe('data_swarm-status');
    expect(normalizeDataPartId('data_swarm-status')).toBe('data_swarm-status');
    expect(normalizeDataPartId('a b/c')).toBe('data_a-b-c');
    const generated = normalizeDataPartId(undefined, () => 'uuid-1');
    expect(generated).toBe('data_uuid-1');
    const long = normalizeDataPartId('x'.repeat(200));
    expect(long.length).toBeLessThanOrEqual('data_'.length + 64);
  });

  it('isDataPart requires id, data-<name> type and a data field', () => {
    expect(isDataPart({ id: 'data_x', type: 'data-x', data: { a: 1 } })).toBe(true);
    expect(isDataPart({ id: 'data_x', type: 'data-x', data: null })).toBe(true);
    expect(isDataPart({ id: 'data_x', type: 'text', data: {} })).toBe(false);
    expect(isDataPart({ id: 'data_x', type: 'data-x' })).toBe(false);
    expect(isDataPart(null)).toBe(false);
  });

  it('dataSizeBytes measures the JSON payload', () => {
    expect(dataSizeBytes({ a: 1 })).toBe(Buffer.byteLength(JSON.stringify({ a: 1 }), 'utf8'));
    expect(dataSizeBytes(undefined)).toBe(0);
    expect(DATA_PART_MAX_BYTES).toBe(65536);
    expect(dataSizeBytes({ big: 'x'.repeat(DATA_PART_MAX_BYTES) })).toBeGreaterThan(DATA_PART_MAX_BYTES);
  });
});
