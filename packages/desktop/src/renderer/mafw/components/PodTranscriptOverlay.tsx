import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { transcriptTurns } from "../pod-transcript"

const ROLE_LABEL: Record<string, string> = {
  user: "用户",
  assistant: "助手",
  other: "其他",
}

export function PodTranscriptOverlay(props: { podId: string; sessionId: string; onClose: () => void }) {
  const [snapshot, setSnapshot] = createSignal<unknown>(null)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  let seq = 0

  createEffect(() => {
    const podId = props.podId
    const sessionId = props.sessionId
    if (!podId || !sessionId) return
    const my = ++seq
    setLoading(true)
    setError(null)
    setSnapshot(null)
    void window.api.mafw.pod.transcript(podId, sessionId)
      .then((result) => {
        if (my !== seq) return
        setSnapshot(result.transcript ?? null)
      })
      .catch((err: any) => {
        if (my !== seq) return
        setError(String(err?.message ?? err))
      })
      .finally(() => {
        if (my === seq) setLoading(false)
      })
  })

  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopImmediatePropagation()
        event.stopPropagation()
        props.onClose()
      }
    }
    window.addEventListener("keydown", onKey, true)
    onCleanup(() => window.removeEventListener("keydown", onKey, true))
  })

  const turns = () => transcriptTurns(snapshot())

  return (
    <div class="mafw-pod-transcript-backdrop" onClick={(event) => {
      if (event.target === event.currentTarget) props.onClose()
    }}>
      <div class="mafw-pod-transcript" role="dialog" aria-modal="true" aria-label="Pod 会话快照">
        <div class="mafw-pod-transcript-head">
          <div>
            <div class="mafw-pod-transcript-title">会话快照</div>
            <div class="mafw-pod-transcript-session">{props.sessionId}</div>
          </div>
          <ButtonV2 variant="ghost" size="small" aria-label="关闭快照" onClick={props.onClose}>✕</ButtonV2>
        </div>

        <Show when={!loading()} fallback={<div class="mafw-pod-transcript-loading"><LoaderV2 width={16} height={16} /></div>}>
          <Show when={!error()} fallback={<div class="mafw-pod-empty-line">读取失败：{error()}</div>}>
            <Show when={turns().length > 0} fallback={<div class="mafw-pod-empty-line">该会话没有可用快照</div>}>
              <div class="mafw-pod-transcript-body">
                <For each={turns()}>
                  {(turn) => (
                    <div class={`mafw-pod-transcript-turn mafw-pod-transcript-${turn.role}`}>
                      <div class="mafw-pod-transcript-role">{ROLE_LABEL[turn.role] ?? turn.role}</div>
                      <pre class="mafw-pod-transcript-text">{turn.text}</pre>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  )
}
