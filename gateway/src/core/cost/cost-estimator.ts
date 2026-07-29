import { CostRecord, CostSummary, estimateTokens, estimateCost, generateCostId } from './types';

export interface ToolCallRecord {
  goalId?: string;
  loopNum: number;
  waveNum?: number;
  toolName: string;
  input: string;
  model?: 'sonnet' | 'haiku';
}

export class CostEstimator {
  private records: CostRecord[] = [];

  recordToolCall(call: ToolCallRecord): CostRecord {
    const tokens = estimateTokens(call.toolName, call.input);
    const cost = estimateCost(tokens, call.model);
    const record: CostRecord = {
      id: generateCostId(),
      goalId: call.goalId,
      loopNum: call.loopNum,
      waveNum: call.waveNum,
      toolName: call.toolName,
      estimatedTokens: tokens,
      estimatedCost: cost,
      timestamp: new Date().toISOString()
    };
    this.records.push(record);
    return record;
  }

  getAllRecords(): CostRecord[] {
    return [...this.records];
  }

  getSummary(goalId?: string, loopNum?: number): CostSummary {
    const filtered = this.records.filter(r => {
      if (goalId && r.goalId !== goalId) return false;
      if (loopNum !== undefined && r.loopNum !== loopNum) return false;
      return true;
    });
    if (filtered.length === 0) {
      return { totalTokens: 0, totalCost: 0, byWave: [], byTool: [] };
    }
    const waveMap = new Map<number, { tokens: number; cost: number }>();
    for (const r of filtered) {
      const wn = r.waveNum ?? 0;
      const entry = waveMap.get(wn) || { tokens: 0, cost: 0 };
      entry.tokens += r.estimatedTokens;
      entry.cost += r.estimatedCost;
      waveMap.set(wn, entry);
    }
    const toolMap = new Map<string, { tokens: number; cost: number }>();
    for (const r of filtered) {
      const entry = toolMap.get(r.toolName) || { tokens: 0, cost: 0 };
      entry.tokens += r.estimatedTokens;
      entry.cost += r.estimatedCost;
      toolMap.set(r.toolName, entry);
    }
    return {
      totalTokens: filtered.reduce((s, r) => s + r.estimatedTokens, 0),
      totalCost: filtered.reduce((s, r) => s + r.estimatedCost, 0),
      byWave: Array.from(waveMap.entries()).map(([waveNum, data]) => ({ waveNum, ...data })),
      byTool: Array.from(toolMap.entries()).map(([toolName, data]) => ({ toolName, ...data }))
    };
  }

  clear(): void {
    this.records = [];
  }
}
