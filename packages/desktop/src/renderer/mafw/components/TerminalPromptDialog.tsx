// Keyboard-interactive / OTP prompt dialog (spec §6.5).
import { For, Show, createEffect, createSignal } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import type { PromptRequest } from "../../../shared/terminal-session"

export function TerminalPromptDialog(props: {
  request: PromptRequest | null
  onRespond: (answers: string[]) => void
}) {
  const [answers, setAnswers] = createSignal<string[]>([])

  createEffect(() => {
    const req = props.request
    setAnswers(req ? req.prompts.map(() => "") : [])
  })

  const update = (index: number, value: string) => {
    setAnswers((prev) => prev.map((v, i) => (i === index ? value : v)))
  }

  return (
    <Show when={props.request}>
      {(request) => (
        <div class="mafw-prompt-backdrop">
          <div class="mafw-prompt-dialog" role="dialog" aria-modal="true" aria-label="SSH 认证输入">
            <header class="mafw-prompt-head">
              <div class="mafw-prompt-title">{request().title}</div>
              <Show when={request().instructions}>
                {(text) => <div class="mafw-prompt-instructions">{text()}</div>}
              </Show>
            </header>
            <div class="mafw-prompt-body">
              <For each={request().prompts}>
                {(prompt, index) => (
                  <label class="mafw-host-field">
                    <span>{prompt.prompt}</span>
                    <TextInputV2
                      type={prompt.echo ? "text" : "password"}
                      value={answers()[index()] ?? ""}
                      autofocus={index() === 0}
                      onInput={(e) => update(index(), e.currentTarget.value)}
                    />
                  </label>
                )}
              </For>
            </div>
            <footer class="mafw-prompt-foot">
              <ButtonV2 variant="ghost" size="small" onClick={() => props.onRespond([])}>
                取消
              </ButtonV2>
              <ButtonV2 variant="contrast" size="small" onClick={() => props.onRespond(answers())}>
                继续
              </ButtonV2>
            </footer>
          </div>
        </div>
      )}
    </Show>
  )
}
