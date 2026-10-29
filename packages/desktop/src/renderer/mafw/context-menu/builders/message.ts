import { L } from "../labels"
import { item, sep } from "../model"
import type { MenuItem, MenuModel } from "../types"

export interface MessageMenuTarget {
  id: string
  role: "user" | "assistant"
  hasText: boolean
  canFork: boolean
  tts: boolean
  linkURL?: string
  imageURL?: string
}

export function buildMessageMenu(target: MessageMenuTarget): MenuModel {
  const disabled = target.hasText
    ? {}
    : { disabled: true, disabledReason: "没有可复制的文本" }
  const quoteDisabled = target.hasText
    ? {}
    : { disabled: true, disabledReason: "没有可引用的文本" }

  const targetItems: MenuItem[] = []
  if (target.imageURL) {
    targetItems.push(
      item("message.copyImage", L.message.copyImage),
      item("message.copyImageUrl", L.message.copyImageUrl),
    )
  }
  if (target.linkURL) {
    targetItems.push(
      item("message.copyLink", L.message.copyLink),
      item("message.openLink", L.message.openLink),
    )
  }

  const items: MenuItem[] = targetItems.length > 0
    ? [
        ...targetItems,
        sep(),
        item("message.copy", L.message.copy, disabled),
        item("message.copyMarkdown", L.message.copyMarkdown, disabled),
        item("message.quote", L.message.quote, quoteDisabled),
      ]
    : [
        item("message.copy", L.message.copy, disabled),
        item("message.copyMarkdown", L.message.copyMarkdown, disabled),
        item("message.quote", L.message.quote, quoteDisabled),
      ]

  if (target.role === "user" && target.canFork) {
    items.push(item("message.fork", L.message.fork))
  }
  if (target.role === "assistant" && target.tts) {
    items.push(item("message.readAloud", L.message.readAloud))
  }

  return { surface: "message", items }
}

export interface CodeBlockMenuTarget {
  code: string
}

export function buildCodeBlockMenu(target: CodeBlockMenuTarget): MenuModel {
  void target
  return {
    surface: "code-block",
    items: [
      item("code.copy", L.code.copy),
      item("code.copyMarkdown", L.code.copyMarkdown),
    ],
  }
}
