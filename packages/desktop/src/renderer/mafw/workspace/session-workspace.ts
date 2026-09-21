// 会话工作区状态模块单例（session-store.ts 同款模式）：tabs、消息 store、
// per-session 回调注册表。原先散落在 MafwShell 组件内的这些状态收敛于此，
// 跨组件共享单一所有权；MafwShell 以别名引用，既有调用点零改动。
import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"

/** 打开的会话 tab（原 MafwShell 局部 interface，逐字迁移）。 */
export interface ChatSession {
  id: string
  title: string
  userMsgId: string
  assistantMsgId: string | null
  done: boolean
  manager?: boolean
  metadata?: { mafw?: { role?: string } }
}

/** Reactive data store for SessionTurn (SolidJS store Proxy for fine-grained tracking) */
export type WorkspaceStore = {
  session: any[]
  session_status: Record<string, any>
  session_diff: Record<string, any[]>
  message: Record<string, any[]>
  part: Record<string, any[]>
}

export type RegistryKind = "anchor" | "sendingReset" | "queueFlush" | "phase" | "mediaSpeak"
type RegistryFn = (...args: any[]) => void

export function createSessionWorkspace() {
  // Chat sessions (tabs)
  const [sessions, setSessions] = createSignal<ChatSession[]>([])
  const [activeId, setActiveId] = createSignal<string | null>(null)

  const [store, setStore] = createStore<WorkspaceStore>({
    session: [],
    session_status: {},
    session_diff: {},
    message: {},
    part: {},
  })

  // per-session 回调注册表：anchor（滚动锚）/ sendingReset（发送态复位）/
  // queueFlush（排队续发）/ phase（阶段指示）/ mediaSpeak（TTS 播报）。
  // 保留 Record 形态以兼容既有 `registry[sid]?.()` 调用点（shell 侧别名引用）。
  const records: Record<RegistryKind, Record<string, RegistryFn>> = {
    anchor: {},
    sendingReset: {},
    queueFlush: {},
    phase: {},
    mediaSpeak: {},
  }

  return {
    sessions,
    setSessions,
    activeId,
    setActiveId,
    store,
    setStore,
    register(kind: RegistryKind, sid: string, fn: RegistryFn): void {
      records[kind][sid] = fn
    },
    unregister(kind: RegistryKind, sid: string): void {
      delete records[kind][sid]
    },
    call(kind: RegistryKind, sid: string, ...args: any[]): void {
      records[kind][sid]?.(...args)
    },
    records,
    /** per-session 角色判定（split view 下各 pane 各自查，不再共享全局标记）。 */
    sessionRole(sid: string): string | undefined {
      return sessions().find((s) => s.id === sid)?.metadata?.mafw?.role
    },
  }
}

export type SessionWorkspace = ReturnType<typeof createSessionWorkspace>

/** 模块单例：整个 renderer 共享一份会话工作区。 */
export const workspace: SessionWorkspace = createSessionWorkspace()
