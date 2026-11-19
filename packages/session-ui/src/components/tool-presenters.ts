import type { ToolProps } from "./message-part"
import type { ToolPresentation, ToolPresentationContext } from "./tool-presentation"
import { getDirectory, getFilename, relativePath } from "../util/path"
import { canonicalMetadataFiles, contentLineCount, diffMeta } from "./diff-tool-model"

function readPathInput(input: any): string | undefined {
  const value = input?.filePath ?? input?.path ?? input?.file_path
  return typeof value === "string" && value ? value : undefined
}

function webSearchProviderLabel(provider: unknown): string {
  if (provider === "parallel") return "Parallel Web Search"
  if (provider === "exa") return "Exa Web Search"
  return "Web Search"
}

function stringInput(input: any, key: string): string | undefined {
  const value = input?.[key]
  return typeof value === "string" && value ? value : undefined
}

function pathLabel(path: string | undefined, ctx: ToolPresentationContext): string | undefined {
  if (!path) return undefined
  if (ctx.mode === "context") return getFilename(path) || undefined
  return relativePath(path, ctx.directory) || getFilename(path) || undefined
}

/** First-party row tools migrated to presenters in Wave 1. */
export const PRESENTED_ROW_TOOLS = ["read", "list", "glob", "grep", "webfetch", "websearch", "bash"] as const

/** Pure row-tool presentations; Solid registrations point at this function. */
export function presentRowTool(tool: string, ctx: ToolPresentationContext): ToolPresentation {
  const input = ctx.props.input ?? {}
  switch (tool) {
    case "read": {
      const meta = []
      if (typeof input.offset === "number") meta.push({ text: `offset=${input.offset}` })
      if (typeof input.limit === "number") meta.push({ text: `limit=${input.limit}` })
      return {
        collapsed: {
          title: ctx.t("ui.tool.read"),
          object: pathLabel(readPathInput(input), ctx),
          meta: meta.length ? meta : undefined,
        },
        expanded: { body: "default" },
      }
    }
    case "list": {
      const path = readPathInput(input)
      return {
        collapsed: {
          title: ctx.t("ui.tool.list"),
          object: path
            ? ctx.mode === "context"
              ? getDirectory(path)
              : relativePath(path, ctx.directory) || getDirectory(path)
            : undefined,
        },
        expanded: { body: "default" },
      }
    }
    case "glob":
      return {
        collapsed: {
          title: ctx.t("ui.tool.glob"),
          object: stringInput(input, "pattern") ?? pathLabel(readPathInput(input), ctx),
          meta: readPathInput(input) ? [{ text: getDirectory(readPathInput(input)!) }] : undefined,
        },
        expanded: { body: "default" },
      }
    case "grep": {
      const include = stringInput(input, "include")
      const path = readPathInput(input)
      const meta = [
        ...(include ? [{ text: `include=${include}` }] : []),
        ...(path ? [{ text: getDirectory(path) }] : []),
      ]
      return {
        collapsed: {
          title: ctx.t("ui.tool.grep"),
          object: stringInput(input, "pattern") ?? pathLabel(path, ctx),
          meta: meta.length ? meta : undefined,
        },
        expanded: { body: "default" },
      }
    }
    case "webfetch": {
      const url = stringInput(input, "url")
      return {
        collapsed: { title: ctx.t("ui.tool.webfetch"), object: url },
        expanded: {
          body: "default",
          actions: url ? [{ kind: "link", href: url, label: url }] : undefined,
        },
      }
    }
    case "websearch":
      return {
        collapsed: {
          title: webSearchProviderLabel(ctx.props.metadata?.provider),
          object: stringInput(input, "query"),
        },
        expanded: { body: "default" },
      }
    case "bash":
      return {
        collapsed: { title: ctx.t("ui.tool.shell"), object: stringInput(input, "command") },
        expanded: { body: "terminal" },
      }
    default:
      return { collapsed: { title: tool }, expanded: { body: "default" } }
  }
}

/** Diff tools migrated to presenters in Wave 2. */
export const PRESENTED_DIFF_TOOLS = ["edit", "write", "apply_patch"] as const
export type PresentedDiffTool = (typeof PRESENTED_DIFF_TOOLS)[number]

/** Diff cards keep their existing bodies via `renderBody`; the row is unified. */
export function presentDiffTool(tool: PresentedDiffTool, ctx: ToolPresentationContext): ToolPresentation {
  const input = ctx.props.input ?? {}
  const files = canonicalMetadataFiles(ctx.props.metadata)
  const expanded = { body: "custom" as const }

  if (tool === "write") {
    const path = readPathInput(input) ?? files[0]?.file
    const additions = files[0]?.additions ?? contentLineCount(input.content)
    return {
      collapsed: {
        title: ctx.t("ui.messagePart.title.write"),
        object: pathLabel(path, ctx),
        meta: diffMeta(additions, files[0]?.deletions ?? 0),
      },
      expanded,
    }
  }

  if (tool === "apply_patch") {
    if (files.length === 0) {
      return { collapsed: { title: ctx.t("ui.tool.patch") }, expanded }
    }
    const additions = files.reduce((total, file) => total + (file.additions ?? 0), 0)
    const deletions = files.reduce((total, file) => total + (file.deletions ?? 0), 0)
    return {
      collapsed: {
        title: ctx.t("ui.tool.patch"),
        object: files.length === 1 ? pathLabel(files[0]!.file, ctx) : `${files.length} ${ctx.t("ui.common.file.other")}`,
        meta: diffMeta(additions, deletions),
      },
      expanded,
    }
  }

  const path = files[0]?.file ?? readPathInput(input)
  return {
    collapsed: {
      title: ctx.t("ui.messagePart.title.edit"),
      object: pathLabel(path, ctx),
      meta: diffMeta(files[0]?.additions ?? 0, files[0]?.deletions ?? 0),
    },
    expanded,
  }
}

/** Unknown MCP tools: one titled row + the generic expanded body. */
export function genericPresentation(props: ToolProps, ctx: ToolPresentationContext): ToolPresentation {
  const input: any = props.input ?? {}
  const object = ["description", "query", "url", "filePath", "path", "file_path", "pattern", "name"]
    .map((key) => input[key])
    .find((value) => typeof value === "string" && value.length > 0)
  return {
    collapsed: { title: props.tool, object },
    expanded: { body: "default" },
  }
}
