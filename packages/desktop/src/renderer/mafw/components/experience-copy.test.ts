import { expect, test } from 'bun:test'
import { warningText } from './experience-copy'

test('maps stable warning keys without runtime names', () => {
  expect(warningText('restore-conversation-files-no-undo', 'both')).toContain('不可撤销')
  expect(warningText('restore-conversation-files-undoable', 'both')).toContain('撤销回滚')
  expect(warningText(undefined, 'files')).toContain('文件')
})
