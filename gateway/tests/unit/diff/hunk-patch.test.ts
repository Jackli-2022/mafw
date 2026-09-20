import { splitPatch, invertHunks, buildRevertPatch } from '../../../src/core/diff/hunk-patch';

const SIMPLE_PATCH = [
  'diff --git a/x.txt b/x.txt',
  'index 111..222 100644',
  '--- a/x.txt',
  '+++ b/x.txt',
  '@@ -1,3 +1,4 @@',
  ' one',
  '-two',
  '+TWO',
  '+two-bis',
  ' three',
  '@@ -10,3 +11,3 @@ section?',
  ' four',
  '+four-bis',
  ' five',
  '-six',
].join('\n');

const MULTIFILE_PATCH = SIMPLE_PATCH + '\n' + [
  'diff --git a/y.txt b/y.txt',
  'index 333..444 100644',
  '--- a/y.txt',
  '+++ b/y.txt',
  '@@ -1,2 +1,2 @@',
  ' keep',
  '-old line',
  '+new line',
].join('\n');

describe('splitPatch', () => {
  test('splits header and hunks', () => {
    const { header, hunks } = splitPatch(SIMPLE_PATCH);
    expect(header).toHaveLength(4);
    expect(hunks).toHaveLength(2);
    expect(hunks[0].header).toBe('@@ -1,3 +1,4 @@');
    expect(hunks[0].lines).toEqual([' one', '-two', '+TWO', '+two-bis', ' three']);
    expect(hunks[1].header).toContain('section?');
  });
  test('empty patch → no hunks', () => {
    expect(splitPatch('').hunks).toEqual([]);
  });
});

describe('invertHunks', () => {
  test('inverts selected hunks: +/- swap, counts recomputed, ranges from new side', () => {
    const inverted = invertHunks(SIMPLE_PATCH, [0])!;
    // 反转后 old 侧 = 原 new 侧（ctx 2 + added 2 = 4），new 侧 = 原 old 侧（ctx 2 + removed 1 = 3）
    expect(inverted).toContain('@@ -1,4 +1,3 @@');
    expect(inverted).toContain('+two');
    expect(inverted).toContain('-TWO');
    expect(inverted).toContain('-two-bis');
    expect(inverted).toContain(' three');
    expect(inverted).not.toContain('+two-bis');
    // 未选中的 hunk 不出现
    expect(inverted).not.toContain('four-bis');
  });

  test('inverts second hunk only with omitted-count input', () => {
    const omitted = [
      'diff --git a/x.txt b/x.txt',
      '--- a/x.txt',
      '+++ b/x.txt',
      '@@ -1 +1 @@',
      '-only',
      '+ONLY',
    ].join('\n');
    const inverted = invertHunks(omitted, [0])!;
    expect(inverted).toContain('@@ -1,1 +1,1 @@');
    expect(inverted).toContain('+only');
    expect(inverted).toContain('-ONLY');
  });

  test('backslash no-newline lines preserved', () => {
    const nl = [
      'diff --git a/x.txt b/x.txt',
      '--- a/x.txt',
      '+++ b/x.txt',
      '@@ -1 +1 @@',
      '-end\\ No newline... placeholder',
      '\\ No newline at end of file',
      '+end\\ No newline... placeholder2',
    ].join('\n');
    const inverted = invertHunks(nl, [0])!;
    expect(inverted).toContain('\\ No newline at end of file');
  });

  test('empty selection or out-of-range index → null', () => {
    expect(invertHunks(SIMPLE_PATCH, [])).toBeNull();
    expect(invertHunks(SIMPLE_PATCH, [5])).toBeNull();
    expect(invertHunks(SIMPLE_PATCH, [-1])).toBeNull();
  });
});

describe('buildRevertPatch', () => {
  test('multi-file: independent inverted segments', () => {
    const out = buildRevertPatch([
      { patch: SIMPLE_PATCH, hunkIndices: [1] },
      { patch: MULTIFILE_PATCH.split('\n').slice(SIMPLE_PATCH.split('\n').length).join('\n'), hunkIndices: [0] },
    ])!;
    expect(out).toContain('four-bis');
    expect(out).toContain('y.txt');
    expect(out).toContain('+old line');
    expect(out).toContain('-new line');
    expect(out).not.toContain('-six'); // 第一个 patch 只选了 hunk[1]
  });

  test('any entry with no valid hunks → null', () => {
    expect(buildRevertPatch([{ patch: SIMPLE_PATCH, hunkIndices: [] }])).toBeNull();
    expect(buildRevertPatch([{ patch: SIMPLE_PATCH, hunkIndices: [0] }, { patch: '', hunkIndices: [0] }])).toBeNull();
  });
});
