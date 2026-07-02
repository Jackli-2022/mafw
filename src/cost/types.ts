export interface CostRecord {
  id: string;
  goalId: string;
  loopNum: number;
  waveNum?: number;
  toolName: string;
  estimatedTokens: number;
  estimatedCost: number;
  timestamp: string;
}

export interface CostSummary {
  totalTokens: number;
  totalCost: number;
  byWave: Array<{ waveNum: number; tokens: number; cost: number }>;
  byTool: Array<{ toolName: string; tokens: number; cost: number }>;
}

export function generateCostId(): string {
  return `cost_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function estimateTokens(toolName: string, input: string): number {
  if (['file_edit', 'file_write', 'mafw_observe', 'mafw_search_hybrid'].includes(toolName)) {
    return 0;
  }
  return Math.ceil(input.length / 4);
}

export function estimateCost(tokens: number, model: string = 'sonnet'): number {
  const RATES: Record<string, number> = { sonnet: 3.0, haiku: 1.5 };
  const rate = RATES[model] || RATES.sonnet;
  return (tokens / 1000) * rate;
}
