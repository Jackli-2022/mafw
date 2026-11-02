import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js"
import { useI18n } from "@mafw/ui/context/i18n"
import { Card } from "@mafw/ui/card"
import { Tooltip } from "@mafw/ui/tooltip"
import { Spinner } from "@mafw/ui/spinner"

/**
 * 重试展示信息。
 *
 * 会话状态本身是 MAFW View DTO 的 `MafwSessionStatus`（`'retry'` 只是枚举值），
 * 重试次数/原因/下次时间属于传输层元数据，单独传入，不还原 runtime 原生
 * `SessionStatus` 对象形状。
 */
export interface SessionRetryInfo {
  attempt: number
  message: string
  /** 下一次重试的时间戳（毫秒）。 */
  next?: number
}

export function SessionRetry(props: { retry?: SessionRetryInfo; show?: boolean }) {
  const i18n = useI18n()
  const retry = createMemo(() => props.retry)
  const [seconds, setSeconds] = createSignal(0)
  createEffect(
    on(retry, (current) => {
      if (!current) return
      const update = () => {
        const next = retry()?.next
        if (!next) return
        setSeconds(Math.round((next - Date.now()) / 1000))
      }
      update()
      const timer = setInterval(update, 1000)
      onCleanup(() => clearInterval(timer))
    }),
  )
  const message = createMemo(() => {
    const current = retry()
    if (!current) return ""
    if (current.message.includes("exceeded your current quota") && current.message.includes("gemini")) {
      return i18n.t("ui.sessionTurn.retry.geminiHot")
    }
    if (current.message.length > 80) return current.message.slice(0, 80) + "..."
    return current.message
  })
  const truncated = createMemo(() => {
    const current = retry()
    if (!current) return false
    return current.message.length > 80
  })
  const info = createMemo(() => {
    const current = retry()
    if (!current) return ""
    const count = Math.max(0, seconds())
    const delay = count > 0 ? i18n.t("ui.sessionTurn.retry.inSeconds", { seconds: count }) : ""
    const retrying = i18n.t("ui.sessionTurn.retry.retrying")
    const line = [retrying, delay].filter(Boolean).join(" ")
    if (!line) return i18n.t("ui.sessionTurn.retry.attempt", { attempt: current.attempt })
    return i18n.t("ui.sessionTurn.retry.attemptLine", { line, attempt: current.attempt })
  })

  return (
    <Show when={retry() && (props.show ?? true)}>
      <div data-slot="session-turn-retry">
        <Card variant="error" class="error-card">
          <div class="flex items-start gap-2">
            <Spinner class="size-4 mt-0.5" />
            <div class="min-w-0">
              <Show when={truncated()} fallback={<div data-slot="session-turn-retry-message">{message()}</div>}>
                <Tooltip value={retry()?.message ?? ""} placement="top">
                  <div data-slot="session-turn-retry-message" class="cursor-help truncate">
                    {message()}
                  </div>
                </Tooltip>
              </Show>
              <Show when={info()}>{(line) => <div data-slot="session-turn-retry-info">{line()}</div>}</Show>
            </div>
          </div>
        </Card>
      </div>
    </Show>
  )
}
