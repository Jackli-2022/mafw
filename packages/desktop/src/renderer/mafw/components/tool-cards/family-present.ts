// Pure MAFW family presenter. The desktop keeps ToolSections and the
// mafw-tool-* CSS; this module only turns a ToolCardSpec into the shared
// ToolPresentation shape.
import type { ToolProps } from "@mafw/session-ui/message-part"
import type {
  Section as ToolSection,
  ToolPresentation,
  ToolPresentationContext,
} from "@mafw/session-ui/tool-presentation"
import { genericSections, type Section, type ToolCardSpec } from "./extract"

/** Completed output → spec sections → generic JSON → `(无输出)`. */
export function familySections(spec: ToolCardSpec, props: ToolProps): Section[] {
  if (props.status !== "completed") return []
  if (!props.output) return [{ kind: "text", text: "(无输出)", tone: "muted" }]
  try {
    const out = spec.extract(props.input, props.output)
    return out.length ? out : genericSections(props.output)
  } catch (e) {
    console.warn("[mafw]", e)
    return genericSections(props.output)
  }
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
      sections: familySections(spec, props) as unknown as ToolSection[],
    },
  }
}
