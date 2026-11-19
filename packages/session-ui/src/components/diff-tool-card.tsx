// Body-only diff cards. `ToolCard` owns the one-line collapsed row; these
// components keep the existing file accordion, diff renderer, and diagnostics.
import { createEffect, createMemo, createSignal, For, Match, Show, Switch, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"
import { useFileComponent } from "@mafw/ui/context/file"
import { useI18n } from "@mafw/ui/context/i18n"
import { Accordion } from "@mafw/ui/accordion"
import { StickyAccordionHeader } from "@mafw/ui/sticky-accordion-header"
import { FileIcon } from "@mafw/ui/file-icon"
import { Icon } from "@mafw/ui/icon"
import { DiffChanges } from "@mafw/ui/diff-changes"
import { getDirectory, getFilename } from "../util/path"
import { checksum } from "../util/encode"
import { readPathInput } from "./tool-canonical"
import { patchFiles } from "./apply-patch-file"
import { resolveFileDiff } from "./session-diff"
import { canonicalMetadataFiles } from "./diff-tool-model"
import type { ToolProps } from "./message-part"

interface Diagnostic {
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  message: string
  severity?: number
}

function getDiagnostics(
  diagnosticsByFile: Record<string, Diagnostic[]> | undefined,
  filePath: string | undefined,
): Diagnostic[] {
  if (!diagnosticsByFile || !filePath) return []
  const diagnostics = diagnosticsByFile[filePath] ?? []
  return diagnostics.filter((d) => d.severity === 1).slice(0, 3)
}

function DiagnosticsDisplay(props: { diagnostics: Diagnostic[] }): JSX.Element {
  const i18n = useI18n()
  return (
    <Show when={props.diagnostics.length > 0}>
      <div data-component="diagnostics">
        <For each={props.diagnostics}>
          {(diagnostic) => (
            <div data-slot="diagnostic">
              <span data-slot="diagnostic-label">{i18n.t("ui.messagePart.diagnostic.error")}</span>
              <span data-slot="diagnostic-location">
                [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}]
              </span>
              <span data-slot="diagnostic-message">{diagnostic.message}</span>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}

export function ToolFileAccordion(props: { path: string; actions?: JSX.Element; children: JSX.Element }) {
  const value = createMemo(() => props.path || "tool-file")

  return (
    <Accordion
      multiple
      data-scope="apply-patch"
      style={{ "--sticky-accordion-offset": "calc(32px + var(--tool-content-gap))" }}
      defaultValue={[value()]}
    >
      <Accordion.Item value={value()}>
        <StickyAccordionHeader>
          <Accordion.Trigger>
            <div data-slot="apply-patch-trigger-content">
              <div data-slot="apply-patch-file-info">
                <FileIcon node={{ path: props.path, type: "file" }} />
                <div data-slot="apply-patch-file-name-container">
                  <Show when={props.path.includes("/")}>
                    <span data-slot="apply-patch-directory">{`\u202A${getDirectory(props.path)}\u202C`}</span>
                  </Show>
                  <span data-slot="apply-patch-filename">{getFilename(props.path)}</span>
                </div>
              </div>
              <div data-slot="apply-patch-trigger-actions">
                {props.actions}
                <Icon name="chevron-grabber-vertical" size="small" />
              </div>
            </div>
          </Accordion.Trigger>
        </StickyAccordionHeader>
        <Accordion.Content>{props.children}</Accordion.Content>
      </Accordion.Item>
    </Accordion>
  )
}

export function EditBody(props: ToolProps) {
  const fileComponent = useFileComponent()
  const filePath = createMemo(() => readPathInput(props.input))
  const diagnostics = createMemo(() => getDiagnostics(props.metadata.diagnostics, filePath()))
  const diffs = createMemo(() => canonicalMetadataFiles(props.metadata))
  const primary = createMemo(() => diffs()[0])
  const path = createMemo(() => primary()?.file || filePath() || "")
  const pending = () => props.status === "pending" || props.status === "running"
  const diffSource = createMemo(
    () => {
      const diff = primary()
      if (!diff) return
      return {
        file: diff.file || filePath() || "",
        patch: typeof diff.patch === "string" ? diff.patch : undefined,
        before: typeof diff.before === "string" ? diff.before : undefined,
        after: typeof diff.after === "string" ? diff.after : undefined,
      }
    },
    undefined,
    {
      equals: (a, b) => a?.file === b?.file && a?.patch === b?.patch && a?.before === b?.before && a?.after === b?.after,
    },
  )

  const fileCompProps = createMemo(() => {
    try {
      const source = diffSource()
      if (source) {
        const fileDiff = resolveFileDiff(source)
        if (fileDiff) return { fileDiff, hunkSeparators: fileDiff.isPartial ? "simple" : "line-info-basic" }
      }
    } catch {}

    return {
      before: {
        name: primary()?.file || filePath(),
        contents: primary()?.before || props.input.oldString || "",
      },
      after: {
        name: primary()?.file || filePath(),
        contents: primary()?.after || props.input.newString || "",
      },
    }
  })

  return (
    <div data-component="edit-tool" data-file-path={filePath()}>
      <Show when={path()}>
        <ToolFileAccordion
          path={path()}
          actions={
            <Show when={!pending() && primary()}>
              <DiffChanges changes={{ additions: primary()!.additions ?? 0, deletions: primary()!.deletions ?? 0 }} />
            </Show>
          }
        >
          <div data-component="edit-content">
            <Dynamic
              component={fileComponent}
              mode="diff"
              virtualize={props.virtualizeDiff}
              onRendered={props.onContentRendered}
              {...fileCompProps()}
            />
          </div>
        </ToolFileAccordion>
      </Show>
      <DiagnosticsDisplay diagnostics={diagnostics()} />
    </div>
  )
}

export function WriteBody(props: ToolProps) {
  const fileComponent = useFileComponent()
  const filePath = createMemo(() => readPathInput(props.input))
  const diagnostics = createMemo(() => getDiagnostics(props.metadata.diagnostics, filePath()))
  const path = createMemo(() => filePath() || canonicalMetadataFiles(props.metadata)[0]?.file || "")

  return (
    <div data-component="write-tool" data-file-path={filePath()}>
      <Show when={props.input.content && path()}>
        <ToolFileAccordion path={path()}>
          <div data-component="write-content">
            <Dynamic
              component={fileComponent}
              mode="text"
              file={{
                name: props.input.filePath,
                contents: props.input.content,
                cacheKey: checksum(props.input.content),
              }}
              overflow="scroll"
              onRendered={props.onContentRendered}
            />
          </div>
        </ToolFileAccordion>
      </Show>
      <DiagnosticsDisplay diagnostics={diagnostics()} />
    </div>
  )
}

export function ApplyPatchBody(props: ToolProps) {
  const i18n = useI18n()
  const fileComponent = useFileComponent()
  const files = createMemo(() => patchFiles(props.metadata.files))
  const single = createMemo(() => {
    const list = files()
    if (list.length !== 1) return
    return list[0]
  })
  const [expanded, setExpanded] = createSignal<string[]>([])
  let seeded = false

  createEffect(() => {
    const list = files()
    if (list.length === 0) return
    if (seeded) return
    seeded = true
    setExpanded(list.filter((f) => f.status !== "deleted").map((f) => f.file))
  })

  return (
    <Show
      when={single()}
      fallback={
        <div data-component="apply-patch-tool">
          <Show when={files().length > 0}>
            <Accordion
              multiple
              data-scope="apply-patch"
              style={{ "--sticky-accordion-offset": "calc(32px + var(--tool-content-gap))" }}
              value={expanded()}
              onChange={(value) => setExpanded(Array.isArray(value) ? value : value ? [value] : [])}
            >
              <For each={files()}>
                {(file) => {
                  const active = createMemo(() => expanded().includes(file.file))
                  const [visible, setVisible] = createSignal(false)

                  createEffect(() => {
                    if (!active()) {
                      setVisible(false)
                      return
                    }

                    requestAnimationFrame(() => {
                      if (!active()) return
                      setVisible(true)
                    })
                  })

                  return (
                    <Accordion.Item value={file.file} data-type={file.status === "added" ? "add" : file.status === "deleted" ? "delete" : file.movePath ? "move" : "update"}>
                      <StickyAccordionHeader>
                        <Accordion.Trigger>
                          <div data-slot="apply-patch-trigger-content">
                            <div data-slot="apply-patch-file-info">
                              <FileIcon node={{ path: file.file, type: "file" }} />
                              <div data-slot="apply-patch-file-name-container">
                                <Show when={file.file.includes("/")}>
                                  <span data-slot="apply-patch-directory">{`\u202A${getDirectory(file.file)}\u202C`}</span>
                                </Show>
                                <span data-slot="apply-patch-filename">{getFilename(file.file)}</span>
                              </div>
                            </div>
                            <div data-slot="apply-patch-trigger-actions">
                              <Switch>
                                <Match when={file.status === "added"}>
                                  <span data-slot="apply-patch-change" data-type="added">
                                    {i18n.t("ui.patch.action.created")}
                                  </span>
                                </Match>
                                <Match when={file.status === "deleted"}>
                                  <span data-slot="apply-patch-change" data-type="removed">
                                    {i18n.t("ui.patch.action.deleted")}
                                  </span>
                                </Match>
                                <Match when={!!file.movePath}>
                                  <span data-slot="apply-patch-change" data-type="modified">
                                    {i18n.t("ui.patch.action.moved")}
                                  </span>
                                </Match>
                                <Match when={true}>
                                  <DiffChanges changes={{ additions: file.additions, deletions: file.deletions }} />
                                </Match>
                              </Switch>
                              <Icon name="chevron-grabber-vertical" size="small" />
                            </div>
                          </div>
                        </Accordion.Trigger>
                      </StickyAccordionHeader>
                      <Accordion.Content>
                        <Show when={props.deferContent === false || visible()}>
                          <div data-component="apply-patch-file-diff">
                            <Dynamic
                              component={fileComponent}
                              mode="diff"
                              virtualize={props.virtualizeDiff}
                              fileDiff={file.view.fileDiff}
                              hunkSeparators={file.view.fileDiff.isPartial ? "simple" : "line-info-basic"}
                              onRendered={props.onContentRendered}
                            />
                          </div>
                        </Show>
                      </Accordion.Content>
                    </Accordion.Item>
                  )
                }}
              </For>
            </Accordion>
          </Show>
        </div>
      }
    >
      <div data-component="apply-patch-tool" data-file-path={single()!.file}>
        <ToolFileAccordion
          path={single()!.file}
          actions={
            <Switch>
              <Match when={single()!.status === "added"}>
                <span data-slot="apply-patch-change" data-type="added">
                  {i18n.t("ui.patch.action.created")}
                </span>
              </Match>
              <Match when={single()!.status === "deleted"}>
                <span data-slot="apply-patch-change" data-type="removed">
                  {i18n.t("ui.patch.action.deleted")}
                </span>
              </Match>
              <Match when={!!single()!.movePath}>
                <span data-slot="apply-patch-change" data-type="modified">
                  {i18n.t("ui.patch.action.moved")}
                </span>
              </Match>
              <Match when={true}>
                <DiffChanges changes={{ additions: single()!.additions, deletions: single()!.deletions }} />
              </Match>
            </Switch>
          }
        >
          <div data-component="apply-patch-file-diff">
            <Dynamic
              component={fileComponent}
              mode="diff"
              virtualize={props.virtualizeDiff}
              fileDiff={single()!.view.fileDiff}
              onRendered={props.onContentRendered}
            />
          </div>
        </ToolFileAccordion>
      </div>
    </Show>
  )
}
