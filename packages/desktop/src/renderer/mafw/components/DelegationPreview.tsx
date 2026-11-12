import { For, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import type { DelegationPreview as DelegationPreviewView } from "../delegation-preview"
import "../delegation-preview.css"

const FIELDS: readonly { key: keyof DelegationPreviewView; label: string }[] = [
  { key: "principal", label: "委托人" },
  { key: "agent", label: "受托人" },
  { key: "scope", label: "范围" },
  { key: "intent", label: "意图" },
  { key: "constraints", label: "约束" },
  { key: "acceptance", label: "验收" },
  { key: "discretion", label: "裁量" },
  { key: "escalation", label: "升级" },
  { key: "budget", label: "预算" },
  { key: "evidence", label: "证据" },
  { key: "termination", label: "终止" },
  { key: "audit", label: "审计" },
]

/** 委托单预览：确认前不创建、不启动 Goal。 */
export function DelegationPreview(props: {
  preview: DelegationPreviewView
  busy: boolean
  onConfirm: () => void
  onBack: () => void
}): JSX.Element {
  return (
    <div class="mafw-delegation-preview">
      <div class="mafw-delegation-preview-head">
        <span>委托单</span>
        <span class="mafw-delegation-preview-level">授权级别 {props.preview.autonomy.level}</span>
      </div>

      <div class="mafw-delegation-preview-grid">
        <For each={FIELDS}>
          {(field) => (
            <div class="mafw-delegation-preview-row" data-field={field.key}>
              <span class="mafw-delegation-preview-label">{field.label}</span>
              <span class="mafw-delegation-preview-value">{String(props.preview[field.key])}</span>
            </div>
          )}
        </For>
      </div>

      <div class="mafw-delegation-autonomy">
        <span class="mafw-delegation-autonomy-label">{props.preview.autonomy.label}</span>
        <span class="mafw-delegation-autonomy-note">{props.preview.autonomy.note}</span>
      </div>

      <div class="mafw-delegation-preview-actions">
        <ButtonV2 variant="ghost" size="small" onClick={() => props.onBack()} disabled={props.busy}>
          返回修改
        </ButtonV2>
        <ButtonV2
          variant="contrast"
          size="small"
          disabled={props.busy}
          onClick={() => props.onConfirm()}
        >
          {props.busy ? "创建中…" : "确认并创建"}
        </ButtonV2>
      </div>
    </div>
  )
}
