import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { agentKey, agentLabel, isAgentKey, resolveSessionAgent } from "./agent-identity"

describe("agent identity (opencode 2.1.0 id/name split)", () => {
  const agents = [
    { id: "build", name: "Build", mode: "primary" },
    { id: "plan", name: "Plan", mode: "primary" },
    { name: "manager", mode: "primary", source: "mafw" },
  ]

  test("id 优先于 name 作为稳定键；只有 name 的 MAFW 身份回退 name", () => {
    expect(agentKey(agents[0])).toBe("build")
    expect(agentKey(agents[2])).toBe("manager")
    expect(agentKey(null)).toBe("")
    expect(agentLabel(agents[0])).toBe("Build")
    expect(agentLabel(agents[2])).toBe("manager")
  })

  test("session.agent 解析：运行时 id / 旧版显示名 / 大小写都能落位", () => {
    expect(resolveSessionAgent(agents, "plan")?.name).toBe("Plan")
    expect(resolveSessionAgent(agents, "Plan")?.id).toBe("plan")
    expect(resolveSessionAgent(agents, "BUILD")?.id).toBe("build")
    expect(resolveSessionAgent(agents, "manager")?.name).toBe("manager")
    expect(resolveSessionAgent(agents, "ghost")).toBeNull()
    expect(resolveSessionAgent(agents, undefined)).toBeNull()
    expect(resolveSessionAgent(agents, "")).toBeNull()
  })

  test("isAgentKey 大小写不敏感（plan/build 能力门不再依赖显示名小写）", () => {
    expect(isAgentKey(agents[1], "plan")).toBe(true)
    expect(isAgentKey(agents[1], "PLAN")).toBe(true)
    expect(isAgentKey(agents[0], "plan")).toBe(false)
  })

  // 接线契约：纯函数只有被真实调用才算适配（防回退到 name 比较）
  test("MafwShell 用稳定键存取 / 水合 session.agent", () => {
    const src = readFileSync(join(import.meta.dirname, "MafwShell.tsx"), "utf8")
    expect(src).toContain("setAgentPicks(sid, agentKey(a))")
    expect(src).toContain("resolveSessionAgent(agents, s.agent)")
    expect(src).toContain("primaryAgents().find(a => agentKey(a) === name)")
    expect(src).toContain("isAgentKey(a, \"plan\")")
  })

  test("发送链用 id 而非显示名；agent 药丸当前项按 key 比较", () => {
    const send = readFileSync(join(import.meta.dirname, "chat/use-send-message.ts"), "utf8")
    expect(send).toContain("agentKey(agentSel())")
    const pane = readFileSync(join(import.meta.dirname, "components/ChatPane.tsx"), "utf8")
    expect(pane).toContain("isAgentKey(a, \"plan\")")
    expect(pane).toContain("currentName={agentKey(props.agentSel())}")
    const picker = readFileSync(join(import.meta.dirname, "components/pickers/AgentPicker.tsx"), "utf8")
    expect(picker).toContain("agentKey(a) === props.currentName")
  })
})
