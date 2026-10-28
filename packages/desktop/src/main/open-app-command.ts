export interface AppOpenCommand {
  cmd: string
  args: string[]
}

export function appOpenCommand(platform: NodeJS.Platform, app: string, path: string): AppOpenCommand {
  if (platform === "darwin") return { cmd: "open", args: ["-a", app, path] }
  if (platform === "win32") {
    const safePath = path.replace(/"/g, "")
    return { cmd: "cmd.exe", args: ["/d", "/s", "/c", `${app} "${safePath}"`] }
  }
  return { cmd: app, args: [path] }
}
