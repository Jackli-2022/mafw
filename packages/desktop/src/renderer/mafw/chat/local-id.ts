// 乐观本地消息 id 判定单一真相源：chat-reducers / voice 上传 / part upsert 共用，
// 禁止再散落 `id.startsWith("user-")` 之类的硬编码。
const LOCAL_PREFIXES = ["user-", "local-", "queued-"]

export function isLocalMessageId(id: string): boolean {
  if (!id) return false
  return LOCAL_PREFIXES.some((p) => id.startsWith(p))
}
