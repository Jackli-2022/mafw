import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** $EDITOR 解析：VISUAL > EDITOR > 平台默认（win: notepad / 其他: nano）。 */
export function defaultEditorCommand(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): string {
  return env.VISUAL || env.EDITOR || (platform === 'win32' ? 'notepad' : 'nano')
}

export type SpawnFn = (
  editor: string,
  args: string[],
  opts: { stdio: 'inherit'; shell: boolean },
) => { on(ev: string, cb: (code: any) => void): void }

export interface ExternalEditorResult {
  status: 'complete' | 'failed'
  content?: string
}

/**
 * 在外部编辑器中编辑文本（pi coding agent 同款模式）：
 * 调用方需先 tui.stop() 暂停 TUI，结束后 tui.start() + requestRender(true)。
 * Windows 上必须用异步 spawn——同步调用会让 libuv 的控制台读与 vim 争抢输入缓冲。
 */
export async function editInExternalEditor(opts: {
  command: string
  content: string
  spawnFn?: SpawnFn
}): Promise<ExternalEditorResult> {
  const directory = mkdtempSync(join(tmpdir(), 'mafw-tui-editor-'))
  const filePath = join(directory, 'prompt.md')
  try {
    writeFileSync(filePath, opts.content, 'utf-8')
    const [editor, ...editorArgs] = opts.command.split(' ').filter(Boolean)
    const spawnFn = opts.spawnFn ?? ((ed, args, o) => spawn(ed, args, o) as unknown as { on(ev: string, cb: (code: any) => void): void })
    const exitCode = await new Promise<number | null>((resolve) => {
      const child = spawnFn(editor, [...editorArgs, filePath], {
        stdio: 'inherit',
        shell: process.platform === 'win32',
      })
      child.on('error', () => resolve(null))
      child.on('close', (code) => resolve(code as number | null))
    })
    if (exitCode !== 0) return { status: 'failed' }
    return { status: 'complete', content: readFileSync(filePath, 'utf-8').replace(/\n$/, '') }
  } finally {
    try { rmSync(directory, { recursive: true, force: true }) } catch { /* 尽力清理 */ }
  }
}
