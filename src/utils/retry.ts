export interface RetryPolicy {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors: string[];
  onRetry?: (attempt: number, error: Error) => void;
  onExhausted?: (error: Error) => void;
}

const DEFAULT_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  retryableErrors: ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'RATE_LIMITED', '429'],
};

function isRetryable(error: Error, retryableErrors: string[]): boolean {
  const code = (error as any).code;
  const message = error.message;
  return retryableErrors.some(pattern => {
    if (code && code === pattern) return true;
    if (message && message.includes(pattern)) return true;
    return false;
  });
}

export function withRetry<T>(
  fn: () => Promise<T>,
  policy?: Partial<RetryPolicy>
): Promise<T> {
  const fullPolicy: RetryPolicy = { ...DEFAULT_POLICY, ...policy };

  return (async function attempt(attemptCount: number): Promise<T> {
    try {
      return await fn();
    } catch (error: any) {
      if (attemptCount < fullPolicy.maxRetries && isRetryable(error, fullPolicy.retryableErrors)) {
        if (fullPolicy.onRetry) {
          fullPolicy.onRetry(attemptCount + 1, error);
        }
        const delay = Math.min(
          fullPolicy.baseDelay * Math.pow(fullPolicy.backoffMultiplier, attemptCount),
          fullPolicy.maxDelay
        );
        const jitteredDelay = delay * (0.5 + Math.random() * 0.5);
        await new Promise(resolve => setTimeout(resolve, jitteredDelay));
        return attempt(attemptCount + 1);
      }
      if (fullPolicy.onExhausted && attemptCount >= fullPolicy.maxRetries) {
        fullPolicy.onExhausted(error);
      }
      throw error;
    }
  })(0);
}
