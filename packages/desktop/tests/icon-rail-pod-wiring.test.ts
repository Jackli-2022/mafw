import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const rail = readFileSync(new URL("../src/renderer/mafw/components/IconRail.tsx", import.meta.url), "utf8")
const dock = readFileSync(new URL("../src/renderer/mafw/components/LeftDock.tsx", import.meta.url), "utf8")
const icons = readFileSync(new URL("../../ui/src/components/icon.tsx", import.meta.url), "utf8")

test("rail exposes the Lead destination with a badge in its accessible name", () => {
  assert.match(rail, /key: "lead"/)
  assert.match(rail, /team-three/)
  assert.match(rail, /podBadge/)
  assert.match(rail, /formatRailBadge/)
  assert.match(rail, /badgeLabel/)
  assert.match(rail, /railAriaLabel/)
  // 2026-11-17：aria-label 改为「基础文案 + 后缀」组合（铃铛可自定义基础文案），
  // Tooltip 与按钮共用同一个 fullLabel。
  assert.match(rail, /TooltipV2 value=\{fullLabel\}/)
  assert.match(icons, /"team-three":/)
})

test("rail names the free-discussion face and the Lead entry truthfully", () => {
  assert.match(rail, /\"讨论 \(Ctrl\+B\)\"/)
  assert.match(rail, /label: "Lead"/)
  assert.match(rail, /buildRailLeadMenu/)
  assert.doesNotMatch(rail, /"Pod"/)
  assert.doesNotMatch(rail, /"工作空间"/)
  assert.match(rail, /"审批"/)
  assert.match(rail, /"checklist"/)
  assert.match(rail, /badge: props\.approvals/)
  assert.doesNotMatch(rail, /label: "Dashboard"/)
  assert.doesNotMatch(rail, /label: "工作 \(Ctrl\+B\)"/)
})

test("left dock no longer renders a Pod face", () => {
  assert.doesNotMatch(dock, /import \{ ProjectResources \}/)
  assert.doesNotMatch(dock, /<ProjectResources/)
  assert.doesNotMatch(dock, /face === "pod"/)
  assert.doesNotMatch(dock, /PodRailFace/)
})
