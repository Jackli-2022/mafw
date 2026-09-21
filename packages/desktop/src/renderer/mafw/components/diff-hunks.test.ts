import { describe, expect, test } from "bun:test"
import { splitHunks, hunkStats, pickSelectedFile } from "./diff-hunks"

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
