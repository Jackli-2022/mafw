import { For, Show, type Component } from "solid-js"
import { BasicTool } from "@mafw/session-ui/basic-tool"
import type { ToolProps } from "@mafw/session-ui/message-part"
import { genericSections, type ListItem, type Section, type ToolBadge, type ToolCardSpec } from "./extract"

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

/** Renders a list of Sections — shared by familyCard and bespoke cards. */
export function ToolSections(props: { sections: Section[] }) {
  return <For each={props.sections}>{(sec) => <SectionView section={sec} />}</For>
}

export function familyCard(spec: ToolCardSpec): Component<ToolProps> {
  return (props) => {
    const sections = (): Section[] => {
      if (props.status !== "completed" || !props.output) return []
      let out: Section[] = []
      try {
        out = spec.extract(props.input, props.output)
      } catch (e) {
        console.warn("[mafw]", e)
      }
      // 兜底：spec 没产出内容时，用通用 JSON 视图，保证卡片不留空
      return out.length ? out : genericSections(props.output)
    }
    const badge = (): ToolBadge | undefined =>
      props.status === "completed" ? spec.badge?.(props.input, props.output) : undefined
    return (
      <BasicTool
        icon={spec.icon as any}
        trigger={{
          title: spec.title,
          subtitle: spec.subtitle?.(props.input),
          action: badge() ? <span class="mafw-tool-badge" data-tone={badge()!.tone ?? "muted"}>{badge()!.text}</span> : undefined,
        }}
        status={props.status}
        defaultOpen={spec.defaultOpen}
        animated
      >
        <div class="mafw-tool-box"><ToolSections sections={sections()} /></div>
        <Show when={props.status === "completed" && sections().length === 0}>
          <div class="mafw-tool-empty">(无输出)</div>
        </Show>
      </BasicTool>
    )
  }
}
