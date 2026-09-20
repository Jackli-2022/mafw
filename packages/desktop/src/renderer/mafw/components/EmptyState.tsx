// @ts-nocheck
import { Show } from "solid-js"

export function EmptyState(props: { glyph: string; title: string; hint?: string; action?: any }) {
  return (
    <div class="mafw-empty-state">
      <div class="mafw-empty-state-glyph" aria-hidden="true">{props.glyph}</div>
      <div class="mafw-empty-state-title">{props.title}</div>
      <Show when={props.hint}>
        <div class="mafw-empty-state-hint">{props.hint}</div>
      </Show>
      <Show when={props.action}>
        <div class="mafw-empty-state-action">{props.action}</div>
      </Show>
    </div>
  )
}
