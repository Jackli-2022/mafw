import { tokenize, extractDerivedTerms } from '../../../gateway/src/memory/derived-terms';

test('tokenize CJK bigrams', () => {
  const result = tokenize('创建支付订单');
  expect(result).toContain('创建');
  expect(result).toContain('建支');
  expect(result).toContain('支付');
});

test('tokenize Latin bigrams', () => {
  const result = tokenize('payment order');
  expect(result).toContain('payment');
  expect(result).toContain('pa');
  expect(result).toContain('ay');
  expect(result).toContain('order');
});

test('tokenize deduplicates', () => {
  const result = tokenize('payment payment');
  const paymentCount = result.filter((t: string) => t === 'payment').length;
  expect(paymentCount).toBe(1);
});

test('extractDerivedTerms extracts [[links]]', () => {
  const result = extractDerivedTerms('See [[PaymentService]] and [[OrderService]]');
  expect(result).toContain('PaymentService');
  expect(result).toContain('OrderService');
});

test('extractDerivedTerms extracts CamelCase entities', () => {
  const result = extractDerivedTerms('Call PaymentService.create()');
  expect(result).toContain('PaymentService');
});
