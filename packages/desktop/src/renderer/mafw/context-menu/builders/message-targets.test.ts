import { describe, expect, test } from "bun:test"
import { buildMessageMenu } from "./message"
import { ids } from "../test-helpers"
import { validateMenu } from "../model"

const base = { id: "m", role: "assistant" as const, hasText: true, canFork: false, tts: false }

describe("message target-specific actions", () => {
  test("image target adds copy-image and copy-image-url", () => {
    const m = buildMessageMenu({ ...base, imageURL: "mafw-file://x/a.png" })
    expect(ids(m)).toEqual([
      "message.copyImage",
      "message.copyImageUrl",
      "message.copy",
      "message.copyMarkdown",
      "message.quote",
    ])
    expect(validateMenu(m)).toEqual([])
  })

  test("external link target adds copy-link and open-link", () => {
    const m = buildMessageMenu({ ...base, linkURL: "https://example.com" })
    expect(ids(m)).toEqual([
      "message.copyLink",
      "message.openLink",
      "message.copy",
      "message.copyMarkdown",
      "message.quote",
    ])
    expect(validateMenu(m)).toEqual([])
  })

  test("no target-specific fields keep the base menu", () => {
    expect(ids(buildMessageMenu(base))).toEqual(["message.copy", "message.copyMarkdown", "message.quote"])
  })
})
