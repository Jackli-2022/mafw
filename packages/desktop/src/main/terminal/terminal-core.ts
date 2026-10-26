// terminal-core：内嵌终端的纯逻辑（无 Electron / 无网络），供 main 的
// terminal-bridge 与测试复用。spec `2026-10-26-terminal-dock-design.md` §4。
//
// Wire 契约（2026-10-26 2.1.0 live 实证）：HTTP 经 gateway 兜底反代（自动注入
// serve Basic）；WS 直连 serve，出站为原始文本 + 0x00 前缀 JSON meta 帧
// `{cursor}`，入站原始文本即 stdin。**Enter = `\r`**（禁止翻译成 `\n`——
// PowerShell PSReadLine 把裸 `\n` 当续行，上游 PR #23794 review 实证）。

export { type ConnState, nextConnState } from "../../shared/terminal"

/** 目录键：win32 归一分隔符+折大小写，darwin 折大小写；linux 保持大小写敏感。 */
export function dirKey(dir: string, platform: string = process.platform): string {
  const normalized = platform === "win32" ? dir.replace(/\\/g, "/") : dir
  return platform === "win32" || platform === "darwin" ? normalized.toLowerCase() : normalized
}

/** 0x00 前缀帧一律视为 meta（即使 JSON 非法也只消费、绝不当输出）。 */
export function isMetaFrame(data: ArrayBuffer | string): boolean {
  if (typeof data === "string") return false
  return data.byteLength > 0 && new Uint8Array(data)[0] === 0
}

/** 解 opencode pty 响应信封 `{location, data}`；裸对象原样返回。 */
export function unwrapData(json: any): any {
  return json?.data ?? json
}

/** 从 pty list 取「活动终端」：最后一个 running（实证 list 为创建序）。 */
export function pickActivePty(list: any[]): { id: string } | null {
  if (!Array.isArray(list)) return null
  for (let i = list.length - 1; i >= 0; i--) {
    const it = list[i]
    if (it && it.status === "running" && typeof it.id === "string") return it
  }
  return null
}

/** 解析 0x00 前缀 meta 帧（replay 后由 serve 发送，携带绝对字节游标）。 */
export function parseMetaFrame(data: ArrayBuffer | string): { cursor: number } | null {
  if (!isMetaFrame(data)) return null
  const bytes = new Uint8Array(data as ArrayBuffer)
  try {
    const text = new TextDecoder().decode(bytes.subarray(1))
    const parsed = JSON.parse(text)
    return typeof parsed?.cursor === "number" ? { cursor: parsed.cursor } : null
  } catch {
    return null
  }
}

/** 输入恒等透传——xterm 默认已把 Enter 编码为 `\r`；这里禁止任何改写。 */
export function encodeInput(data: string): string {
  return data
}

export type ExternalTerminal = {
  cmd: string
  args: string[]
  cwd?: string
  fallback?: { cmd: string; args: string[]; cwd?: string }
}

/** 无终端面板时打开系统终端（unavailable 态的出口）；wt 优先，缺则 cmd start。 */
export function externalTerminalCommand(dir: string, platform: string): ExternalTerminal {
  if (platform === "win32") {
    return { cmd: "wt.exe", args: ["-d", dir], fallback: { cmd: "cmd.exe", args: ["/c", "start", "cmd"], cwd: dir } }
  }
  if (platform === "darwin") {
    return { cmd: "open", args: ["-a", "Terminal", dir] }
  }
  return { cmd: "x-terminal-emulator", args: [], cwd: dir }
}
