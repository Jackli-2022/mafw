// mafw-file:// 协议注册与 root registry（spec 2026-10-27-workbench-file-preview §3）。
// 纯逻辑 + 注入依赖（session/fetch/stat），可在 node --test 下直接测；electron 接线在 index.ts/ipc.ts。
import { randomBytes } from "node:crypto"
import { isAbsolute, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { MAFW_FILE_SCHEME, mimeForPath, parseMafwFileUrl } from "../shared/mafw-file"

export type RootRegistry = {
  tokenForRoot(absRoot: string): string
  rootForToken(token: string): string | undefined
  clearRoot(absRoot: string): void
}

/** token 是不透明随机十六进制（URL 不含真实路径；root 切换注销即失效）。 */
export function createRootRegistry(randomHex: () => string = () => randomBytes(8).toString("hex")): RootRegistry {
  const tokenByRoot = new Map<string, string>()
  const rootByToken = new Map<string, string>()
  return {
    tokenForRoot(absRoot: string): string {
      const root = resolve(absRoot)
      const existing = tokenByRoot.get(root)
      if (existing) return existing
      let token = randomHex()
      while (rootByToken.has(token)) token = randomHex()
      tokenByRoot.set(root, token)
      rootByToken.set(token, root)
      return token
    },
    rootForToken(token: string): string | undefined {
      return rootByToken.get(token.toLowerCase())
    },
    clearRoot(absRoot: string): void {
      const root = resolve(absRoot)
      const token = tokenByRoot.get(root)
      if (!token) return
      tokenByRoot.delete(root)
      rootByToken.delete(token)
    },
  }
}

/** 协议请求 → 磁盘文件（含逃逸二次防御）；任何不确定一律 null（handler 回 404）。 */
export function resolveMafwFileRequest(
  rawUrl: string,
  registry: RootRegistry,
): { file: string; mime: string } | null {
  const parsed = parseMafwFileUrl(rawUrl)
  if (!parsed) return null
  const root = registry.rootForToken(parsed.token)
  if (!root) return null
  const file = resolve(root, parsed.rel)
  const relCheck = relative(root, file).replace(/\\/g, "/")
  if (!relCheck || relCheck.startsWith("..") || isAbsolute(relCheck)) return null
  return { file, mime: mimeForPath(parsed.rel) }
}

type ProtocolSession = {
  protocol: {
    handle(scheme: string, handler: (request: Request) => Promise<Response>): void
  }
}

type FetchLike = (url: string, opts?: { headers?: Record<string, string> }) => Promise<Response>

/**
 * 每个 session 各挂一次（Electron protocol 是 per-session：renderer `<img>` 走 defaultSession，
 * 浏览器 webview 走 persist:workbench-browser partition——只挂一边另一边 404）。
 * range 透传保 206（大图片/视频流式）。
 */
export function registerMafwFileProtocol(
  sessions: ProtocolSession[],
  registry: RootRegistry,
  fetchImpl: FetchLike,
): void {
  for (const ses of sessions) {
    ses.protocol.handle(MAFW_FILE_SCHEME, async (request) => {
      const hit = resolveMafwFileRequest(request.url, registry)
      if (!hit) return new Response("Not found", { status: 404 })
      const range = request.headers.get("range")
      const res = await fetchImpl(pathToFileURL(hit.file).toString(), {
        headers: range ? { range } : undefined,
      })
      if (res.status >= 400) return res
      const headers = new Headers(res.headers)
      headers.set("content-type", hit.mime)
      // 自定义协议跨源 fetch（dev 是 http://localhost:5173）：放行只读 GET
      headers.set("access-control-allow-origin", "*")
      return new Response(res.body, { status: res.status, headers })
    })
  }
}

/** IPC `fs-register-root` 的校验层：相对路径按 main cwd 归一为绝对路径（project id 可能是 "."），
 *  必须是目录；失败 null。 */
export async function registerRootDir(
  registry: RootRegistry,
  io: { stat(abs: string): Promise<{ isDirectory(): boolean }> },
  dir: string,
): Promise<string | null> {
  if (typeof dir !== "string" || !dir.trim()) return null
  const abs = resolve(dir)
  try {
    const st = await io.stat(abs)
    if (!st.isDirectory()) return null
    return registry.tokenForRoot(abs)
  } catch {
    return null
  }
}

/** 进程级单例：index.ts 注册协议、ipc.ts 注册 root，共用同一份映射。 */
export const mafwFileRoots = createRootRegistry()
