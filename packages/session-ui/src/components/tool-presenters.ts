import type { ToolProps } from "./message-part"
import type { ToolPresentation, ToolPresentationContext } from "./tool-presentation"
import { getDirectory, getFilename, relativePath } from "../util/path"

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

/** Pure row-tool presentations; Solid registrations point at this function. */
export function presentRowTool(tool: string, ctx: ToolPresentationContext): ToolPresentation {
  const input = ctx.props.input ?? {}
  switch (tool) {
    case "read":
      return {
        collapsed: { title: ctx.t("ui.tool.read"), object: pathLabel(readPathInput(input), ctx) },
        expanded: { body: "default" },
      }
    case "list":
      return {
        collapsed: { title: ctx.t("ui.tool.list"), object: pathLabel(readPathInput(input), ctx) },
        expanded: { body: "default" },
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
      return {
        collapsed: {
          title: ctx.t("ui.tool.grep"),
          object: stringInput(input, "pattern") ?? pathLabel(readPathInput(input), ctx),
          meta: include ? [{ text: `include=${include}` }] : undefined,
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
