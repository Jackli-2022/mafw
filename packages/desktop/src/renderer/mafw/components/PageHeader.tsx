// @ts-nocheck
import { Show } from "solid-js"

export function PageHeader(props: { title: string; subtitle?: string; actions?: any }) {
  return (
    <div class="mafw-page-header">
      <div class="mafw-page-header-text">
        <h2 class="mafw-page-title">{props.title}</h2>
        <Show when={props.subtitle}>
          <div class="mafw-page-subtitle">{props.subtitle}</div>
        </Show>
      </div>
      <Show when={props.actions}>
        <div class="mafw-page-header-actions">{props.actions}</div>
      </Show>
    </div>
  )
}
