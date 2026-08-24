interface ModelPrice {
  input: number;
  output: number;
  cachedRead: number;
  cachedWrite: number;
}

const PRICES: Record<string, ModelPrice> = {
  'deepseek-v4-flash': { input: 0.14, output: 0.28, cachedRead: 0.014, cachedWrite: 0 },
  'deepseek-v3': { input: 0.27, output: 1.10, cachedRead: 0.07, cachedWrite: 0 },
  'deepseek-r1': { input: 0.55, output: 2.19, cachedRead: 0.14, cachedWrite: 0 },
  'mimo-v2.5': { input: 0.10, output: 0.30, cachedRead: 0.01, cachedWrite: 0 },
  'qwen3.7-max': { input: 0.20, output: 0.60, cachedRead: 0.02, cachedWrite: 0 },
  'qwen3-coder-plus': { input: 0.15, output: 0.45, cachedRead: 0.015, cachedWrite: 0 },
  'claude-3-5-sonnet': { input: 3.00, output: 15.00, cachedRead: 0.30, cachedWrite: 3.75 },
  'claude-3-haiku': { input: 0.25, output: 1.25, cachedRead: 0.03, cachedWrite: 0.30 },
  'gpt-4o': { input: 2.50, output: 10.00, cachedRead: 1.25, cachedWrite: 0 },
  'gpt-4o-mini': { input: 0.15, output: 0.60, cachedRead: 0.075, cachedWrite: 0 },
};

export function getModelPrice(modelID: string): ModelPrice | null {
  if (PRICES[modelID]) return PRICES[modelID];

  const normalized = modelID.includes('/') ? modelID.split('/')[1] : modelID;
  if (PRICES[normalized]) return PRICES[normalized];

  for (const [key, price] of Object.entries(PRICES)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return price;
    }
  }

  return null;
}

export function calculateCost(
  modelID: string,
  tokens: { input: number; output: number; cache: { read: number; write: number } },
): number {
  const price = getModelPrice(modelID);
  if (!price) return 0;

  const inputCost = (tokens.input / 1_000_000) * price.input;
  const outputCost = (tokens.output / 1_000_000) * price.output;
  const cachedReadCost = (tokens.cache.read / 1_000_000) * price.cachedRead;
  const cachedWriteCost = (tokens.cache.write / 1_000_000) * price.cachedWrite;

  return inputCost + outputCost + cachedReadCost + cachedWriteCost;
}
