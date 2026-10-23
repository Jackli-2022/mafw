import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { activeTodoIndex, displayStatus, mergeHiddenTodos } from "./todo-presenter"

describe("mergeHiddenTodos（整表重写时保留未完成项提示）", () => {
  const pendingA = { content: "A", status: "pending" }
  const runningB = { content: "B", status: "in_progress" }
  const doneC = { content: "C", status: "completed" }

  test("上一版未完成、这一版消失 → 进入 hidden", () => {
    expect(mergeHiddenTodos([], [pendingA, runningB], [{ content: "D", status: "pending" }]))
      .toEqual([pendingA, runningB])
  })

  test("已完成项消失不提示", () => {
    expect(mergeHiddenTodos([], [doneC], [{ content: "D", status: "pending" }])).toEqual([])
  })

  test("重新出现在当前列表 → 从 hidden 移除；已累积的其他项保留", () => {
    const hidden = [pendingA, runningB]
    expect(mergeHiddenTodos(hidden, [pendingA], [pendingA, { content: "D", status: "pending" }]))
      .toEqual([runningB])
  })

  test("列表被清空：未完成项仍进入提示，已完成项不进入", () => {
    expect(mergeHiddenTodos([], [pendingA, doneC], [])).toEqual([pendingA])
  })

  test("不重复累积同一 content（trim 归一）", () => {
    const hidden = [{ content: " A ", status: "pending" }]
    expect(mergeHiddenTodos(hidden, [pendingA], [{ content: "D", status: "pending" }]))
      .toEqual(hidden)
  })
})

describe("单 in_progress 高亮", () => {
  test("activeTodoIndex 取第一个 in_progress", () => {
    expect(activeTodoIndex([{ status: "pending" }, { status: "in_progress" }, { status: "in_progress" }])).toBe(1)
    expect(activeTodoIndex([{ status: "pending" }])).toBe(-1)
    expect(activeTodoIndex(null)).toBe(-1)
  })

  test("后续 in_progress 在展示层降级为 pending（数据不变）", () => {
    const todos = [
      { content: "a", status: "in_progress" },
      { content: "b", status: "in_progress" },
      { content: "c", status: "completed" },
    ]
    expect(displayStatus(todos, 0)).toBe("in_progress")
    expect(displayStatus(todos, 1)).toBe("pending")
    expect(displayStatus(todos, 2)).toBe("completed")
    // 原数组未被修改
    expect(todos[1].status).toBe("in_progress")
  })
})

// 接线契约：纯函数必须真的被 UI/数据流调用
describe("todo presenter wiring", () => {
  const dir = import.meta.dirname
  test("MafwShell：todo 更新统一走 applyTodos（SSE + 历史水合），并下传 hiddenTodos", () => {
    const src = readFileSync(join(dir, "MafwShell.tsx"), "utf8")
    expect(src).toContain("setTodos: (sid, list) => applyTodos(sid, list)")
    expect(src).toContain("applyTodos(sessionID, arr)")
    expect(src).toContain("mergeHiddenTodos(hiddenTodos[sid] || [], prev, next)")
    expect(src).toContain("hiddenTodos={hiddenTodos}")
  })
  test("TaskBar/TaskList：单 in_progress + 未完成项提示已接线", () => {
    const bar = readFileSync(join(dir, "components/TaskBar.tsx"), "utf8")
    expect(bar).toContain("activeTodoIndex(props.todos)")
    expect(bar).toContain("mafw-taskbar-hidden")
    const list = readFileSync(join(dir, "components/TaskList.tsx"), "utf8")
    expect(list).toContain("displayStatus(props.todos")
    expect(list).toContain("mafw-task-hidden")
    const pane = readFileSync(join(dir, "components/ChatPane.tsx"), "utf8")
    expect(pane).toContain("hiddenCount={(props.hiddenTodos?.[sidProp()] || []).length}")
  })
})
