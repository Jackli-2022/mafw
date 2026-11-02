// Task 8: safe interpreter for the declarative Widget vocabulary.
//
// Widgets are plain JSON produced by the plugin Host through the gateway. This
// component never evaluates plugin code and never trusts markup: text/code are
// escaped by JSX, markdown is HTML-escaped before parsing, links and images are
// protocol-restricted, and unknown widget types degrade to readable text.
import { For, Show, type JSX } from "solid-js"
import { marked } from "marked"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import type { PluginView, Widget } from "@mafw/plugin-contract"
import { openImageLightbox } from "../image-lightbox"
import {
  actionWidgetInvocation,
  safePluginImageDataUrl,
  safePluginLinkHref,
  widgetFallbackText,
} from "./plugin-view-model"

export type PluginViewActionHandler = (action: string, input?: unknown) => void

export function PluginViewRenderer(props: {
  view: PluginView
  onAction: PluginViewActionHandler
}): JSX.Element {
  return (
    <div class="mafw-plugin-view" style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
      <Show when={props.view.title || props.view.subtitle}>
        <div style={{ display: "flex", "flex-direction": "column", gap: "2px" }}>
          <Show when={props.view.title}>
            <div style={{ "font-size": "13px", "font-weight": "600", color: "var(--text-strong)" }}>
              {props.view.title}
            </div>
          </Show>
          <Show when={props.view.subtitle}>
            <div style={{ "font-size": "12px", color: "var(--text-weak)" }}>{props.view.subtitle}</div>
          </Show>
        </div>
      </Show>
      <Show
        when={props.view.body.length > 0}
        fallback={<div class="mafw-tool-empty">（无内容）</div>}
      >
        <For each={props.view.body}>
          {(widget) => <WidgetNode widget={widget} onAction={props.onAction} />}
        </For>
      </Show>
    </div>
  )
}

function WidgetNode(props: { widget: Widget; onAction: PluginViewActionHandler }): JSX.Element {
  const widget = props.widget
  switch (widget.type) {
    case "text":
      return <div class="mafw-tool-result-text">{widget.text}</div>
    case "code":
      return (
        <pre class="mafw-tool-output" data-language={widget.language}>
          {widget.text}
        </pre>
      )
    case "kv":
      return (
        <div class="mafw-tool-meta-grid">
          <For each={widget.rows}>
            {([label, value]) => (
              <div class="mafw-tool-meta">
                <span class="mafw-tool-meta-label">{label}</span>
                {value}
              </div>
            )}
          </For>
        </div>
      )
    case "tags":
      return (
        <div class="mafw-tool-anchors">
          <For each={widget.items}>{(tag) => <span class="mafw-tool-chip">{tag}</span>}</For>
        </div>
      )
    case "list":
      return (
        <div class="mafw-tool-results" style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
          <For each={widget.items}>
            {(item) =>
              typeof item === "string" ? (
                <div class="mafw-tool-result">
                  <span class="mafw-tool-result-text">{item}</span>
                </div>
              ) : (
                <WidgetNode widget={item} onAction={props.onAction} />
              )
            }
          </For>
        </div>
      )
    case "row":
      return (
        <div style={{ display: "flex", gap: "8px", "align-items": "center", "flex-wrap": "wrap" }}>
          <For each={widget.children}>
            {(child) => <WidgetNode widget={child} onAction={props.onAction} />}
          </For>
        </div>
      )
    case "image": {
      const dataUrl = safePluginImageDataUrl(widget.dataUrl)
      if (!dataUrl) return <div class="mafw-tool-result-text">{widget.alt || "（图片不可用）"}</div>
      return (
        <a
          class="mafw-python-image"
          href={dataUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={widget.alt || "查看大图"}
          onClick={(event) => {
            event.preventDefault()
            openImageLightbox(dataUrl)
          }}
        >
          <img src={dataUrl} alt={widget.alt || "plugin image"} />
        </a>
      )
    }
    case "link": {
      const href = safePluginLinkHref(widget.href)
      if (!href) return <div class="mafw-tool-result-text">{widget.text}</div>
      return (
        <a class="mafw-tool-link" href={href} target="_blank" rel="noreferrer">
          {widget.text}
        </a>
      )
    }
    case "markdown": {
      // Escape raw HTML first, then let marked apply markdown syntax only.
      const escaped = widget.text.replace(
        /[&<>]/g,
        (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char] as string,
      )
      const html = marked.parse(escaped, { async: false }) as string
      return <div class="mafw-plugin-markdown" innerHTML={html} />
    }
    case "progress": {
      const value = Math.max(0, Math.min(100, widget.value))
      return (
        <div class="mafw-plugin-progress">
          <div class="mafw-plugin-progress-track">
            <div class="mafw-plugin-progress-fill" style={{ width: `${value}%` }} />
          </div>
          <span class="mafw-plugin-progress-label">{widget.label || `${Math.round(value)}%`}</span>
        </div>
      )
    }
    case "action": {
      const invocation = actionWidgetInvocation(widget)
      if (!invocation) return <div class="mafw-tool-result-text">{widget.label}</div>
      return (
        <div>
          <ButtonV2
            variant={widget.style === "primary" ? "contrast" : widget.style === "danger" ? "danger" : "outline"}
            size="small"
            onClick={() => props.onAction(invocation.action, invocation.input)}
          >
            {widget.label}
          </ButtonV2>
        </div>
      )
    }
    default:
      // Unknown/future widget: readable text, never executable markup.
      return <div class="mafw-tool-result-text">{widgetFallbackText(widget)}</div>
  }
}
