// ChangesDock（dock changes tab）：当前会话改动文件的常驻列表入口。
// v6 W4：两级视图——文件列表 → 点击进文件 diff（DiffReviewPanel embedded）→ 返回。
// 数据读 store.session_diff[sid]（SSE session.diff 实时快照）。
import { For, Show, createSignal } from "solid-js"
import { DiffReviewPanel, type FileDiffEntry } from "./DiffReviewPanel"

export function ChangesDock(props: {
  sessionID: string | null
  diffs: FileDiffEntry[] | undefined
  onSendComment?: (sessionID: string, text: string) => void
}) {
  const [openFile, setOpenFile] = createSignal<string | null>(null)
  const files = () => props.diffs ?? []
  const totalAdd = () => files().reduce((n, f) => n + (f.additions ?? 0), 0)
  const totalDel = () => files().reduce((n, f) => n + (f.deletions ?? 0), 0)

  return (
    <div class="mafw-changes-dock">
      <Show when={openFile() && props.sessionID}>
        <DiffReviewPanel
          embedded
          sessionID={props.sessionID!}
          diffs={props.diffs}
          initialFile={openFile()}
          onBack={() => setOpenFile(null)}
          onSendComment={props.onSendComment}
        />
      </Show>
      <Show when={!openFile()}>
        <div class="mafw-changes-dock-head">
          <span class="mafw-changes-dock-title">改动</span>
          <Show when={files().length > 0}>
            <span class="mafw-changes-dock-stats">
              {files().length} 个文件 <span class="mafw-diff-stat add">+{totalAdd()}</span>{" "}
              <span class="mafw-diff-stat del">-{totalDel()}</span>
            </span>
          </Show>
        </div>
        <Show when={props.sessionID} fallback={<p class="mafw-changes-dock-empty">没有打开的会话。</p>}>
          <Show
            when={files().length > 0}
            fallback={<p class="mafw-changes-dock-empty">当前会话没有待审的文件改动。</p>}
          >
            <div class="mafw-changes-dock-list">
              <For each={files()}>
                {(f) => (
                  <div
                    class="mafw-changes-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => { if (props.sessionID) setOpenFile(f.file ?? "(unknown)") }}
                    onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && props.sessionID) setOpenFile(f.file ?? "(unknown)") }}
                  >
                    <span class="mafw-changes-row-name">{f.file ?? "(unknown)"}</span>
                    <Show when={typeof f.additions === "number"}>
                      <span class="mafw-diff-stat add">+{f.additions}</span>
                    </Show>
                    <Show when={typeof f.deletions === "number"}>
                      <span class="mafw-diff-stat del">-{f.deletions}</span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  )
}
