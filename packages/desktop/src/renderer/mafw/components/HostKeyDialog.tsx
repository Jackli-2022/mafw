// TOFU host-key dialog. Changed keys are dangerous and default to cancel.
import { Show, createEffect } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import type { HostKeyRequest } from "../../../shared/terminal-session"

export function HostKeyDialog(props: {
  request: HostKeyRequest | null
  onRespond: (action: "trust" | "trust-and-save" | "replace" | "reject") => void
}) {
  let cancelButton: HTMLButtonElement | undefined

  createEffect(() => {
    if (!props.request) return
    queueMicrotask(() => cancelButton?.focus())
  })

  return (
    <Show when={props.request}>
      {(request) => (
        <div class="mafw-hostkey-backdrop">
          <div
            class={`mafw-hostkey-dialog ${request().kind === "changed" ? "is-danger" : ""}`}
            role="alertdialog"
            aria-modal="true"
            aria-label={request().kind === "changed" ? "SSH 主机指纹已变化" : "首次连接 SSH 主机"}
          >
            <header class="mafw-hostkey-head">
              <div class="mafw-hostkey-title">
                {request().kind === "changed" ? "主机指纹已变化" : "首次连接，确认主机指纹"}
              </div>
              <div class="mafw-hostkey-host">
                {request().host}:{request().port}
              </div>
            </header>

            <div class="mafw-hostkey-body">
              <div class="mafw-hostkey-row">
                <span>算法</span>
                <code>{request().keyType}</code>
              </div>
              <div class="mafw-hostkey-row">
                <span>{request().kind === "changed" ? "新指纹" : "指纹"}</span>
                <code class="mafw-hostkey-fingerprint">{request().fingerprint}</code>
              </div>
              <Show when={request().kind === "changed" && request().oldFingerprint}>
                {(old) => (
                  <div class="mafw-hostkey-row is-old">
                    <span>已保存指纹</span>
                    <code class="mafw-hostkey-fingerprint">{old()}</code>
                  </div>
                )}
              </Show>
              <p class="mafw-hostkey-hint">
                {request().kind === "changed"
                  ? "如果这不是你刚更换的主机密钥，可能有人正在拦截连接。默认拒绝。"
                  : "指纹会保存到本机 known_hosts；之后只有一致时才自动连接。"}
              </p>
            </div>

            <footer class="mafw-hostkey-foot">
              <ButtonV2
                ref={cancelButton}
                variant="ghost"
                size="small"
                onClick={() => props.onRespond("reject")}
              >
                取消
              </ButtonV2>
              <Show
                when={request().kind === "changed"}
                fallback={
                  <div class="mafw-hostkey-actions">
                    <ButtonV2 variant="outline" size="small" onClick={() => props.onRespond("trust")}>
                      仅本次信任
                    </ButtonV2>
                    <ButtonV2 variant="contrast" size="small" onClick={() => props.onRespond("trust-and-save")}>
                      信任并保存
                    </ButtonV2>
                  </div>
                }
              >
                <ButtonV2 variant="danger" size="small" onClick={() => props.onRespond("replace")}>
                  仍然替换并保存
                </ButtonV2>
              </Show>
            </footer>
          </div>
        </div>
      )}
    </Show>
  )
}
