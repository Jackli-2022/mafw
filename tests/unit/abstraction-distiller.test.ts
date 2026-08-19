import { hasKnowledgeSignal, extractPropositions, passQualityGate } from '../../gateway/src/core/memory/abstraction-distiller';

test('detects pitfall signal', () => {
  expect(hasKnowledgeSignal('Error: timeout because connection pool exhausted')).toBe('pitfall');
});

test('detects procedure signal', () => {
  expect(hasKnowledgeSignal('Configure timeout to 30s')).toBe('procedure');
});

test('detects fact signal', () => {
  expect(hasKnowledgeSignal('The API always returns 200')).toBe('fact');
});

test('returns null for no signal', () => {
  expect(hasKnowledgeSignal('User clicked the button')).toBeNull();
});

test('extracts propositions without narrative subjects', () => {
  const result = extractPropositions(['用户发现支付超时，原因是连接池耗尽']);
  expect(result.every(s => !/用户/.test(s))).toBe(true);
  expect(result.length).toBeGreaterThan(0);
});

test('passQualityGate rejects narrative', () => {
  expect(passQualityGate('用户然后点击提交按钮', 'procedure')).toBe(false);
});

test('passQualityGate accepts proper propositions', () => {
  expect(passQualityGate('Payment timeout occurs when pool < 5', 'procedure')).toBe(true);
});

test('passQualityGate rejects short propositions', () => {
  expect(passQualityGate('short', 'procedure')).toBe(false);
});
