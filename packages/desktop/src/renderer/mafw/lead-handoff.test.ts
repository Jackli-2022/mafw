import { test } from "node:test"
import assert from "node:assert/strict"
import { buildLeadHandoff, isHandoffableRole } from "./lead-handoff"

test("buildLeadHandoff captures a free discussion as a bounded Goal source", () => {
  const handoff = buildLeadHandoff({
    sessionTitle: "桌面信息架构讨论",
    sourceText: "# 结论\n按方案 B 执行，保留来源讨论 ses_abc123",
    sessionID: "ses_free",
    messageID: "msg_1",
  })
  assert.ok(handoff)
  assert.equal(handoff.title, "结论")
  assert.ok(!handoff.title.includes("ses_"))
  assert.equal(handoff.sourceRef.sessionID, "ses_free")
  assert.equal(handoff.sourceRef.messageID, "msg_1")
  assert.match(handoff.sourceRef.capturedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(handoff.sourceRef.snapshot, handoff.objective)
})

test("buildLeadHandoff truncates a long source to the backend snapshot limit", () => {
  const handoff = buildLeadHandoff({
    sessionTitle: "long",
    sourceText: "x".repeat(5000),
    sessionID: "ses_free",
  })
  assert.ok(handoff)
  assert.equal(handoff.sourceRef.snapshot.length, 4000)
  assert.equal(handoff.objective.length, 4000)
})

test("buildLeadHandoff refuses internal roles and missing source", () => {
  for (const role of ["lead", "tech_lead", "tech-lead", "builder", "reviewer", "probe", "memory-curator"]) {
    assert.equal(buildLeadHandoff({
      sessionTitle: "internal",
      sourceText: "do it",
      sessionID: "ses_internal",
      role,
    }), null, role)
  }
  assert.equal(buildLeadHandoff({
    sessionTitle: "empty", sourceText: "   ", sessionID: "ses_free",
  }), null)
  assert.equal(buildLeadHandoff({
    sessionTitle: "no id", sourceText: "do it", sessionID: "",
  }), null)
})

test("isHandoffableRole allows user/free sessions and blocks internal workers", () => {
  assert.equal(isHandoffableRole(undefined), true)
  assert.equal(isHandoffableRole("user"), true)
  assert.equal(isHandoffableRole("lead"), false)
  assert.equal(isHandoffableRole("tech-lead"), false)
  assert.equal(isHandoffableRole("builder"), false)
})

test("buildLeadHandoff falls back to the session title when the source has no usable heading", () => {
  const handoff = buildLeadHandoff({
    sessionTitle: "新话题",
    sourceText: "\n### \n",
    sessionID: "ses_free",
  })
  assert.ok(handoff)
  assert.equal(handoff.title, "新话题")
  assert.equal(handoff.sourceRef.snapshot, "###")
})
