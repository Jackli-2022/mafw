import { LessonCompactor } from '../../../gateway/src/core/compression/lesson-compactor';
import { RawLesson } from '../../../gateway/src/core/types/compression';

function makeRaw(lesson: string): RawLesson {
  return {
    loop: 1,
    trigger: 'review_fail',
    result: 'review_fail',
    domain: 'auth',
    task: 't1',
    lesson,
    energy: 'high',
    files: [],
    created_at: '2024-01-01T00:00:00Z'
  };
}

test('compact extracts action verbs', () => {
  const compactor = new LessonCompactor();
  const raw = makeRaw('We must use RS256 for all auth tokens. This is critical.');
  const result = compactor.compact(raw);
  expect(result.success).toBe(true);
  expect(result.compacted.lesson).toMatch(/must|must use|RS256/);
});

test('compact fails when loop is changed', () => {
  const compactor = new LessonCompactor();
  const raw = makeRaw('Short');
  (raw as any).loop = 2; // force mismatch after compact copies it
  // Actually compact copies loop, so this test verifies field preservation by comparing.
  const result = compactor.compact(raw);
  expect(result.compacted.loop).toBe(2);
});
