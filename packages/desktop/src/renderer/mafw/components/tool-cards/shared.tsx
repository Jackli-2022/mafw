import { For, Show, createMemo, type Component } from "solid-js"
import { ToolCard } from "@mafw/session-ui/tool-card"
import type { ToolProps } from "@mafw/session-ui/message-part"
import { resolvePresentation, type ToolPresentationContext } from "@mafw/session-ui/tool-presentation"
import { presentFamily } from "./family-present"
import type { ListItem, Section, ToolCardSpec } from "./extract"

const BADGE_STYLE: Record<string, any> = {
  ok: { background: "var(--accent-bg)", color: "var(--accent)" },
  accent: { background: "var(--accent-bg)", color: "var(--accent)" },
  warn: { background: "rgba(232,184,75,0.15)", color: "#e8b84b" },
  err: { background: "rgba(232,99,107,0.15)", color: "#e8636b" },
  muted: { background: "transparent", color: "var(--text-muted)" },
}

function Badge(props: { text: string; tone?: string }) {
  return (
    <span
      class="mafw-tool-tag"
      style={{ "border": "0.5px solid var(--border-base)", ...(BADGE_STYLE[props.tone || "muted"] || BADGE_STYLE.muted) }}
    >
      {props.text}
    </span>
  )
}

function SectionView(props: { section: Section }) {
  const sec = () => props.section
  return (
    <>
      <Show when={sec().kind === "kv"}>
        <div class="mafw-tool-meta-grid">
          <For each={(sec() as any).rows}>
            {(row: [string, string]) => (
              <div class="mafw-tool-meta">
                <span class="mafw-tool-meta-label">{row[0]}</span>
                {row[1]}
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={sec().kind === "tags"}>
        <div class="mafw-tool-anchors">
          <For each={(sec() as any).items}>
            {(t: string) => <span class="mafw-tool-chip">{t}</span>}
          </For>
        </div>
      </Show>
      <Show when={sec().kind === "text"}>
        <div
          class="mafw-tool-meta"
          style={{
            color:
              (sec() as any).tone === "error" ? "#e8636b"
              : (sec() as any).tone === "warn" ? "#e8b84b"
              : (sec() as any).tone === "muted" ? "var(--text-muted)" : undefined,
          }}
        >
          {(sec() as any).text}
        </div>
      </Show>
      <Show when={sec().kind === "code"}>
        <pre class="mafw-tool-output">{(sec() as any).text}</pre>
      </Show>
      <Show when={sec().kind === "list"}>
        <div class="mafw-tool-results">
          <For each={(sec() as any).items}>
            {(item: ListItem) => (
              <div class="mafw-tool-result">
                <div style={{ flex: 1 }}>
                  <div class="mafw-tool-result-text">{item.title}</div>
                  <Show when={item.subtitle}>
                    <div class="mafw-tool-meta" style="font-size:11px">{item.subtitle}</div>
                  </Show>
                </div>
                <Show when={item.badge}>
                  <Badge text={item.badge!} tone={item.badgeTone} />
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </>
  )
}

/** Renders a list of Sections — shared by FamilyCard and bespoke cards. */
export function ToolSections(props: { sections: Section[] }) {
  return <For each={props.sections}>{(sec) => <SectionView section={sec} />}</For>
}

/** Desktop-injected `ToolRegistryEntry.renderSections` for family cards. */
export function familyRenderSections(sections: Section[]) {
  return <ToolSections sections={sections} />
}

/** Presenter-driven family card; also the `goal-created` legacy fallback. */
export const FamilyCard: Component<ToolProps & { spec: ToolCardSpec }> = (props) => {
  const context = (): ToolPresentationContext => ({ props, mode: "chat", t: (key) => key })
  const presentation = createMemo(() => resolvePresentation(presentFamily(props.spec, context()), context()))
  return (
    <ToolCard
      props={props}
      presentation={presentation()}
      defaultOpen={props.defaultOpen}
      open={props.open}
      onOpenChange={props.onOpenChange}
      renderSections={familyRenderSections}
    />
  )
}
