// 文件预览协议的 renderer 侧 token 缓存（spec 2026-10-27-workbench-file-preview §4）。
// token 由 main 的 root registry 生成（不透明），renderer 只缓存；同 root 幂等，失败不缓存。
import { buildMafwFileUrl } from "../../shared/mafw-file"

type RegisterRoot = (root: string) => Promise<string | null>

export type FileProtocolClient = {
  ensureRootToken(root: string): Promise<string | null>
  tokenFor(root: string): string | null
  urlFor(root: string, rel: string, version?: number | string): string | null
}

export function createFileProtocolClient(register: RegisterRoot): FileProtocolClient {
  const tokens = new Map<string, string>()
  const inflight = new Map<string, Promise<string | null>>()

  return {
    async ensureRootToken(root: string): Promise<string | null> {
      const cached = tokens.get(root)
      if (cached) return cached
      const pending = inflight.get(root)
      if (pending) return pending
      const p = register(root)
        .then((token) => {
          inflight.delete(root)
          if (token) tokens.set(root, token)
          return token
        })
        .catch(() => {
          inflight.delete(root)
          return null
        })
      inflight.set(root, p)
      return p
    },
    tokenFor(root: string): string | null {
      return tokens.get(root) ?? null
    },
    urlFor(root: string, rel: string, version?: number | string): string | null {
      const token = tokens.get(root)
      if (!token) return null
      try {
        return buildMafwFileUrl(token, rel, version)
      } catch {
        return null
      }
    },
  }
}

/** 进程内单例：register 走 preload IPC（window 只在调用时触碰，模块可被 node --test 导入）。 */
export const fileProtocol = createFileProtocolClient((root) => window.api.fs.registerRoot(root))
