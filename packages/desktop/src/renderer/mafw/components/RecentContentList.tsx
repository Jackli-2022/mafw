// 项目首页 › 最近内容：按项目持久化的最近打开文件；当前只展示项目主目录条目。
import { For, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { Icon } from "@mafw/ui/icon"
import { splitRelPath, type RecentContentEntry } from "../recent-content"

export function RecentContentList(props: {
  items: readonly RecentContentEntry[]
  onOpen: (entry: RecentContentEntry) => void
}) {
  return (
    <div class="mafw-project-recent-card">
      <div class="mafw-project-recent-head">
        <span class="mafw-project-recent-title">最近内容</span>
      </div>
      <Show
        when={props.items.length > 0}
        fallback={<div class="mafw-project-recent-empty">还没有最近打开的文件</div>}
      >
        <div class="mafw-project-recent-list">
          <For each={props.items}>
            {(entry) => {
              const parts = splitRelPath(entry.rel)
              return (
                <ButtonV2
                  variant="ghost"
                  size="small"
                  class="mafw-project-recent-row"
                  onClick={() => props.onOpen(entry)}
                >
                  <Icon name="file" size="small" />
                  <span class="mafw-project-recent-name">{parts.name}</span>
                  <Show when={parts.dir}>
                    <span class="mafw-project-recent-dir">{parts.dir}</span>
                  </Show>
                </ButtonV2>
              )
            }}
          </For>
        </div>
      </Show>
    </div>
  )
}
