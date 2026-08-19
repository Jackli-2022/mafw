import { withRetry } from '../../gateway/src/core/utils/retry';
import { CircuitBreaker, CircuitBreakerOpenError } from '../../gateway/src/core/utils/circuit-breaker';
import { executeWithFallback } from '../../gateway/src/core/utils/fallback';

jest.useFakeTimers({ advanceTimers: true });

describe('withRetry', () => {
  test('succeeds on first attempt', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries on retryable error, succeeds on retry', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }))
      .mockResolvedValueOnce('ok');
    const result = await withRetry(fn, { maxRetries: 1, baseDelay: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('exhausts retries and throws', async () => {
    const onExhausted = jest.fn();
    const fn = jest.fn().mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    await expect(withRetry(fn, { maxRetries: 2, baseDelay: 10, onExhausted })).rejects.toThrow('timeout');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onExhausted).toHaveBeenCalled();
  });

  test('does NOT retry non-retryable errors', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('unknown error'));
    await expect(withRetry(fn, { maxRetries: 3, baseDelay: 10 })).rejects.toThrow('unknown error');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('custom policy', async () => {
    const onRetry = jest.fn();
    const fn = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { code: 'RATE_LIMITED' }))
      .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { code: 'RATE_LIMITED' }))
      .mockResolvedValueOnce('ok');
    const result = await withRetry(fn, {
      maxRetries: 3,
      baseDelay: 5,
      maxDelay: 1000,
      backoffMultiplier: 3,
      retryableErrors: ['RATE_LIMITED'],
      onRetry,
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  test('retries on message-based match (429)', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('HTTP 429 Too Many Requests'))
      .mockResolvedValueOnce('ok');
    const result = await withRetry(fn, { maxRetries: 1, baseDelay: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('CircuitBreaker', () => {
  test('CLOSED → OPEN after threshold failures', async () => {
    const cb = new CircuitBreaker({ threshold: 3, timeout: 60000 });
    const fn = jest.fn().mockRejectedValue(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(fn)).rejects.toThrow('fail');
    }
    expect(cb.getState()).toBe('OPEN');
  });

  test('HALF_OPEN → CLOSED after success count', async () => {
    const cb = new CircuitBreaker({ threshold: 2, timeout: 100, halfOpenMaxCalls: 2 });
    const failFn = jest.fn().mockRejectedValue(new Error('fail'));
    await expect(cb.execute(failFn)).rejects.toThrow('fail');
    await expect(cb.execute(failFn)).rejects.toThrow('fail');
    expect(cb.getState()).toBe('OPEN');

    jest.advanceTimersByTime(200);
    const successFn = jest.fn().mockResolvedValue('ok');
    await cb.execute(successFn);
    expect(cb.getState()).toBe('HALF_OPEN');
    await cb.execute(successFn);
    expect(cb.getState()).toBe('CLOSED');
  });

  test('HALF_OPEN → OPEN on failure', async () => {
    const cb = new CircuitBreaker({ threshold: 3, timeout: 100, halfOpenMaxCalls: 3 });
    const failFn = jest.fn().mockRejectedValue(new Error('fail'));
    await expect(cb.execute(failFn)).rejects.toThrow('fail');
    await expect(cb.execute(failFn)).rejects.toThrow('fail');
    await expect(cb.execute(failFn)).rejects.toThrow('fail');
    expect(cb.getState()).toBe('OPEN');

    jest.advanceTimersByTime(200);
    await expect(cb.execute(failFn)).rejects.toThrow('fail');
    expect(cb.getState()).toBe('OPEN');
  });

  test('OPEN throws CircuitBreakerOpenError', async () => {
    const cb = new CircuitBreaker({ threshold: 1, timeout: 60000 });
    const fn = jest.fn().mockRejectedValue(new Error('fail'));
    await expect(cb.execute(fn)).rejects.toThrow('fail');
    await expect(cb.execute(fn)).rejects.toThrow(CircuitBreakerOpenError);
    await expect(cb.execute(fn)).rejects.toThrow('Circuit breaker is OPEN');
  });

  test('reset restores CLOSED state', async () => {
    const cb = new CircuitBreaker({ threshold: 1, timeout: 60000 });
    const fn = jest.fn().mockRejectedValue(new Error('fail'));
    await expect(cb.execute(fn)).rejects.toThrow('fail');
    expect(cb.getState()).toBe('OPEN');
    cb.reset();
    expect(cb.getState()).toBe('CLOSED');
  });
});

describe('executeWithFallback', () => {
  test('primary succeeds', async () => {
    const result = await executeWithFallback({
      primary: () => Promise.resolve('primary'),
      fallback: () => Promise.resolve('fallback'),
    });
    expect(result).toBe('primary');
  });

  test('primary fails → fallback succeeds', async () => {
    const result = await executeWithFallback({
      primary: () => Promise.reject(new Error('primary fail')),
      fallback: () => Promise.resolve('fallback'),
    });
    expect(result).toBe('fallback');
  });

  test('both fail → degrade succeeds', async () => {
    const result = await executeWithFallback({
      primary: () => Promise.reject(new Error('primary fail')),
      fallback: () => Promise.reject(new Error('fallback fail')),
      degrade: () => Promise.resolve('degrade'),
    });
    expect(result).toBe('degrade');
  });

  test('all fail → throws', async () => {
    await expect(executeWithFallback({
      primary: () => Promise.reject(new Error('primary fail')),
      fallback: () => Promise.reject(new Error('fallback fail')),
    })).rejects.toThrow('All strategies failed');
  });
});
