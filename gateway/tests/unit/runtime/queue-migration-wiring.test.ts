import { readFileSync } from 'fs';
import { join } from 'path';
const src = readFileSync(join(__dirname, '../../../src/index.ts'), 'utf8');

describe('G6 迁移：三 notify 站点切 delivery:queue（spec §2 v2 Q3）', () => {
  it('milestone promptNoReply 带 delivery queue + 幂等 key', () => {
    const i = src.indexOf('promptNoReply: async (sid, text, key) =>');
    expect(i).toBeGreaterThan(0);
    const seg = src.slice(i, i + 450);
    expect(seg).toContain("delivery: 'queue'");
    expect(seg).toMatch(/idempotencyKey/);
  });
  it('自更新通知带 delivery queue', () => {
    const i = src.indexOf('private async notifyUpdateComplete');
    expect(i).toBeGreaterThan(0);
    const seg = src.slice(i, i + 1800);
    expect(seg).toContain("delivery: 'queue'");
  });
  it('BudgetGuard notify ×2 带 delivery queue（attachBudgetGuardForGoal/ForPrompt 的 notify 闭包）', () => {
    const hits = src.match(/notify: async \(sid, text\) =>/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(2);
    let cursor = 0;
    for (const h of hits) {
      const i = src.indexOf(h, cursor); cursor = i + 1;
      const seg = src.slice(i, i + 420);
      expect(seg).toContain("delivery: 'queue'");
    }
  });
});
