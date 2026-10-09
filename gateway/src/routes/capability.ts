// GET /api/agent/capabilities：L1 能力账本 + L2 失败谱（自我认知只读面）。
// deps 注入可单测；index.ts 接线，fail-open。
import { buildCapabilityLedger, buildFailureTaxonomy, LedgerOutcome, CapabilityLedger, FailurePattern } from '../orchestration/capability-ledger';

export interface CapabilityDeps {
  listOutcomes(): LedgerOutcome[];
  getIndex(): { entries: any[] };
  limit?: number;
}

export async function handleCapabilities(deps: CapabilityDeps): Promise<{
  ledger: CapabilityLedger;
  failureTaxonomy: FailurePattern[];
}> {
  const outcomes = deps.listOutcomes() ?? [];
  return {
    ledger: buildCapabilityLedger(outcomes),
    failureTaxonomy: buildFailureTaxonomy(deps.getIndex().entries ?? []),
  };
}
