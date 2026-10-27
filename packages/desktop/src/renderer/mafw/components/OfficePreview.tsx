// Office 预览（xlsx/docx/pptx，2026-10-27 G9-G11）：解析库全部动态 import（懒加载，不打开不下载）。
// 数据走 mafw-file:// + fetch(arrayBuffer)（复用协议，不新增 IPC、不受文本 1MB 闸）。
import { Show, createEffect, createMemo, createSignal, onCleanup, For } from "solid-js"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { extractSheetRows, type SheetTable } from "../office-table"

export type OfficeKind = "xlsx" | "docx" | "pptx"

type SheetState = { name: string; table: SheetTable }

export function OfficePreview(props: { kind: OfficeKind; url: string; rel: string; onOpenExternal: () => void }) {
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
                        {(cell) => (ri() === 0 ? <th>{cell}</th> : <td>{cell}</td>)}
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
        style={{ display: props.kind === "xlsx" ? "none" : "block" }}
      />
    </div>
  )
}
