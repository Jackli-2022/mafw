export interface FallbackStrategy<T> {
  primary: () => Promise<T>;
  fallback: () => Promise<T>;
  degrade?: () => Promise<T>;
}

export async function executeWithFallback<T>(
  strategy: FallbackStrategy<T>
): Promise<T> {
  try {
    return await strategy.primary();
  } catch {
    try {
      return await strategy.fallback();
    } catch {
      if (strategy.degrade) {
        return await strategy.degrade();
      }
      throw new Error('All strategies failed');
    }
  }
}
