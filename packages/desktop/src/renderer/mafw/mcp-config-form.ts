// packages/desktop/src/renderer/mafw/mcp-config-form.ts
// B4：MCP 添加服务器表单的纯校验/解析（UI 与测试共用）。
export interface McpServerConfigInput {
  name: string
  type: "remote" | "local"
  url?: string
  command?: string[]
  overwrite?: boolean
  replace?: boolean
}

export interface McpFormValues {
  name: string
  type: "remote" | "local"
  url?: string
  /** 用户在单行输入里写的命令（支持引号） */
  command?: string
  overwrite?: boolean
  replace?: boolean
}

export type McpFormResult =
  | { ok: true; input: McpServerConfigInput }
  | { ok: false; errors: string[] }

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/

/** 单行命令解析：支持 "..." / '...' 引号，空白分隔。 */
export function splitCommandLine(text: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text ?? '')) !== null) {
    const v = m[1] ?? m[2] ?? m[3] ?? ''
    if (v.length > 0) out.push(v)
  }
  return out
}

export function validateMcpServerForm(values: McpFormValues): McpFormResult {
  const errors: string[] = []
  const name = (values.name ?? '').trim()
  if (!NAME_RE.test(name)) {
    errors.push('名称需匹配 ^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$')
  }

  if (values.type === 'remote') {
    const url = (values.url ?? '').trim()
    if (!/^https?:\/\/\S+$/i.test(url)) errors.push('远端服务器需要 http(s) URL')
  } else {
    const command = splitCommandLine(values.command ?? '')
    if (command.length === 0) errors.push('本地服务器需要非空命令')
  }

  if (errors.length > 0) return { ok: false, errors }

  if (values.type === 'remote') {
    return {
      ok: true,
      input: {
        name,
        type: 'remote',
        url: (values.url ?? '').trim(),
        ...(values.overwrite ? { overwrite: true } : {}),
        ...(values.replace ? { replace: true } : {}),
      },
    }
  }

  return {
    ok: true,
    input: {
      name,
      type: 'local',
      command: splitCommandLine(values.command ?? ''),
      ...(values.overwrite ? { overwrite: true } : {}),
      ...(values.replace ? { replace: true } : {}),
    },
  }
}
