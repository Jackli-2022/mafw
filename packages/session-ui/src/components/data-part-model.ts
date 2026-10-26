// T2-3 data part 纯模型（无 JSX）：名称解析 + JSON 视图 + 截断。
const NAME_RE = /^data-[a-z0-9][a-z0-9_-]{0,31}$/
const MAX_JSON = 8 * 1024

export function isDataPartType(type: unknown): type is `data-${string}` {
  return typeof type === "string" && NAME_RE.test(type)
}

export interface DataPartView {
  name: string
  json: string
  empty: boolean
  truncated: boolean
}

export function dataPartView(part: any): DataPartView {
  const name = isDataPartType(part?.type) ? part.type.slice("data-".length) : ""
  const empty = part?.data === undefined
  let json = ""
  if (!empty) {
    try {
      json = JSON.stringify(part.data, null, 2) ?? "null"
    } catch {
      json = "[unserializable]"
    }
  }
  const truncated = json.length > MAX_JSON
  return {
    name,
    json: truncated ? `${json.slice(0, MAX_JSON)}\n…` : json,
    empty,
    truncated,
  }
}
