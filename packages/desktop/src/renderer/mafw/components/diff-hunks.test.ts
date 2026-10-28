import { describe, expect, test } from "bun:test"
import { splitHunks, hunkStats, pickSelectedFile, buildDiffCommentPrompt, lineNewNumber, buildLineCommentPrompt } from "./diff-hunks"

const PATCH = [
  'diff --git a/x.txt b/x.txt',
  '--- a/x.txt',
  '+++ b/x.txt',
  '@@ -1,3 +1,4 @@',
  ' one',
  '-two',
  '+TWO',
  '+two-bis',
  ' three',
  '@@ -10 +11 @@ section?',
  ' four',
  '+four-bis',
].join('\n')

describe('splitHunks', () => {
  test('splits hunks with parsed counts', () => {
    const { hunks } = splitHunks(PATCH)
    expect(hunks).toHaveLength(2)
    expect(hunks[0].oldCount).toBe(3)
    expect(hunks[0].newCount).toBe(4)
    expect(hunks[0].newStart).toBe(1)
    expect(hunks[1].newStart).toBe(11)
    expect(hunks[1].header).toContain('section?')
    expect(hunks[1].oldCount).toBe(1) // 省略 ,1 形式
    expect(hunks[1].newCount).toBe(1)
  })
  test('empty patch → no hunks', () => {
    expect(splitHunks('').hunks).toEqual([])
  })
})

describe('hunkStats', () => {
  test('counts +/- lines', () => {
    expect(hunkStats([' one', '-two', '+TWO', '+two-bis', ' three'])).toEqual({ added: 2, removed: 1 })
  })
})

describe('pickSelectedFile', () => {
  test('当前选中仍在列表则保留', () => {
    expect(pickSelectedFile(['a.ts', 'b.ts'], 'b.ts')).toBe('b.ts')
  })
  test('当前选中消失则回退第一个', () => {
    expect(pickSelectedFile(['a.ts', 'b.ts'], 'gone.ts')).toBe('a.ts')
  })
  test('无选中默认第一个', () => {
    expect(pickSelectedFile(['a.ts'], null)).toBe('a.ts')
  })
  test('空列表返回 null', () => {
    expect(pickSelectedFile([], 'a.ts')).toBeNull()
    expect(pickSelectedFile([], null)).toBeNull()
  })
})

describe('buildDiffCommentPrompt', () => {
  const lines = [' one', '-two', '+TWO']
  test('包含文件、header、行与评论', () => {
    const out = buildDiffCommentPrompt('a.ts', '@@ -1,3 +1,4 @@', lines, '这里不该改名')
    expect(out).toContain('a.ts')
    expect(out).toContain('@@ -1,3 +1,4 @@')
    expect(out).toContain('-two')
    expect(out).toContain('这里不该改名')
  })
  test('超长 hunk 截断 40 行并带标记', () => {
    const many = Array.from({ length: 60 }, (_, i) => ' line' + i)
    const out = buildDiffCommentPrompt('a.ts', '@@ -1 +1 @@', many, 'x')
    expect(out).toContain('line39')
    expect(out).not.toContain('line40')
    expect(out).toContain('截断')
  })
})

describe('lineNewNumber（W0-3 行级评论锚点）', () => {
  const { hunks } = splitHunks(PATCH)
  test('context/add 行返回 new 侧行号，del 行返回 null', () => {
    // hunk0: @@ -1,3 +1,4 @@ / lines: ' one'(1) '-two'(null) '+TWO'(2) '+two-bis'(3) ' three'(4)
    expect(lineNewNumber(hunks[0], 0)).toBe(1)
    expect(lineNewNumber(hunks[0], 1)).toBeNull()
    expect(lineNewNumber(hunks[0], 2)).toBe(2)
    expect(lineNewNumber(hunks[0], 3)).toBe(3)
    expect(lineNewNumber(hunks[0], 4)).toBe(4)
  })
  test('第二个 hunk 从自己的 newStart 起算', () => {
    // hunk1: @@ -10 +11 @@ / lines: ' four'(11) '+four-bis'(12)
    expect(lineNewNumber(hunks[1], 0)).toBe(11)
    expect(lineNewNumber(hunks[1], 1)).toBe(12)
  })
  test('越界下标返回 null', () => {
    expect(lineNewNumber(hunks[0], 99)).toBeNull()
  })
  test('"\\ No newline at end of file" 标记行不计数也不占行号（终审修复）', () => {
    const { hunks: hs } = splitHunks([
      'diff --git a/t.txt b/t.txt',
      '@@ -8,4 +8,5 @@',
      ' ctx',
      '-last',
      '\\ No newline at end of file',
      '+last',
      '+extra',
    ].join('\n'))
    expect(lineNewNumber(hs[0], 0)).toBe(8)   // ' ctx'
    expect(lineNewNumber(hs[0], 1)).toBeNull() // '-last'
    expect(lineNewNumber(hs[0], 2)).toBeNull() // '\ No newline…' 标记行不可评论
    expect(lineNewNumber(hs[0], 3)).toBe(9)    // '+last'（不偏移）
    expect(lineNewNumber(hs[0], 4)).toBe(10)   // '+extra'
  })
})

describe('buildLineCommentPrompt（W0-3）', () => {
  test('包含文件、行号、行内容（去 +/- 前缀）与评论', () => {
    const out = buildLineCommentPrompt('src/a.ts', 42, '+const x = 1', '这个命名不好')
    expect(out).toContain('src/a.ts')
    expect(out).toContain('42')
    expect(out).toContain('const x = 1')
    expect(out).not.toContain('+const')
    expect(out).toContain('这个命名不好')
  })
})
