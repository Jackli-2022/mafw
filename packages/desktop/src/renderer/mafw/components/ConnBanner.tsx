import { Show } from "solid-js"
import { useConnPhase } from "../connection-state"

/** Red banner shown while the gateway is DOWN (process exited, auto-restart
 *  in flight). Renders null in every other phase. */
export function ConnBanner() {
  const phase = useConnPhase()
  return (
    <Show when={phase() === "down"}>
      <div style={{
        background: "rgba(229, 72, 77, 0.12)",
        color: "#E5484D",
        padding: "6px 12px",
        "font-size": "12px",
        "text-align": "center",
        "flex-shrink": 0,
      }}>Gateway 已断开，正在自动重启…</div>
    </Show>
  )
}
