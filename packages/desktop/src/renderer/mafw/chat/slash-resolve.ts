export type SlashResolution =
  | { kind: "mafw"; name: string }
  | { kind: "runtime"; name: string; agent?: string; model?: { id: string; providerID: string; variant?: string } }
  | { kind: "skill"; name: string }

/**
 * `/` 解析与优先级：MAFW 命令 > runtime 命令 > skill。
 * 这里只做名字解析；skill 的实际调用由 uniform `discovery.invokeSkill` 负责。
 */
export function resolveSlash(
  text: string,
  opts: {
    mafwNames: ReadonlySet<string>
    runtime: ReadonlyArray<{
      name: string
      agent?: string
      model?: { id: string; providerID: string; variant?: string }
    }>
    skills: ReadonlyArray<{ id: string; name?: string }>
  },
): SlashResolution | null {
  const m = /^\/(\S+)(?:\s+(.*))?$/.exec(text.trim())
  if (!m) return null
  const name = m[1].toLowerCase()

  if (opts.mafwNames.has(name)) return { kind: "mafw", name }

  const runtime = opts.runtime.find((c) => c.name.toLowerCase() === name)
  if (runtime) {
    return {
      kind: "runtime",
      name: runtime.name,
      ...(runtime.agent ? { agent: runtime.agent } : {}),
      ...(runtime.model ? { model: runtime.model } : {}),
    }
  }

  const skill = opts.skills.find(
    (s) => s.id.toLowerCase() === name || (s.name ?? "").toLowerCase() === name,
  )
  if (skill) return { kind: "skill", name: skill.id }

  return null
}
