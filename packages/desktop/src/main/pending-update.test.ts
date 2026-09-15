import { describe, expect, test } from "bun:test"
import { buildUpdateToken, atomicWriteToken } from "./pending-update"

describe("pending update token", () => {
  test("builds the gateway self-update token", () => {
    const token = buildUpdateToken("desktop 按钮触发", "1.19.0")
    expect(token.target).toBe("gateway")
    expect(token.action).toBe("update")
    expect(token.reason).toContain("desktop 按钮触发")
    expect(token.reason).toContain("1.19.0")
    expect(typeof token.requestedAt).toBe("number")
  })

  test("serializes to valid JSON for the token watcher", () => {
    const json = JSON.stringify(buildUpdateToken("r"))
    const parsed = JSON.parse(json)
    expect(parsed.target).toBe("gateway")
    expect(parsed.action).toBe("update")
  })

  test("atomic write: tmp first, then rename; content matches", async () => {
    const ops: string[] = []
    const files = new Map<string, string>()
    const io = {
      writeFile: async (p: string, data: string) => { ops.push(`write:${p}`); files.set(p, data) },
      rename: async (from: string, to: string) => { ops.push(`rename:${from}->${to}`); files.set(to, files.get(from)!); files.delete(from) },
    }
    await atomicWriteToken("/home/.mafw/pending-restart.json", buildUpdateToken("t"), io)
    expect(ops[0]).toBe("write:/home/.mafw/pending-restart.json.tmp")
    expect(ops[1]).toBe("rename:/home/.mafw/pending-restart.json.tmp->/home/.mafw/pending-restart.json")
    expect(files.get("/home/.mafw/pending-restart.json")).toBeTruthy()
    expect(files.has("/home/.mafw/pending-restart.json.tmp")).toBe(false)
  })

  test("write failure leaves the old token untouched", async () => {
    const files = new Map<string, string>([["/x/pending-restart.json", "OLD"]])
    const io = {
      writeFile: async () => { throw new Error("disk full") },
      rename: async () => { throw new Error("should not rename") },
    }
    await expect(atomicWriteToken("/x/pending-restart.json", buildUpdateToken("t"), io)).rejects.toThrow("disk full")
    expect(files.get("/x/pending-restart.json")).toBe("OLD")
  })
})
