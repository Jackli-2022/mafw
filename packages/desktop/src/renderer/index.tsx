import "@opencode-ai/ui/styles/tailwind"
import "@opencode-ai/ui/v2/styles/tailwind.css"
import "@opencode-ai/session-ui/styles"
import { ErrorBoundary } from "solid-js"
import { MemoryRouter, Route } from "@solidjs/router"
import { render } from "solid-js/web"
import { MafwShell } from "./mafw/MafwShell"

const root = document.getElementById("root")
if (!root) throw new Error("Root element not found")

function ErrorFallback(err: unknown, reset: () => void) {
  const msg = err instanceof Error ? err.message : String(err)
  const stack = err instanceof Error ? err.stack : ""
  console.error("[mafw] ErrorBoundary caught", err)
  return (
    <div
      style={
        "display:flex;flex-direction:column;align-items:center;justify-content:center;" +
        "height:100vh;font-family:system-ui,sans-serif;background:#0d0d0d;color:#e8636b;padding:32px;gap:16px;"
      }
    >
      <h2 style={{ "font-size": "18px", "font-weight": 600, margin: 0 }}>
        MAFW 渲染出错
      </h2>
      <pre
        style={
          "white-space:pre-wrap;word-break:break-word;font-size:12px;color:#aaa;" +
          "max-width:800px;overflow:auto;padding:12px;background:#1a1a1a;border-radius:6px;"
        }
      >
        {msg}
        {stack ? `\n\n${stack}` : ""}
      </pre>
      <button
        onClick={reset}
        style={
          "margin-top:8px;padding:8px 20px;border:1px solid #e8636b;border-radius:6px;" +
          "background:transparent;color:#e8636b;font-size:13px;cursor:pointer;"
        }
      >
        重试
      </button>
    </div>
  )
}

console.log("[mafw] rendering MafwShell")
try {
  render(
    () => (
      <ErrorBoundary fallback={ErrorFallback}>
        <MemoryRouter>
          <Route path="*" component={MafwShell} />
        </MemoryRouter>
      </ErrorBoundary>
    ),
    root!,
  )
  console.log("[mafw] render complete")
} catch (e) {
  console.error("[mafw] render error", e)
  root.innerHTML = `<pre style="color:#e8636b;padding:20px;font-size:13px">MAFW render error: ${(e as Error).message}\n${(e as Error).stack}</pre>`
}
