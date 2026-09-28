// @ts-nocheck
import { createSignal, Show } from "solid-js"
import { ContextMenu } from "@mafw/ui/context-menu"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"

export function SessionStrip(props: {
  sessions: () => { id: string; title: string; manager?: boolean }[]
  activeViewId: () => string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onRename: (id: string, title: string) => void
  onExport: (id: string) => void
  onCopyId: (id: string) => void
  onNew: () => void
}) {
  const [renamingId, setRenamingId] = createSignal<string | null>(null)
  const [renameDraft, setRenameDraft] = createSignal("")
  return (
    <div class="mafw-sessionstrip">
      {props.sessions().map(s => (
        <ContextMenu>
          <ContextMenu.Trigger
            as="div"
            class="mafw-session-tab"
            classList={{ active: props.activeViewId() === s.id }}
            onClick={() => props.onSelect(s.id)}
          >
            <span class="mafw-agent-dot" style={{ background: s.manager ? "var(--accent)" : "var(--text-4)" }} />
            <span
              class="mafw-session-title"
              onDblClick={e => { e.stopPropagation(); setRenamingId(s.id); setRenameDraft(s.title || "") }}
            >
              <Show when={renamingId() !== s.id} fallback={
                <TextInputV2
                  value={renameDraft()}
                  onInput={e => setRenameDraft(e.currentTarget.value)}
                  onKeyDown={e => {
                    e.stopPropagation()
                    if (e.key === "Enter") {
                      const next = renameDraft().trim()
                      if (next && next !== s.title) props.onRename(s.id, next)
                      setRenamingId(null)
                    }
                    if (e.key === "Escape") setRenamingId(null)
                  }}
                  onBlur={() => setRenamingId(null)}
                  style={{ width: 120, height: 22, fontSize: 12 }}
                />
              }>{s.title}</Show>
            </span>
            <ButtonV2 variant="ghost" size="small" class="mafw-session-close" onClick={e => { e.stopPropagation(); props.onClose(s.id) }}>✕</ButtonV2>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content>
              <ContextMenu.Item onSelect={() => props.onClose(s.id)}>
                <ContextMenu.ItemLabel>Close</ContextMenu.ItemLabel>
              </ContextMenu.Item>
              <ContextMenu.Item onSelect={() => props.onExport(s.id)}>
                <ContextMenu.ItemLabel>导出 Markdown…</ContextMenu.ItemLabel>
              </ContextMenu.Item>
              <ContextMenu.Item onSelect={() => props.onCopyId(s.id)}>
                <ContextMenu.ItemLabel>Copy session ID</ContextMenu.ItemLabel>
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu>
      ))}
      <ButtonV2 variant="ghost" size="small" class="mafw-session-new" onClick={() => props.onNew()}>+</ButtonV2>
    </div>
  )
}
