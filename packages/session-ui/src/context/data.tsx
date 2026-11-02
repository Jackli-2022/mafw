import type {
  MafwDiff,
  MafwMessage,
  MafwPart,
  MafwProvider,
  MafwSession,
  MafwSessionStatus,
} from "@mafw/sdk"
import { createSimpleContext } from "@mafw/ui/context"
import { PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"

/**
 * 渲染层消息：历史出口恒有 `id`/`sessionID`（事件快照可缺省，spec §5.2）。
 *
 * 收窄只发生在 UI 边界（`id` 是 upsert/去重的稳定键，`sessionID` 是动作键），
 * 其余字段仍读 MAFW View DTO；不引入第二套 wire 形状。
 */
export type UiMessage = MafwMessage & { id: string; sessionID: string }
export type UiUserMessage = UiMessage & { role: "user" }
export type UiAssistantMessage = UiMessage & { role: "assistant" }

/** provider 列表：`models` 恒为数组（不再出现对象映射与数组两种形状）。 */
export type NormalizedProviderListResponse = {
  all: Map<string, MafwProvider>
  default: {
    [key: string]: string
  }
  connected: Array<string>
}

export type SessionData = {
  agent?: {
    name: string
    color?: string
  }[]
  provider?: NormalizedProviderListResponse
  session: MafwSession[]
  session_status: {
    [sessionID: string]: MafwSessionStatus
  }
  session_diff: {
    [sessionID: string]: MafwDiff[]
  }
  session_diff_preload?: {
    [sessionID: string]: PreloadMultiFileDiffResult<any>[]
  }
  message: {
    [sessionID: string]: UiMessage[]
  }
  part: {
    [messageID: string]: MafwPart[]
  }
}

export type NavigateToSessionFn = (sessionID: string) => void

export type SessionHrefFn = (sessionID: string) => string

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props: {
    data: SessionData
    directory: string
    onNavigateToSession?: NavigateToSessionFn
    onSessionHref?: SessionHrefFn
  }) => {
    return {
      get store() {
        return props.data
      },
      get directory() {
        return props.directory
      },
      navigateToSession: props.onNavigateToSession,
      sessionHref: props.onSessionHref,
    }
  },
})
