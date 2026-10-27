// Office 预览（xlsx/docx/pptx，2026-10-27 G9-G11）：解析库全部动态 import（懒加载，不打开不下载）。
// 数据走 mafw-file:// + fetch(arrayBuffer)（复用协议，不新增 IPC、不受文本 1MB 闸）。
import { Show, createEffect, createMemo, createSignal, onCleanup, For } from "solid-js"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { extractSheetRows, type SheetTable } from "../office-table"
import { a1Ref } from "../annotation-anchor"
import { slideIndexOf } from "../pptx-slide"

export type OfficeKind = "xlsx" | "docx" | "pptx"

type SheetState = { name: string; table: SheetTable }

export function OfficePreview(props: {
  kind: OfficeKind
  url: string
  rel: string
  onOpenExternal: () => void
  /** xlsx 单元格批注（预览批注 T6）：sheet + A1 + 当前值。 */
  onAnnotateCell?: (a: { sheet?: string; ref: string; value: string }, rect: { left: number; top: number; bottom: number }) => void
  /** pptx 图钉批注（预览批注 T8）：页码 + 归一化坐标 + 点击点（viewport）。 */
  onAnnotateRegion?: (a: { x: number; y: number; w: number; h: number; slide: number }, point: { clientX: number; clientY: number }) => void
  /** 已有批注标记（M4）：pptx 页面上渲染编号钉。 */
  pins?: { x: number; y: number; slide?: number; status: "pending" | "responded" }[]
  onOpenReview?: () => void
}) {
  const [phase, setPhase] = createSignal<"idle" | "loading" | "ready" | "error">("idle")
  const [error, setError] = createSignal("")
  const [sheets, setSheets] = createSignal<SheetState[]>([])
  const [activeSheet, setActiveSheet] = createSignal(0)
  let host: HTMLDivElement | undefined
  let runToken = 0

  const active = createMemo(() => sheets()[activeSheet()] ?? null)

  createEffect(() => {
    const kind = props.kind
    const url = props.url
    const token = ++runToken
    if (!url) return
    setPhase("loading")
    setError("")
    setSheets([])
    setActiveSheet(0)

    void (async () => {
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`读取失败（HTTP ${res.status}）`)
        const buf = await res.arrayBuffer()
        if (token !== runToken) return

        if (kind === "xlsx") {
          const mod: any = await import("exceljs/dist/exceljs.min.js")
          const ExcelJS = mod.default ?? mod
          const wb = new ExcelJS.Workbook()
          await wb.xlsx.load(buf)
          const next: SheetState[] = (wb.worksheets ?? []).map((ws: any) => ({
            name: String(ws.name ?? "Sheet"),
            table: extractSheetRows(ws),
          }))
          if (!next.length) throw new Error("工作簿为空")
          if (token !== runToken) return
          setSheets(next)
          setPhase("ready")
          return
        }

        if (!host) return
        if (kind === "docx") {
          const { renderAsync } = await import("docx-preview")
          if (token !== runToken || !host) return
          host.innerHTML = ""
          await renderAsync(buf, host, undefined, { inWrapper: true })
        } else {
          const { init } = await import("pptx-preview")
          if (token !== runToken || !host) return
          host.innerHTML = ""
          const width = Math.max(320, host.clientWidth || 800)
          const viewer = init(host, { width, height: Math.round(width * 0.5625) })
          await viewer.preview(buf)
        }
        if (token !== runToken) return
        setPhase("ready")
      } catch (e: any) {
        if (token !== runToken) return
        setError(String(e?.message ?? e).slice(0, 180))
        setPhase("error")
      }
    })()
  })

  onCleanup(() => {
    runToken++
    if (host) host.innerHTML = ""
  })

  // M4：把已有批注钉到 pptx 对应页（pptx-preview 自绘 DOM，用覆盖层追加节点）。
  createEffect(() => {
    const pins = props.pins ?? []
    phase() // 渲染完成后重画
    if (props.kind !== "pptx" || !host) return
    host.querySelectorAll(".mafw-pptx-pin").forEach((el) => el.remove())
    if (pins.length === 0) return
    const slides = Array.from(host.querySelectorAll(".pptx-preview-slide-wrapper")) as HTMLElement[]
    for (const pin of pins) {
      const slide = slides[(pin.slide ?? 1) - 1]
      if (!slide) continue
      if (getComputedStyle(slide).position === "static") slide.style.position = "relative"
      const el = document.createElement("div")
      el.className = `mafw-annot-pin mafw-pptx-pin${pin.status === "pending" ? " mafw-annot-pin-pending" : ""}`
      el.style.left = `${pin.x * 100}%`
      el.style.top = `${pin.y * 100}%`
      el.setAttribute("aria-label", pin.status === "pending" ? "批注处理中" : "批注已回应")
      el.addEventListener("click", (ev) => {
        ev.stopPropagation()
        props.onOpenReview?.()
      })
      slide.appendChild(el)
    }
  })

  return (
    <div class="mafw-office-preview">
      <Show when={phase() === "loading"}>
        <div class="mafw-office-loading">
          <LoaderV2 />
          <span>正在解析 {props.rel.split("/").pop()}…</span>
        </div>
      </Show>
      <Show when={phase() === "error"}>
        <div class="mafw-office-error">
          <div class="mafw-office-error-text">预览失败：{error()}</div>
          <ButtonV2 variant="outline" size="small" onClick={props.onOpenExternal}>在外部应用打开</ButtonV2>
        </div>
      </Show>

      <Show when={props.kind === "xlsx" && phase() === "ready"}>
        <div class="mafw-sheet-tabs" role="tablist" aria-label="工作表">
          <For each={sheets()}>
            {(s, i) => (
              <button
                class="mafw-sheet-tab"
                classList={{ "mafw-sheet-tab-active": activeSheet() === i() }}
                role="tab"
                aria-selected={activeSheet() === i()}
                onClick={() => setActiveSheet(i())}
              >
                {s.name}
              </button>
            )}
          </For>
        </div>
        <Show when={active()}>
          <div class="mafw-table-preview">
            <table class="mafw-table">
              <tbody>
                <For each={active()!.table.rows}>
                  {(row, ri) => (
                    <tr>
                      <For each={row}>
                        {(cell, ci) => {
                          const ref = () => a1Ref(ri() + 1, ci() + 1)
                          const click = (e: MouseEvent) => {
                            const el = e.currentTarget as HTMLElement
                            props.onAnnotateCell?.(
                              { sheet: active()?.name, ref: el.dataset.cellRef ?? "", value: el.textContent ?? "" },
                              el.getBoundingClientRect(),
                            )
                          }
                          return ri() === 0
                            ? <th data-cell-ref={ref()} onClick={click}>{cell}</th>
                            : <td data-cell-ref={ref()} onClick={click}>{cell}</td>
                        }}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
            <Show when={active()!.table.truncated}>
              <div class="mafw-table-note">已截断（上限：行 200 / 列 50）</div>
            </Show>
          </div>
        </Show>
      </Show>

      <div
        class="mafw-office-host"
        ref={(el) => { host = el }}
        data-annotatable={props.kind === "docx" ? "quote" : undefined}
        style={{ display: props.kind === "xlsx" ? "none" : "block" }}
        onClick={(e: MouseEvent) => {
          if (props.kind !== "pptx" || !props.onAnnotateRegion || !host) return
          const slideEl = (e.target as HTMLElement)?.closest?.(".pptx-preview-slide-wrapper") as HTMLElement | null
          if (!slideEl) return
          const slides = Array.from(host.querySelectorAll(".pptx-preview-slide-wrapper")) as HTMLElement[]
          const slide = slideIndexOf(slideEl, slides)
          if (slide <= 0) return
          const rect = slideEl.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) return
          const x = (e.clientX - rect.left) / rect.width
          const y = (e.clientY - rect.top) / rect.height
          if (x < 0 || x > 1 || y < 0 || y > 1) return
          props.onAnnotateRegion({ x, y, w: 0, h: 0, slide }, { clientX: e.clientX, clientY: e.clientY })
        }}
      />
    </div>
  )
}
