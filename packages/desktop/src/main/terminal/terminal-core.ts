// terminal-core：内嵌终端的纯本地逻辑（无 Electron / 无网络）。
//
// Task 11 起桌面只实现 MAFW terminal 协议（`terminal-protocol.ts`）：原生 PTY
// 的 0x00 meta 帧、`{location,data}` 信封、connect-token 等知识全部留在
// gateway adapter，这里只剩目录键、连接状态机与外部终端指令。
import { dirKey as sharedDirKey } from "../../shared/terminal-session"

export { type ConnState, nextConnState } from "../../shared/terminal"

/** 目录键：win32 归一分隔符+折大小写，darwin 折大小写；linux 保持大小写敏感。 */
export function dirKey(dir: string, platform: string = process.platform): string {
  return sharedDirKey(dir, platform)
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
