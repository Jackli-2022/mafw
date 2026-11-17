import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  captureReviewWorkSnapshot,
  readReviewWorkSnapshot,
  renderReviewWorkBlock,
  reviewWorkSnapshotPath,
} from '../../src/core/pod/goal-review-context';
import type { PodReviewItem } from '../../src/core/pod/pod-review-service';

const now = '2026-11-17T00:00:00.000Z';

function item(overrides: Partial<PodReviewItem> = {}): PodReviewItem {
  return {
    id: 'review_1',
    podId: 'pod_1',
    goalId: 'g1',
    revision: 2,
    status: 'pending',
    rel: 'src/a.ts',
    startLine: 3,
    endLine: 5,
    code: 'const x = 1',
    comment: '改这里',
    anchor: { kind: 'quote', quote: 'const x = 1' },
    source: { kind: 'project', projectDir: 'C:/repo', root: 'C:/repo', contentVersion: 'v1' },
    clientRef: 'ann-1',
    response: null,
    originItemId: null,
    originRevision: null,
    createdAt: now,
    updatedAt: now,
    respondedAt: null,
    resolvedAt: null,
    ...overrides,
  };
}

describe('goal review work context', () => {
  test('renders pending and responded items once as quoted data', () => {
    const resolved = item({ id: 'resolved_1', status: 'resolved' });
    const responded = item({
      id: 'review_2',
      status: 'responded',
      comment: '已回应但未解决',
      response: '已改，等待人确认',
    });
    const block = renderReviewWorkBlock({ revision: 2, capturedAt: now, items: [item(), responded, resolved] });
    expect(block).toContain('review_1');
    expect(block).toContain('改这里');
    expect(block).toContain('已回应但未解决');
    expect(block).toContain('已改，等待人确认');
    expect(block).not.toContain('resolved_1');
    expect(block).toContain('只有用户能确认解决');
    expect(block).toContain('来自项目');
  });

  test('renders backticks as escaped data, not prompt fences', () => {
    const block = renderReviewWorkBlock({
      revision: 2,
      capturedAt: now,
      items: [item({ comment: '改 ``` 这里 ```' })],
    });
    expect(block).not.toContain('```');
    expect(block).toContain('\\u0060\\u0060\\u0060');
  });

  test('plan snapshot stays stable and corrupt snapshots fail closed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-review-context-'));
    const snapshotPath = path.join(dir, 'review-work.json');
    try {
      const snapshot = captureReviewWorkSnapshot({ path: snapshotPath, revision: 2, items: [item()], now });
      expect(snapshot.itemIds).toEqual(['review_1']);
      expect(readReviewWorkSnapshot(snapshotPath, 2)?.itemIds).toEqual(['review_1']);
      fs.writeFileSync(snapshotPath, '{broken');
      expect(() => readReviewWorkSnapshot(snapshotPath, 2)).toThrow(/snapshot/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('resolves revision-specific snapshot paths', () => {
    expect(reviewWorkSnapshotPath('C:/mafw', 'g1', 1)).toBe(path.join('C:/mafw', 'review-work.json'));
    expect(reviewWorkSnapshotPath('C:/mafw', 'g1', 2)).toBe(
      path.join('C:/mafw', 'revisions', 'g1', 'rev-2', 'review-work.json'),
    );
  });

  test('oversized aggregate fails instead of truncating', () => {
    const huge = item({ comment: 'x'.repeat(140 * 1024) });
    expect(() => renderReviewWorkBlock({ revision: 1, capturedAt: now, items: [huge] }))
      .toThrow(/review context is too large/);
  });
});
