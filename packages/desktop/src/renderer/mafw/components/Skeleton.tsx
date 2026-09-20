// @ts-nocheck
import { For } from "solid-js"

export function Skeleton(props: { w?: string; h?: string; r?: string }) {
  return (
    <div
      class="mafw-skeleton"
      style={{
        width: props.w || "100%",
        height: props.h || "14px",
        ...(props.r ? { "border-radius": props.r } : {}),
      }}
    />
  )
}

export function SkeletonRows(props: { rows?: number; h?: string }) {
  const n = () => props.rows || 3
  return (
    <div class="mafw-skeleton-rows">
      <For each={Array.from({ length: n() })}>
        {() => <Skeleton h={props.h || "40px"} />}
      </For>
    </div>
  )
}
