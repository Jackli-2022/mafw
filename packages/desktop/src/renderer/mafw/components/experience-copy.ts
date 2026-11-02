import type { CheckpointScope } from '@mafw/sdk'

const WARNINGS: Record<string, string> = {
  'restore-conversation-only-no-undo':
    '本次仅截断对话、不回滚文件；该操作不可撤销，请确认已备份。',
  'restore-conversation-files-no-undo':
    '将截断对话并回滚文件；该操作不可撤销，请确认已提交或备份。',
  'restore-conversation-files-undoable':
    '将截断对话并回滚文件；可通过撤销回滚恢复。',
}

/** 只按 gateway 给出的 warningKey 取文案；不再按 runtime 名称分支。 */
export function warningText(key: string | undefined, scope: CheckpointScope): string {
  if (key && WARNINGS[key]) return WARNINGS[key]
  if (scope === 'files') return '只回滚文件到该检查点状态，对话保留。'
  if (scope === 'session') return '撤回该消息及其后内容，不动文件。'
  return '将截断对话并回滚文件；该操作不可撤销，请确认已备份。'
}
