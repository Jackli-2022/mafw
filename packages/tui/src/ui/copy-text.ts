/** /copy [N]：复制第 N 近 assistant 回复到系统剪贴板（OSC52，终端支持时生效）。 */
import type { ChatTurn } from '../store/chat-store.ts'

export function lastAssistantText(turns: ChatTurn[], n: number): string | null {
  const assistants = turns.filter((t) => t.role === 'assistant' && t.done && !t.queued)
  const target = assistants[assistants.length - n]
  if (!target) return null
  const text = target.parts
    .filter((p) => p.type === 'text' && typeof (p as any).text === 'string')
    .map((p) => (p as any).text as string)
    .join('\n')
    .trim()
  return text || null
}

/** OSC52 转义序列写剪贴板（fail-open：终端不支持时静默无效）。 */
export function copyToClipboard(text: string, write: (s: string) => void): void {
  write(`\x1b]52;c;${Buffer.from(text, 'utf-8').toString('base64')}\x07`)
}
