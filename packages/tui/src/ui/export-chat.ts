/** /export：会话导出为 Markdown（opencode /export 同款，写文件而非打开编辑器）。 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ChatTurn } from '../store/chat-store.ts'

/** turns → markdown；跳过排队/本地块，只导 text part。 */
export function turnsToMarkdown(turns: ChatTurn[]): string {
  const out: string[] = ['# MAFW 会话导出', '']
  for (const t of turns) {
    if (t.queued || t.messageID.startsWith('local-')) continue
    const texts = t.parts.filter((p) => p.type === 'text' && typeof (p as any).text === 'string')
    if (texts.length === 0) continue
    out.push(`## ${t.role === 'user' ? 'User' : 'Assistant'}`, '')
    for (const p of texts) out.push((p as any).text, '')
  }
  return out.join('\n')
}

/** 写入 cwd/mafw-chat-<ts>.md，返回绝对路径。 */
export async function exportChat(turns: ChatTurn[], cwd: string): Promise<string> {
  const ts = new Date().toISOString().replace(/[:T]/g, '').slice(0, 14)
  const file = path.join(cwd, `mafw-chat-${ts}.md`)
  fs.writeFileSync(file, turnsToMarkdown(turns), 'utf-8')
  return file
}
