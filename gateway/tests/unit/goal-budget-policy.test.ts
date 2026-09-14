import { mergeBudgetIntoSnapshot } from '../../src/core/goal-budget';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('mergeBudgetIntoSnapshot', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-gb-'));
  afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });

  it('merges maxTurns/maxCostUsd from request file', () => {
    const req = path.join(tmp, 'g1.json');
    fs.writeFileSync(req, JSON.stringify({ goalId: 'g1', budget: { maxTurns: 8, maxCostUsd: 0.3 } }));
    const out = mergeBudgetIntoSnapshot({ version: 'v1', proposalId: null }, req);
    expect(out).toEqual({ version: 'v1', proposalId: null, maxTurns: 8, maxCostUsd: 0.3 });
  });

  it('merges partial budget (only maxTurns)', () => {
    const req = path.join(tmp, 'g1b.json');
    fs.writeFileSync(req, JSON.stringify({ goalId: 'g1b', budget: { maxTurns: 8 } }));
    const out = mergeBudgetIntoSnapshot({ version: 'v1' }, req);
    expect(out).toEqual({ version: 'v1', maxTurns: 8 });
  });

  it('returns snapshot unchanged when request has no budget', () => {
    const req = path.join(tmp, 'g2.json');
    fs.writeFileSync(req, JSON.stringify({ goalId: 'g2' }));
    const snap = { version: 'v1' };
    expect(mergeBudgetIntoSnapshot(snap as any, req)).toEqual({ version: 'v1' });
  });

  it('fail-open on missing/invalid request file', () => {
    const snap = { version: 'v1' };
    expect(mergeBudgetIntoSnapshot(snap as any, path.join(tmp, 'nope.json'))).toEqual({ version: 'v1' });
    const bad = path.join(tmp, 'bad.json');
    fs.writeFileSync(bad, 'not json');
    expect(mergeBudgetIntoSnapshot(snap as any, bad)).toEqual({ version: 'v1' });
  });
});
