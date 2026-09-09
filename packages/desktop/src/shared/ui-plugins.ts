// UI 工具卡用户插件共享契约：类型 + 校验纯函数。
// main（插件 render 出口校验）与 renderer（防御性再校验 + 解释器）共用。

export type Widget =
  | { type: "text"; text: string }
  | { type: "code"; text: string; language?: string }
  | { type: "kv"; rows: Array<[string, string]> }
  | { type: "tags"; items: string[] }
  | { type: "list"; items: Array<string | Widget> }
  | { type: "row"; children: Widget[] }
  | { type: "image"; dataUrl: string }
  | { type: "link"; text: string; href: string }

export interface UserCard {
  title?: string
  subtitle?: string
  icon?: string
  defaultOpen?: boolean
  body: Widget[]
}

export interface PluginEntry {
  tool: string
  override: boolean
}

export interface RenderRequest {
  tool: string
  input: unknown
  output?: string
  metadata?: unknown
  status: string
}

export interface RenderResponse {
  ok: boolean
  card?: UserCard
  reason?: string
}

function safeStringify(v: unknown): string {
  try { return JSON.stringify(v) ?? String(v) } catch { return String(v) }
}

export function validateWidget(w: unknown): Widget | null {
  if (w === null || w === undefined) return null
  if (typeof w !== "object") return { type: "text", text: String(w) }
  const o = w as Record<string, unknown>
  switch (o.type) {
    case "text":
      return { type: "text", text: typeof o.text === "string" ? o.text : safeStringify(o.text) }
    case "code": {
      const out: Extract<Widget, { type: "code" }> = { type: "code", text: typeof o.text === "string" ? o.text : safeStringify(o.text) }
      if (typeof o.language === "string") out.language = o.language
      return out
    }
    case "kv":
      return {
        type: "kv",
        rows: Array.isArray(o.rows)
          ? o.rows.filter((r): r is [string, string] => Array.isArray(r) && r.length >= 2).map((r) => [String(r[0]), String(r[1])])
          : [],
      }
    case "tags":
      return { type: "tags", items: Array.isArray(o.items) ? o.items.map(String) : [] }
    case "list":
      return {
        type: "list",
        items: Array.isArray(o.items)
          ? o.items.flatMap((i) => (typeof i === "string" ? [i] : validateWidget(i) ? [validateWidget(i)!] : []))
          : [],
      }
    case "row":
      return { type: "row", children: Array.isArray(o.children) ? o.children.flatMap((c) => (validateWidget(c) ? [validateWidget(c)!] : [])) : [] }
    case "image":
      return typeof o.dataUrl === "string" ? { type: "image", dataUrl: o.dataUrl } : null
    case "link":
      return typeof o.href === "string" && typeof o.text === "string" ? { type: "link", text: o.text, href: o.href } : null
    default:
      return { type: "text", text: safeStringify(o) }
  }
}

export function validateCard(card: unknown): UserCard | null {
  if (!card || typeof card !== "object") return null
  const o = card as Record<string, unknown>
  const body = Array.isArray(o.body) ? o.body.flatMap((w) => (validateWidget(w) ? [validateWidget(w)!] : [])) : []
  const title = typeof o.title === "string" ? o.title : undefined
  if (!title && body.length === 0) return null
  return {
    title,
    subtitle: typeof o.subtitle === "string" ? o.subtitle : undefined,
    icon: typeof o.icon === "string" ? o.icon : undefined,
    defaultOpen: typeof o.defaultOpen === "boolean" ? o.defaultOpen : undefined,
    body,
  }
}

export function shouldUseUserCard(entry: PluginEntry | undefined, hasRegistered: boolean): boolean {
  if (!entry) return false
  return hasRegistered ? entry.override : true
}
