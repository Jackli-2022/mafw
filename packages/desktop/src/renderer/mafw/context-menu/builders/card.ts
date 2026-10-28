import { L } from "../labels"
import { item, sep } from "../model"
import type { MenuItem, MenuModel } from "../types"

export interface GoalCardMenuTarget {
  goalId: string
  running: boolean
  canPause: boolean
}

export function buildGoalCardMenu(target: GoalCardMenuTarget): MenuModel {
  const items: MenuItem[] = [
    item("goal.details", L.goal.details),
    item("goal.timeline", L.goal.timeline),
    item("goal.copyId", L.goal.copyId),
  ]
  if (target.running && target.canPause) items.push(item("goal.pause", L.goal.pause))
  items.push(sep(), item("goal.cancel", L.goal.cancel, { danger: true, confirms: true }))
  return { surface: "goal.card", items }
}

export interface GoalCellMenuTarget {
  goalId: string
  runId: string
  sessionID?: string
  artifact?: string
  canRetry: boolean
}

export function buildGoalCellMenu(target: GoalCellMenuTarget): MenuModel {
  const items: MenuItem[] = []
  if (target.sessionID) items.push(item("goalCell.openSession", L.goalCell.openSession))
  items.push(
    item("goalCell.retry", L.goalCell.retry, {
      confirms: true,
      ...(target.canRetry ? {} : { disabled: true, disabledReason: "节点不可重跑" }),
    }),
    item("goalCell.copyArtifact", L.goalCell.copyArtifact, target.artifact
      ? {}
      : { disabled: true, disabledReason: "没有产物路径" }),
  )
  return { surface: "goal.cell", items }
}

export interface MemoryCardMenuTarget {
  id: string
  pinned: boolean
  sticky: boolean
}

export function buildMemoryCardMenu(target: MemoryCardMenuTarget): MenuModel {
  const items: MenuItem[] = [
    item("memory.copyAbstraction", L.memory.copyAbstraction),
    item("memory.copyFull", L.memory.copyFull),
    item("memory.pin", target.pinned ? L.memory.unpin : L.memory.pin),
    item("memory.sticky", target.sticky ? L.memory.renew : L.memory.sticky),
  ]
  if (target.sticky) items.push(item("memory.unsticky", L.memory.unsticky))
  items.push(sep(), item("memory.delete", L.memory.delete, { danger: true, confirms: true }))
  return { surface: "memory.card", items }
}

export interface NotesCardMenuTarget {
  id: string
}

export function buildNotesCardMenu(target: NotesCardMenuTarget): MenuModel {
  void target
  return {
    surface: "notes.card",
    items: [
      item("notes.renew", L.notes.renew),
      item("notes.unsticky", L.notes.unsticky),
      sep(),
      item("notes.delete", L.notes.delete, { danger: true, confirms: true }),
    ],
  }
}

export interface ApprovalQuestionMenuTarget {
  id: string
}

export function buildApprovalQuestionMenu(target: ApprovalQuestionMenuTarget): MenuModel {
  void target
  return {
    surface: "approval.question",
    items: [
      item("approvalQ.approve", L.approvalQ.approve),
      item("approvalQ.reject", L.approvalQ.reject),
      item("approvalQ.copyQuestion", L.approvalQ.copyQuestion),
    ],
  }
}

export interface ApprovalPermissionMenuTarget {
  id: string
  command?: string
}

export function buildApprovalPermissionMenu(target: ApprovalPermissionMenuTarget): MenuModel {
  const items: MenuItem[] = [
    item("approvalP.allowOnce", L.approvalP.allowOnce),
    item("approvalP.alwaysAllow", L.approvalP.alwaysAllow),
    item("approvalP.reject", L.approvalP.reject),
    sep(),
    item("approvalP.rememberPrefix", L.approvalP.rememberPrefix),
    item("approvalP.rememberTool", L.approvalP.rememberTool),
  ]
  if (target.command) items.push(item("approvalP.copyCommand", L.approvalP.copyCommand))
  return { surface: "approval.permission", items }
}

export interface TriageCardMenuTarget {
  id: string
  goalId: string
}

export function buildTriageCardMenu(target: TriageCardMenuTarget): MenuModel {
  void target
  return {
    surface: "triage.card",
    items: [
      item("triage.confirm", L.triage.confirm),
      item("triage.proposeConfirm", L.triage.proposeConfirm),
      item("triage.proposeReject", L.triage.proposeReject),
      item("triage.viewGoal", L.triage.viewGoal),
      sep(),
      item("triage.dismiss", L.triage.dismiss, { danger: true, confirms: true }),
    ],
  }
}

export interface AutomationCardMenuTarget {
  id: string
  enabled: boolean
}

export function buildAutomationCardMenu(target: AutomationCardMenuTarget): MenuModel {
  return {
    surface: "automation.card",
    items: [
      item("automation.toggle", target.enabled ? L.automation.disable : L.automation.enable),
      item("automation.copyId", L.automation.copyId),
      sep(),
      item("automation.delete", L.automation.delete, { danger: true, confirms: true }),
    ],
  }
}
