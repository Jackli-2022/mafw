import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWorkbenchContext,
  persistedWorkbenchContext,
  workbenchContextFromLegacyView,
} from "./workbench-context";

test("normalizes only the four contexts", () => {
  assert.equal(normalizeWorkbenchContext("project"), "project");
  assert.equal(normalizeWorkbenchContext("goal"), "goal");
  assert.equal(normalizeWorkbenchContext("content"), "content");
  assert.equal(normalizeWorkbenchContext("review"), "review");
  assert.equal(normalizeWorkbenchContext("execution"), "project");
  assert.equal(normalizeWorkbenchContext("nope"), "project");
  assert.equal(normalizeWorkbenchContext(null), "project");
});

test("maps every legacy B1 view", () => {
  assert.equal(workbenchContextFromLegacyView("work"), "project");
  assert.equal(workbenchContextFromLegacyView("workbench"), "content");
  assert.equal(workbenchContextFromLegacyView("execution"), "project");
  assert.equal(workbenchContextFromLegacyView("review"), "review");
  assert.equal(workbenchContextFromLegacyView(null), "project");
});

test("goal context is transient and persists as project", () => {
  assert.equal(persistedWorkbenchContext("goal"), "project");
  assert.equal(persistedWorkbenchContext("project"), "project");
  assert.equal(persistedWorkbenchContext("content"), "content");
  assert.equal(persistedWorkbenchContext("review"), "review");
});
