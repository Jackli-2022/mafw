// 双工 ASR 字幕条（Task 8）：partial 边听边出，final 保留到下一段话。
// Plan 2 D2：final 已落入输入栏并挂起自动发送时显示「将自动发送…」提示
// （文本可见窗口——继续说话或手动编辑都会取消）。错误在条内显示并可停止。
// 设计契约：只用 @mafw/ui/v2 组件（ButtonV2），不出现原生 button/input/title。
import { Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"

export interface DuplexVoiceBarProps {
  partial: string
  finalText: string
  /**
   * 服务端已回 `ready`（麦克风真正在收音）。false = 还在 connecting，此时
   * 网关可能正在冷启动 ASR sidecar，文案不得声称「正在听」。
   */
  listening: boolean
  error: string
  /** Plan 2：自动发送计时已挂起（说话继续/手动编辑可取消）。 */
  pendingSend?: boolean
  onStop: () => void
}

export function DuplexVoiceBar(props: DuplexVoiceBarProps) {
  return (
    <div
      class="mafw-duplex-voice-bar"
      classList={{ "mafw-duplex-voice-bar-error": !!props.error }}
      role="status"
      aria-live="polite"
    >
      <Show
        when={props.error}
        fallback={
          <Show
            when={props.partial}
            fallback={
              <Show
                when={props.finalText}
                fallback={
                  <span class="mafw-duplex-voice-text mafw-duplex-voice-listening">
                    {props.listening ? "正在听…" : "正在连接语音识别…"}
                  </span>
                }
              >
                <span class="mafw-duplex-voice-text mafw-duplex-voice-final">{props.finalText}</span>
                <Show when={props.pendingSend}>
                  <span class="mafw-duplex-voice-pending">将自动发送…</span>
                </Show>
              </Show>
            }
          >
            <span class="mafw-duplex-voice-text mafw-duplex-voice-partial">{props.partial}</span>
          </Show>
        }
      >
        <span class="mafw-duplex-voice-text mafw-duplex-voice-error-text">语音输入错误：{props.error}</span>
      </Show>
      <ButtonV2
        variant="ghost"
        size="small"
        class="mafw-duplex-voice-stop"
        aria-label={props.error ? "关闭语音输入提示" : "停止语音输入"}
        onClick={() => props.onStop()}
      >
        {props.error ? "关闭" : "停止"}
      </ButtonV2>
    </div>
  )
}
