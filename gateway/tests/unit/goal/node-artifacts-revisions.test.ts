// gateway/tests/unit/goal/node-artifacts-revisions.test.ts
// Task 12：产物路径与节点 prompt 的 revision 维度。
// revision 1（legacy 缺省）保持旧路径；revision ≥ 2 落在
// `revisions/<goalId>/rev-<n>/` 下的隔离目录，跨 revision 绝不重叠。
import * as path from 'path';
import { nodeArtifactPaths, renderNodePrompt } from '../../../src/core/goal/node-prompts';

const MAFW = path.join('C:', 'mafw');
const GOAL = 'g1';

describe('nodeArtifactPaths revision isolation', () => {
  it('keeps the legacy layout for revision 1 (explicit or default)', () => {
    const legacy = nodeArtifactPaths(MAFW, GOAL, 2);
    expect(nodeArtifactPaths(MAFW, GOAL, 2, { revision: 1 })).toEqual(legacy);
    expect(legacy).toEqual({
      waves: path.join(MAFW, 'waves.json'),
      receipt: path.join(MAFW, 'receipts', GOAL, 'loop-2-receipt.json'),
      review: path.join(MAFW, 'reviews', `${GOAL}-loop2.md`),
    });
  });

  it('isolates revision 2 and above in a per-revision directory', () => {
    const rev2 = nodeArtifactPaths(MAFW, GOAL, 1, { revision: 2 });
    expect(rev2.waves).toBe(path.join(MAFW, 'revisions', GOAL, 'rev-2', 'waves.json'));
    expect(rev2.receipt).toBe(path.join(MAFW, 'revisions', GOAL, 'rev-2', 'receipts', 'loop-1-receipt.json'));
    expect(rev2.review).toBe(path.join(MAFW, 'revisions', GOAL, 'rev-2', 'reviews', 'loop1.md'));
  });

  it('never collides across revisions or with the legacy layout', () => {
    const rev1 = nodeArtifactPaths(MAFW, GOAL, 1);
    const rev2 = nodeArtifactPaths(MAFW, GOAL, 1, { revision: 2 });
    const rev3 = nodeArtifactPaths(MAFW, GOAL, 1, { revision: 3 });
    const rev2Fix = nodeArtifactPaths(MAFW, GOAL, 1, { revision: 2, fix: true });
    const all = [rev1.waves, rev1.receipt, rev1.review,
      rev2.waves, rev2.receipt, rev2.review,
      rev3.waves, rev3.receipt, rev3.review,
      rev2Fix.receipt, rev2Fix.review];
    expect(new Set(all).size).toBe(all.length);
  });

  it('keeps the fix-pass suffix inside the revision directory', () => {
    const fix = nodeArtifactPaths(MAFW, GOAL, 3, { revision: 4, fix: true });
    expect(fix.receipt).toBe(path.join(MAFW, 'revisions', GOAL, 'rev-4', 'receipts', 'loop-3-fix-receipt.json'));
    expect(fix.review).toBe(path.join(MAFW, 'revisions', GOAL, 'rev-4', 'reviews', 'loop3-fix.md'));
    expect(fix.waves).toBe(nodeArtifactPaths(MAFW, GOAL, 3, { revision: 4 }).waves);
  });

  it('normalizes invalid revisions back to the legacy layout', () => {
    const legacy = nodeArtifactPaths(MAFW, GOAL, 1);
    for (const bad of [0, -2, Number.NaN]) {
      expect(nodeArtifactPaths(MAFW, GOAL, 1, { revision: bad }).waves).toBe(legacy.waves);
    }
  });
});

describe('renderNodePrompt revision context', () => {
  const base = {
    goalId: GOAL,
    projectDir: 'C:/p',
    mafwDir: MAFW,
    round: 1,
    maxRounds: 3,
    charterPath: 'charter.md',
    requestPath: 'request.json',
  };

  it('names the revision and per-revision artifact paths when revision > 1', () => {
    const text = renderNodePrompt('plan', { ...base, revision: 2 });
    expect(text).toContain('rev 2');
    expect(text).toContain(nodeArtifactPaths(MAFW, GOAL, 1, { revision: 2 }).waves);
    expect(text).not.toContain(nodeArtifactPaths(MAFW, GOAL, 1).waves);
  });

  it('renders the legacy header and paths for revision 1 / missing revision', () => {
    for (const revision of [undefined, 1]) {
      const text = renderNodePrompt('plan', { ...base, revision });
      expect(text).toContain('【MAFW Goal g1 · loop 1/3】');
      expect(text).not.toContain('rev ');
      expect(text).toContain(nodeArtifactPaths(MAFW, GOAL, 1).waves);
    }
  });

  it('routes execute and review artifacts through the revision directory', () => {
    const execute = renderNodePrompt('execute', { ...base, revision: 3 });
    const review = renderNodePrompt('review', { ...base, revision: 3 });
    const a = nodeArtifactPaths(MAFW, GOAL, 1, { revision: 3 });
    expect(execute).toContain(a.receipt);
    expect(review).toContain(a.receipt);
    expect(review).toContain(a.review);
  });
});
