import { describe, expect, test } from "bun:test"
import { familySections, presentFamily } from "./family-present"
import type { ToolCardSpec } from "./extract"

const spec = (extract: ToolCardSpec["extract"]): ToolCardSpec => ({
  icon: "x",
  title: "MAFW Probe",
  subtitle: (input) => input?.query,
  badge: () => ({ text: "ok", tone: "ok" }),
  extract,
})

const props = (overrides: any = {}) => ({
  tool: "mafw_probe",
  input: { query: "q" },
  metadata: {},
  status: "completed",
  ...overrides,
})
const ctx = (p: any) => ({ props: p, mode: "chat" as const, t: (key: string) => key })

describe("family presenter", () => {
  test("uses title, subtitle, badge, and extracted sections", () => {
    const out = presentFamily(spec(() => [{ kind: "text", text: "body" }]), ctx(props({ output: "x" })))
    expect(out.collapsed).toMatchObject({
      title: "MAFW Probe",
      object: "q",
      meta: [{ text: "ok", tone: "ok" }],
    })
    expect(out.expanded.sections).toEqual([{ kind: "text", text: "body" }])
  })

  test("no output shows the empty marker; empty extract falls back to generic sections", () => {
    expect(familySections(spec(() => []), props({ status: "completed", output: "" }))).toEqual([
      { kind: "text", text: "(无输出)", tone: "muted" },
    ])
    expect(familySections(spec(() => []), props({ output: '{"a":1}' }))).toEqual([{ kind: "kv", rows: [["a", "1"]] }])
  })

  test("extract errors fall back to generic sections", () => {
    const out = familySections(
      spec(() => {
        throw new Error("boom")
      }),
      props({ output: "raw text" }),
    )
    expect(out).toEqual([{ kind: "code", text: "raw text" }])
  })

  test("pending parts do not run extract", () => {
    expect(familySections(spec(() => [{ kind: "text", text: "body" }]), props({ status: "running", output: "x" }))).toEqual(
      [],
    )
  })
})
