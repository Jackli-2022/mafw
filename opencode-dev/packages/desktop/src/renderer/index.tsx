import "@opencode-ai/ui/styles"
import "@opencode-ai/session-ui/styles"
import { render } from "solid-js/web"
import { MafwShell } from "./mafw/MafwShell"

const root = document.getElementById("root")
if (!root) throw new Error("Root element not found")

console.log("[mafw] rendering MafwShell")
try {
  render(() => <MafwShell />, root!)
  console.log("[mafw] render complete")
} catch (e) {
  console.error("[mafw] render error", e)
  root.innerHTML = `<pre style="color:#e8636b;padding:20px;font-size:13px">MAFW render error: ${(e as Error).message}\n${(e as Error).stack}</pre>`
}
