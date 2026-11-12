import { Show, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import type { ChatEpisode } from "../chat/episode-model"
import "../chat-episodes.css"

/** 一段围绕问题的讨论；关闭后折叠成一行，可展开回看。 */
export function EpisodeHeader(props: {
  episode: ChatEpisode
  collapsed: boolean
  turnCount: number
  onTitle?: (title: string) => void
  onToggle: () => void
  onClose: () => void
  onReopen: () => void
  onOpenRecord: () => void
}): JSX.Element {
  return (
    <section class="mafw-episode-header" data-status={props.episode.status}>
      <div class="mafw-episode-main">
        <span class="mafw-episode-kicker">Episode</span>
        <TextInputV2
          value={props.episode.title}
          class="mafw-episode-title"
          aria-label="Episode 标题"
          onInput={(event) => props.onTitle?.(event.currentTarget.value)}
        />
        <span class="mafw-episode-meta">
          {props.episode.status === "closed"
            ? `已关闭 · ${props.turnCount} 轮`
            : `进行中 · ${props.turnCount} 轮`}
        </span>
      </div>
      <div class="mafw-episode-actions">
        <ButtonV2 variant="ghost" size="small" onClick={() => props.onToggle()}>
          {props.collapsed ? "展开" : "收起"}
        </ButtonV2>
        <Show
          when={props.episode.status === "open"}
          fallback={
            <ButtonV2 variant="outline" size="small" onClick={() => props.onReopen()}>
              重新打开
            </ButtonV2>
          }
        >
          <ButtonV2 variant="outline" size="small" onClick={() => props.onClose()}>
            关闭
          </ButtonV2>
        </Show>
        <Show when={props.episode.decisionRecordId}>
          <ButtonV2 variant="ghost" size="small" onClick={() => props.onOpenRecord()}>
            查看决定记录
          </ButtonV2>
        </Show>
      </div>
    </section>
  )
}
