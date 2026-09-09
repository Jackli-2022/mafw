// @ts-nocheck
import { Show, For, createSignal, onCleanup } from "solid-js"
import { Icon } from "@mafw/ui/icon"

/**
 * AudioReply — 渲染 assistant 消息中的语音回复标记。
 *
 * 检测文本中的 `[语音回复 art:<id> 音色:<voice>]`，用 gateway 的 artifact URL
 * 渲染 <audio controls autoplay>。URL 必须是绝对地址（渲染进程 origin 是
 * oc://renderer，相对路径到不了 gateway）。
 *
 * NOTE: Desktop app connects to gateway via localhost (127.0.0.1), so auth is not
 * needed for local playback. For LAN/Tailscale scenarios, pass authToken prop.
 */

const VOICE_REPLY_RE = /\[语音回复\s+art:([a-zA-Z0-9-]+)(?:\s+音色:([^\]]+))?\]/g

interface Props {
  text: string
  /** gateway base URL（来自 gateway.info().url）。 */
  gatewayUrl: string
  /** Optional auth token for LAN/Tailscale access (Base64 encoded). */
  authToken?: string
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
            <AudioPlayer url={r.url} authToken={props.authToken} />
          </div>
        )}
      </For>
    </Show>
  )
}

/**
 * Audio player that handles optional authentication for LAN/Tailscale.
 * For local (localhost) connections, no auth is needed.
 * For remote connections, fetches audio with auth headers and plays from blob URL.
 */
function AudioPlayer(props: { url: string; authToken?: string }) {
  const [audioUrl, setAudioUrl] = createSignal<string>(props.url)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal(false)
  let blobUrl: string | null = null

  onCleanup(() => {
    // Revoke blob URL on cleanup to prevent memory leaks
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl)
      blobUrl = null
    }
  })

  // Check if this is a localhost connection (no auth needed)
  const isLocalhost = props.url.includes('127.0.0.1') || props.url.includes('localhost')

  // If no auth token or localhost connection, use original URL directly
  if (!props.authToken || isLocalhost) {
    return (
      <audio controls autoplay preload="auto" src={props.url}>
        您的浏览器不支持音频播放。
      </audio>
    )
  }

  // For remote connections with auth token, fetch audio with auth headers
  setLoading(true)
  fetch(props.url, {
    headers: {
      'Authorization': `Basic ${props.authToken}`,
    },
  })
    .then(res => {
      if (!res.ok) throw new Error(`Failed to fetch audio: ${res.status}`)
      return res.blob()
    })
    .then(blob => {
      blobUrl = URL.createObjectURL(blob)
      setAudioUrl(blobUrl)
      setLoading(false)
    })
    .catch((err) => {
      console.error('[AudioReply] Failed to fetch audio:', err)
      setError(true)
      setLoading(false)
    })

  if (loading()) {
    return <div class="mafw-audio-loading">加载中...</div>
  }

  if (error()) {
    return <div class="mafw-audio-error">音频加载失败</div>
  }

  return (
    <audio controls autoplay preload="auto" src={audioUrl()}>
      您的浏览器不支持音频播放。
    </audio>
  )
}
