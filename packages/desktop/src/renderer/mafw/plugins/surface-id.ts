// 插件 surface 身份：`plugin:<package>:<panel>`；与插件包/面板 id 字符集一致。
export type BuiltinWorkbenchSurface = "code" | "browser" | "terminal"
export type PluginSurfaceId = `plugin:${string}`
export type WorkbenchSurface = BuiltinWorkbenchSurface | PluginSurfaceId

const PLUGIN_SURFACE_PATTERN = /^plugin:([A-Za-z0-9][A-Za-z0-9._-]*):([A-Za-z0-9][A-Za-z0-9._-]*)$/

export function pluginSurfaceId(packageName: string, panelId: string): PluginSurfaceId {
  return `plugin:${packageName}:${panelId}`
}

export function parsePluginSurfaceId(
  value: string | null | undefined,
): { package: string; panel: string } | null {
  if (typeof value !== "string") return null
  const match = PLUGIN_SURFACE_PATTERN.exec(value)
  if (!match) return null
  return { package: match[1] as string, panel: match[2] as string }
}

export function isPluginSurfaceId(value: string | null | undefined): value is PluginSurfaceId {
  return parsePluginSurfaceId(value) !== null
}
