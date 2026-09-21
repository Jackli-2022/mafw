export type NavKey = "gateway" | "desktop" | "plugins" | "models" | "memory" | "usage" | "approvals" | "opencode" | "mafw"

export interface NavItem {
  key: NavKey
  /** @mafw/ui Icon name (kebab-case SVG icon), never an emoji literal. */
  icon: string
  label: string
  desc: string
}

const NAV_ITEMS: NavItem[] = [
  { key: "gateway",  icon: "server",     label: "Gateway",  desc: "管理 Gateway 进程状态、重启服务和查看日志" },
  { key: "desktop",  icon: "monitor",    label: "Desktop",  desc: "托盘图标、关闭按钮行为等桌面集成" },
  { key: "plugins",  icon: "grid-plus",  label: "Plugins",  desc: "切换 Runtime 引擎和媒体分析引擎" },
  { key: "models",   icon: "cube",       label: "Models",   desc: "配置记忆 worker 和媒体分析使用的 AI 模型" },
  { key: "memory",   icon: "database",   label: "Memory",   desc: "记忆系统嵌入引擎（ONNX / llama.cpp / GPU 卸载）与向量索引" },
  { key: "usage",    icon: "chart-bar",  label: "Usage",    desc: "设置 token 限额、余额预算和平台 cookie" },
  { key: "approvals", icon: "shield",    label: "Approvals", desc: "审批持久白名单（跨会话放行工具/命令前缀）" },
  { key: "opencode", icon: "file",       label: "opencode", desc: "编辑 opencode 原生配置文件" },
  { key: "mafw",     icon: "sparkles",   label: "MAFW",     desc: "MAFW 原始配置文件（高级用户）" },
]

/** Fixed-order settings nav registry (pure data, safe to unit-test). */
export function navItems(): NavItem[] {
  return NAV_ITEMS
}

export function isNavKey(v: unknown): v is NavKey {
  return NAV_ITEMS.some(n => n.key === v)
}
