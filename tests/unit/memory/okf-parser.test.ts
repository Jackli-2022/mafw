import { parseOKF } from '../../../gateway/src/memory/okf-parser';

const sample = `---
type: knowledge
id: mem_fn_001
primary_abstraction: "createPayment function"
cue_anchors:
  - payment
  - create
granularity: function
energy: 0.7
links:
  - "[[PaymentService]]"
  - "[[payment]]"
---
# createPayment
Function code here
`;

test('parseOKF parses frontmatter, body, and links', () => {
  const result = parseOKF(sample);
  expect(result.unit.type).toBe('knowledge');
  expect(result.unit.id).toBe('mem_fn_001');
  expect(result.unit.primary_abstraction).toBe('createPayment function');
  expect(result.unit.granularity).toBe('function');
  expect(result.body).toContain('Function code here');
});
