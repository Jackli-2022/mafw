// @ts-nocheck
import { Show, For, createSignal } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"

/**
 * AudioReply — 渲染 assistant 消息中的语音回复标记。
 *
 * 检测文本中的 `[语音回复 art:<id> 音色:<voice>]`，用 gateway 的 artifact URL
 * 渲染 <audio controls autoplay>。URL 必须是绝对地址（渲染进程 origin 是
 * oc://renderer，相对路径到不了 gateway）。
 */

const VOICE_REPLY_RE = /\[语音回复\s+art:([a-zA-Z0-9-]+)(?:\s+音色:([^\]]+))?\]/g

interface Props {
  text: string
  /** gateway base URL（来自 gateway.info().url）。 */
  gatewayUrl: string
}

type VoiceReply = { artifactId: string; voice?: string; url: string }

function extractVoiceReplies(text: string, baseUrl: string): VoiceReply[] {
  const out: VoiceReply[] = []
  for (const m of text.matchAll(VOICE_REPLY_RE)) {
    const id = m[1]
    if (!id) continue
    out.push({
      artifactId: id,
      voice: m[2]?.trim(),
      url: `${baseUrl.replace(/\/+$/, "")}/a2a/artifacts/${id}`,
    })
  }
  return out
}

export function AudioReply(props: Props) {
  const [replies] = createSignal<VoiceReply[]>(extractVoiceReplies(props.text || "", props.gatewayUrl || "http://127.0.0.1:3000"))

  return (
    <Show when={replies().length > 0}>
      <For each={replies()}>
        {(r) => (
          <div class="mafw-audio-reply" data-artifact-id={r.artifactId}>
            <div class="mafw-audio-reply-label">
              <Icon name="volume" size="small" />
              <span>{r.voice ? `语音回复（音色：${r.voice}）` : "语音回复"}</span>
            </div>
            <audio controls autoplay preload="auto" src={r.url}>
              您的浏览器不支持音频播放。
            </audio>
          </div>
        )}
      </For>
    </Show>
  )
}
