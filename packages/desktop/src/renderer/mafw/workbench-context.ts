// Plan D1: the right workbench is a context stack, not four tool tabs.
// Context answers "what am I looking at"; content surfaces answer "which tool".

export type WorkbenchContext = "project" | "goal" | "content" | "review";

export const WORKBENCH_CONTEXTS: readonly WorkbenchContext[] = [
  "project",
  "goal",
  "content",
  "review",
];

const CONTEXT_SET = new Set<string>(WORKBENCH_CONTEXTS);

const LEGACY_VIEW_CONTEXT: Record<string, WorkbenchContext> = {
  work: "project",
  workbench: "content",
  execution: "project",
  review: "review",
};

export function normalizeWorkbenchContext(value: string | null | undefined): WorkbenchContext {
  return value && CONTEXT_SET.has(value) ? (value as WorkbenchContext) : "project";
}

/** Map the retired B1 L1 ids onto the new project/goal/content/review contexts. */
export function workbenchContextFromLegacyView(
  value: string | null | undefined,
): WorkbenchContext {
  if (!value) return "project";
  return LEGACY_VIEW_CONTEXT[value] ?? normalizeWorkbenchContext(value);
}

/** Goal context is a live selection, not a persisted destination. */
export function persistedWorkbenchContext(
  value: WorkbenchContext,
): Exclude<WorkbenchContext, "goal"> {
  return value === "goal" ? "project" : value;
}
