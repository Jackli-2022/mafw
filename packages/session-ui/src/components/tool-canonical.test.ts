import { describe, expect, test } from "bun:test"
import { displayToolOf, isTopLevelToolEntry } from "./parts-rules"
import { resolveToolRender, CLASS_FAMILY, readPathInput } from "./tool-canonical"
import { registerTool } from "./tool-registry"
import { GenericTool } from "./basic-tool"

describe("canonical 翻译层（session-ui 消费面）", () => {
  test("displayToolOf：canonicalTool ?? tool", () => {
    expect(displayToolOf({ type: "tool", tool: "command_execution", canonicalTool: "bash" })).toBe("bash")
    expect(displayToolOf({ type: "tool", tool: "bash" })).toBe("bash")
    expect(displayToolOf({ type: "tool", tool: "x", canonicalTool: "" })).toBe("x")
  })

  test("resolveToolRender 四级链：原生名 > canonical > class 家族 > GenericTool", () => {
    // 自包含：message-part（真实内建卡注册处）经传递依赖无法在 bun test 加载——
    // 用探针注册覆盖各级（仅本文件进程内；无其他测试导入 message-part）
    const marker = () => null as any
    registerTool({ name: "zz_native_probe", render: marker })
    registerTool({ name: "zz_canonical_probe", render: marker })
    registerTool({ name: "bash", render: marker }) // CLASS_FAMILY['shell'] 的家族目标卡
    // 原生名直命中
    expect(resolveToolRender({ type: "tool", tool: "zz_native_probe" } as any)).toBe(marker)
    // canonical 命中：别名 → canonical（ls → list 需真实 list 卡，此处用探针对验证机制）
    expect(resolveToolRender({ type: "tool", tool: "alias_x", canonicalTool: "zz_canonical_probe" } as any)).toBe(marker)
    // canonical 恒等（canonicalTool === tool）不重复查
    expect(resolveToolRender({ type: "tool", tool: "zz_canonical_probe", canonicalTool: "zz_canonical_probe" } as any)).toBe(marker)
    // class 家族兜底（未注册名 + toolClass=shell → bash 卡）
    expect(resolveToolRender({ type: "tool", tool: "my_shell", toolClass: "shell" } as any)).toBe(marker)
    expect(CLASS_FAMILY["shell"]).toBe("bash")
    expect(CLASS_FAMILY["readonly"]).toBe("read")
    expect(CLASS_FAMILY["search"]).toBe("grep")
    expect(CLASS_FAMILY["file-edit"]).toBe("edit")
    expect(CLASS_FAMILY["subagent"]).toBe("task")
    expect(CLASS_FAMILY["web"]).toBe("webfetch")
    expect(CLASS_FAMILY["plan"]).toBe("todowrite")
    // 全 miss → GenericTool
    expect(resolveToolRender({ type: "tool", tool: "zz_mystery_tool" } as any)).toBe(GenericTool)
  })

  test("readPathInput 多 key：filePath ?? path ?? file_path（opencode/pi/Claude 键）", () => {
    expect(readPathInput({ filePath: "/a" })).toBe("/a")
    expect(readPathInput({ path: "/b" })).toBe("/b")
    expect(readPathInput({ file_path: "/c" })).toBe("/c")
    expect(readPathInput({ filePath: "/a", path: "/b" })).toBe("/a") // 优先序
    expect(readPathInput({})).toBeUndefined()
    expect(readPathInput(undefined)).toBeUndefined()
  })

  test("isTopLevelToolEntry：上下文组成员资格看 canonical（ls → list 进上下文组）", () => {
    expect(isTopLevelToolEntry({ type: "tool", tool: "ls", canonicalTool: "list" })).toBe(false)
    expect(isTopLevelToolEntry({ type: "tool", tool: "bash" })).toBe(true)
    expect(isTopLevelToolEntry({ type: "tool", tool: "find", canonicalTool: "glob" })).toBe(false)
  })
})
