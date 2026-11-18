import { describe, expect, test } from 'bun:test'
import { relativePath } from './path'

describe('relativePath', () => {
  test('strips the project directory and normalizes separators', () => {
    expect(relativePath('C:\\proj\\src\\a.ts', 'C:\\proj')).toBe('src/a.ts')
    expect(relativePath('/proj/src/a.ts', '/proj/')).toBe('src/a.ts')
  })

  test('keeps already-relative paths and outside paths', () => {
    expect(relativePath('src/a.ts', '/proj')).toBe('src/a.ts')
    expect(relativePath('/other/a.ts', '/proj')).toBe('/other/a.ts')
    expect(relativePath('/proj', '/proj')).toBe('')
  })

  test('normalizes when no directory is known', () => {
    expect(relativePath('C:\\proj\\src\\a.ts', undefined)).toBe('C:/proj/src/a.ts')
    expect(relativePath(undefined, '/proj')).toBe('')
  })
})
