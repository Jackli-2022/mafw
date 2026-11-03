export function goalSessionTabTitle(input: {
  goalTitle: string
  revision: number
  role: "tech_lead" | "builder" | "reviewer"
}): string {
  const title = String(input.goalTitle ?? "").trim() || "未命名目标"
  const revision = Number.isFinite(input.revision) && input.revision > 0
    ? Math.floor(input.revision)
    : 1
  if (input.role === "tech_lead") {
    return `Tech Lead · ${title}${revision > 1 ? ` · rev ${revision}` : ""}`
  }
  const label = input.role === "builder" ? "Builder" : "Reviewer"
  return `${label} · ${title} · rev ${revision}`
}
