import { exec } from 'node:child_process'
import { truncateToWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui'
import { theme } from './theme.ts'

export interface ShellResult {
  command: string
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

/** `!` 前缀识别：`!` + 至少一个非空白字符（Hermes/Claude 同款语义）。 */
export function isShellCommand(text: string): boolean {
  return text.startsWith('!') && text.slice(1).trim().length > 0
}

export function parseShellCommand(text: string): string {
  return text.slice(1).trim()
}

export type ExecFn = (
  cmd: string,
  opts: { cwd?: string; timeout: number; maxBuffer: number },
  cb: (err: any, stdout: string, stderr: string) => void,
) => void

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_BUFFER = 128 * 1024

/** 本地执行 shell 命令（零模型成本，不进会话上下文）。 */
export function runShell(
  cmd: string,
  opts?: { cwd?: string; timeoutMs?: number; execFn?: ExecFn },
): Promise<ShellResult> {
  const execFn = opts?.execFn ?? ((c, o, cb) => exec(c, o, cb as any) as unknown as void)
  return new Promise((resolve) => {
    execFn(
      cmd,
      { cwd: opts?.cwd, timeout: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
      (err, stdout, stderr) => {
        resolve({
          command: cmd,
          exitCode: err?.code ?? (err ? null : 0),
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          timedOut: !!err?.killed,
        })
      },
    )
  })
}

const MAX_OUTPUT_LINES = 50

/** shell 结果渲染：命令行 + exit 行 + 输出（stdout dim / stderr 红，超长截断）。 */
export function shellResultToLines(r: ShellResult, width: number): string[] {
  const lines: string[] = []
  const status = r.timedOut
    ? theme.err('超时')
    : r.exitCode === 0 ? theme.ok(`exit 0`)
      : r.exitCode === null ? theme.warn('exit ?')
        : theme.err(`exit ${r.exitCode}`)
  lines.push(truncateToWidth(`${theme.accent('!')} ${theme.dim(r.command)} ${status}`, width))

  const outLines = (r.stdout + (r.stderr ? `\n${r.stderr}` : '')).split('\n').filter((l) => l.length > 0)
  const capped = outLines.slice(0, MAX_OUTPUT_LINES)
  for (const l of capped) {
    const isErr = r.stderr.split('\n').includes(l)
    for (const w of wrapTextWithAnsi(l, Math.max(4, width - 4))) {
      lines.push(truncateToWidth(`  ${isErr ? theme.err(w) : theme.dim(w)}`, width))
    }
  }
  if (outLines.length > MAX_OUTPUT_LINES) lines.push(theme.dim(`  … 输出截断（${outLines.length} 行）`))
  if (outLines.length === 0) lines.push(theme.dim('  （无输出）'))
  return lines
}
