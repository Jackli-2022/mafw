import { test, expect } from "bun:test"

// Verify all exports exist from the package entry point
import {
  MafwClient,
  SSEConnection,
  Session,
  Project,
  TextPart,
  Goal,
  GoalCreateInput,
  GoalControlAction,
  MemoryUnit,
  MemoryFact,
  MergedSearchOptions,
  EnergyDistribution,
  Axiom,
  Approval,
  TriageItem,
  AutomationRule,
  SessionMessageInfo,
  SessionMessagePart,
  GatewayStatus,
  MethodNotSupportedError,
  SessionNamespace,
  ProjectNamespace,
  EventNamespace,
  ConfigNamespace,
  ChatNamespace,
  GoalsNamespace,
  MemorySearchOptions,
  MemoryNamespace,
  ApprovalsNamespace,
  TriageNamespace,
  AutomationsNamespace,
  MafwClient as MafwClientInterface,
  MafwClientOptions,
} from "./index"

test("exports MafwClient class", () => {
  const c = new MafwClient()
  expect(c).toBeInstanceOf(MafwClient)
})

test("exports SSEConnection class", () => {
  expect(SSEConnection).toBeDefined()
  expect(typeof SSEConnection.prototype.connect).toBe("function")
  expect(typeof SSEConnection.prototype.connectToSession).toBe("function")
})

test("exports MethodNotSupportedError", () => {
  const e = new MethodNotSupportedError("test")
  expect(e.name).toBe("MethodNotSupportedError")
  expect(e.message).toContain("test")
})

// ── Namespace interfaces (structural verification) ──

test("SessionNamespace interface has correct methods", () => {
  // Runtime checks: MafwClient instance has all expected namespaces
  const c = new MafwClient()
  expect(typeof c.session.create).toBe("function")
  expect(typeof c.session.get).toBe("function")
  expect(typeof c.session.list).toBe("function")
  expect(typeof c.session.delete).toBe("function")
  expect(typeof c.session.messages).toBe("function")
  expect(typeof c.session.prompt).toBe("function")
  expect(typeof c.session.promptAsync).toBe("function")
  expect(typeof c.session.events).toBe("function")
})

test("all MAFW namespaces exist on MafwClient", () => {
  const c = new MafwClient()
  expect(typeof c.project.list).toBe("function")
  expect(typeof c.project.current).toBe("function")
  expect(typeof c.project.setCurrent).toBe("function")
  expect(typeof c.event.subscribe).toBe("function")
  expect(typeof c.event.subscribeToSession).toBe("function")
  expect(typeof c.config.get).toBe("function")
  expect(typeof c.config.set).toBe("function")
  expect(typeof c.chat.send).toBe("function")
  expect(typeof c.chat.sendEnriched).toBe("function")
  expect(typeof c.goals.list).toBe("function")
  expect(typeof c.goals.get).toBe("function")
  expect(typeof c.goals.validate).toBe("function")
  expect(typeof c.goals.control).toBe("function")
  expect(typeof c.memory.search).toBe("function")
  expect(typeof c.memory.mergedSearch).toBe("function")
  expect(typeof c.memory.getEnergyDistribution).toBe("function")
  expect(typeof c.memory.getL5Axioms).toBe("function")
  expect(typeof c.memory.delete).toBe("function")
  expect(typeof c.approvals.list).toBe("function")
  expect(typeof c.approvals.respond).toBe("function")
  expect(typeof c.triage.list).toBe("function")
  expect(typeof c.triage.dismiss).toBe("function")
  expect(typeof c.triage.confirm).toBe("function")
  expect(typeof c.triage.reject).toBe("function")
  expect(typeof c.automations.list).toBe("function")
  expect(typeof c.automations.toggle).toBe("function")
})

test("SSEConnection has all SSE methods", () => {
  expect(typeof SSEConnection.prototype.connect).toBe("function")
  expect(typeof SSEConnection.prototype.connectToSession).toBe("function")
  expect(typeof SSEConnection.prototype.disconnect).toBe("function")
  expect(typeof SSEConnection.prototype.on).toBe("function")
  expect(typeof SSEConnection.prototype.emit).toBe("function")
  const c = new SSEConnection()
  expect("connected" in c).toBe(true)
})
