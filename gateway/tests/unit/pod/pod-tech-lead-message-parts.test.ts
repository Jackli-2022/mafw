import {
  buildTechLeadPromptParts,
  normalizeTechLeadParts,
} from '../../../src/core/pod/pod-tech-lead-service';

test('synthetic mode part comes before the content part', () => {
  const parts = buildTechLeadPromptParts(
    [{ type: 'text', text: '[[mode:propose]] options', synthetic: true }],
    'hello',
  );
  expect(parts).toEqual([
    { type: 'text', text: '[[mode:propose]] options', synthetic: true },
    { type: 'text', text: 'hello' },
  ]);
});

test('missing parts normalize to an empty list', () => {
  expect(normalizeTechLeadParts(undefined)).toEqual([]);
  expect(normalizeTechLeadParts(null)).toEqual([]);
  expect(normalizeTechLeadParts('nope')).toEqual([]);
});

test('parts are capped at eight text entries', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ type: 'text', text: `p${i}`, synthetic: true }));
  expect(normalizeTechLeadParts(many)).toHaveLength(8);
  expect(normalizeTechLeadParts([{ type: 'file', text: 'x' }])).toEqual([]);
  expect(normalizeTechLeadParts([{ type: 'text', text: 42 }])).toEqual([]);
});
