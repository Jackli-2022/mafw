import { describe, expect, test } from "bun:test"
import { patchFiles } from "./apply-patch-file"
import { text } from "./session-diff"

describe("apply patch file (canonical metadata.files)", () => {
  test("parses canonical patch entries from the server", () => {
    const file = patchFiles([
      {
        file: "a.ts",
        status: "modified",
        patch:
          "Index: a.ts\n===================================================================\n--- a.ts\t\n+++ a.ts\t\n@@ -1,2 +1,2 @@\n one\n-two\n+three\n",
        additions: 1,
        deletions: 1,
      },
    ])[0]

    expect(file).toBeDefined()
    expect(file?.file).toBe("a.ts")
    expect(file?.status).toBe("modified")
    expect(file?.view.fileDiff.name).toBe("a.ts")
    expect(file?.view.fileDiff.isPartial).toBe(false)
    expect(text(file!.view, "deletions")).toBe("one\ntwo\n")
    expect(text(file!.view, "additions")).toBe("one\nthree\n")
  })

  test("keeps canonical before/after payloads working", () => {
    const file = patchFiles([
      { file: "a.ts", status: "modified", before: "one\n", after: "two\n", additions: 1, deletions: 1 },
    ])[0]

    expect(file).toBeDefined()
    expect(text(file!.view, "deletions")).toBe("one\n")
    expect(text(file!.view, "additions")).toBe("two\n")
  })

  test("maps renamed status to modified and keeps movePath", () => {
    const file = patchFiles([{ file: "a.ts", status: "renamed", movePath: "b.ts", patch: "@@ -1 +1 @@\n-a\n+b\n" }])[0]
    expect(file?.status).toBe("modified")
    expect(file?.movePath).toBe("b.ts")
  })

  test("drops legacy rows that were not normalized by ingestion", () => {
    expect(patchFiles([{ filePath: "/tmp/a.ts", relativePath: "a.ts", type: "update", patch: "P" }])).toEqual([])
    expect(patchFiles([{ file: "a.ts" }])).toEqual([])
    expect(patchFiles(undefined)).toEqual([])
  })
})
