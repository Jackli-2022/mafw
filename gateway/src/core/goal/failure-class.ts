// gateway/src/core/goal/failure-class.ts
// Classify node failures before the driver decides retry vs terminal. Unknown
// runtime codes fail closed: no retry budget is burned on a semantic error.

export type FailureClass = 'retryable_environment' | 'terminal_contract' | 'terminal_session';

const RETRYABLE_CODES = new Set([
  '408', '429', '500', '502', '503', '504',
  'econnreset', 'econnrefused', 'etimedout', 'epipe', 'eai_again', 'enotfound',
  'rate_limit', 'overloaded', 'timeout', 'temporarily_unavailable',
]);

export function classifyNodeFailure(input: {
  code: string;
  node: 'plan' | 'probe' | 'execute' | 'review';
  source: 'runtime' | 'artifact';
}): FailureClass {
  if (input.source === 'artifact') return 'terminal_contract';
  const code = String(input.code ?? '').trim().toLowerCase();
  if (RETRYABLE_CODES.has(code)) return 'retryable_environment';
  if (/^5\d\d$/.test(code)) return 'retryable_environment';
  return 'terminal_session';
}
