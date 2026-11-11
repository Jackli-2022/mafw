/**
 * E4-6 batch-4 review: serve 逻辑条目只在**真的持有 serve 实例**时登记。
 *
 * 缺陷：batch 4 的 `syncServeLedger()` 只要 `runtimeHost.agentProcess.spawnServe`
 * 存在就登记 —— 那是"能力存在"，不是"进程存在"。boot 顺序里 runtimeHost 早于
 * serve spawn，导致 `/api/kernel/stats` 在从没起过 serve 的部署里也报
 * `processes.byKind.serve = 1`。本测试用内核实例直接驱动这个私有钩子（其余字段
 * 全部走真实默认值），钉住"能力-only 不登记 / 有实例才登记 / 幂等"。
 */
import { MafwScheduler } from '../../../src/index';

interface LedgerProbe {
  processLedger: { count(kind?: string): number; snapshot(): { byKind: Record<string, number> } };
  serveLedger?: unknown;
  serveInstance?: { url: string; close: () => void } | undefined;
  runtimeHost?: unknown;
  syncServeLedger(): void;
}

function probe(scheduler: MafwScheduler): LedgerProbe {
  return scheduler as unknown as LedgerProbe;
}

describe('serve ledger registration (E4-6 review)', () => {
  it('does not register a capability-only serve entry (spawnServe present, no instance)', () => {
    const scheduler = new MafwScheduler('.');
    const p = probe(scheduler);
    // 能力存在：runtimeHost 暴露 spawnServe，但此刻没有 serve 实例在跑。
    p.runtimeHost = { agentProcess: { spawnServe: jest.fn() } };

    p.syncServeLedger();

    expect(p.serveLedger).toBeUndefined();
    expect(p.processLedger.count('serve')).toBe(0);
  });

  it('registers exactly one entry once a serve instance exists, and stays idempotent', () => {
    const scheduler = new MafwScheduler('.');
    const p = probe(scheduler);
    p.runtimeHost = { agentProcess: { spawnServe: jest.fn() } };
    p.serveInstance = { url: 'http://127.0.0.1:9', close: jest.fn() };

    p.syncServeLedger();
    p.syncServeLedger();

    expect(p.processLedger.count('serve')).toBe(1);
    expect(p.processLedger.snapshot().byKind.serve).toBe(1);
    // 逻辑条目：gateway 不托管关闭（owned:false），由 adapter 负责进程。
    const entry = (p.processLedger as any).list?.().find((e: any) => e.kind === 'serve');
    if (entry) expect(entry.owned).toBe(false);
  });
});
