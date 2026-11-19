// Pure family registration plan, importable without the browser-only bespoke
// cards (goal-created pulls UI modules that need `window`).
import type { JSX } from "solid-js"
import type { Section } from "@mafw/session-ui/tool-presentation"
import type { ToolRegistryEntry } from "@mafw/session-ui/tool-registry"
import { TOOL_SPECS } from "./extract"
import { presentFamily } from "./family-present"
import { aliasKeys } from "./registered-tools"

export interface FamilyRegistryPort {
  register(entry: ToolRegistryEntry): unknown
}

export function familyRegistrationEntries(
  renderSections: (sections: Section[]) => JSX.Element,
): ToolRegistryEntry[] {
  return Object.entries(TOOL_SPECS).flatMap(([name, spec]) =>
    aliasKeys(name).map((key) => ({
      name: key,
      present: (ctx) => presentFamily(spec, ctx),
      renderSections,
    })),
  )
}

export function registerFamilyCards(
  registry: FamilyRegistryPort,
  renderSections: (sections: Section[]) => JSX.Element,
): void {
  for (const entry of familyRegistrationEntries(renderSections)) registry.register(entry)
}
