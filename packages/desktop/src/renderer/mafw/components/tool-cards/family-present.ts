// Pure MAFW family presenter. The desktop keeps ToolSections and the
// mafw-tool-* CSS; this module only turns a ToolCardSpec into the shared
// ToolPresentation shape.
import type { ToolProps } from "@mafw/session-ui/message-part"
import type { ToolPresentation, ToolPresentationContext } from "@mafw/session-ui/tool-presentation"
import { genericSections, type Section, type ToolCardSpec } from "./extract"

function isRenderableSection(section: Section): boolean {
  switch (section.kind) {
    case "kv":
      return section.rows.length > 0
    case "tags":
      return section.items.length > 0
    case "text":
    case "code":
      return section.text.trim().length > 0
    case "list":
      return section.items.length > 0
  }
}

/** Completed output → spec sections → generic JSON → `(无输出)`. */
export function familySections(spec: ToolCardSpec, props: ToolProps): Section[] {
  if (props.status !== "completed") return []
  let out: Section[] = []
  if (props.output) {
    try {
      out = spec.extract(props.input, props.output)
    } catch (e) {
      console.warn("[mafw]", e)
    }
  }
  const extracted = out.filter(isRenderableSection)
  if (extracted.length) return extracted
  if (!props.output) return [{ kind: "text", text: "(无输出)", tone: "muted" }]
  const generic = genericSections(props.output).filter(isRenderableSection)
  return generic.length ? generic : [{ kind: "text", text: "(无输出)", tone: "muted" }]
}

export function presentFamily(spec: ToolCardSpec, ctx: ToolPresentationContext): ToolPresentation {
  const props = ctx.props
  const badge = props.status === "completed" ? spec.badge?.(props.input, props.output) : undefined
  return {
    collapsed: {
      title: spec.title,
      object: spec.subtitle?.(props.input),
      meta: badge ? [{ text: badge.text, tone: badge.tone }] : undefined,
    },
    expanded: {
      sections: familySections(spec, props),
    },
  }
}
