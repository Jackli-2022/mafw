import { For, Show, createSignal, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { Icon } from "@mafw/ui/icon"
import type { AgentContract } from "../agent-contract"
import "../agent-contract.css"

/** Goal 总览里的代理契约：授权级别、裁量、升级、审计与人类专属边界。 */
export function AgentContractCard(props: {
  contract: AgentContract
}): JSX.Element {
  const [open, setOpen] = createSignal(false)

  return (
    <section class="mafw-agent-contract" data-level={props.contract.level}>
      <div class="mafw-agent-contract-head">
        <span class="mafw-agent-contract-title">代理契约</span>
        <span class="mafw-agent-contract-level">
          {props.contract.level} · {props.contract.levelLabel}
        </span>
        <ButtonV2
          variant="ghost"
          size="small"
          class="mafw-agent-contract-toggle"
          aria-label={open() ? "收起代理契约" : "展开代理契约"}
          aria-expanded={open()}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="chevron-right" size="small" />
        </ButtonV2>
      </div>

      <Show when={open()}>
        <div class="mafw-agent-contract-body">
          <div class="mafw-agent-contract-row">
            <span class="mafw-agent-contract-label">Mandate</span>
            <span class="mafw-agent-contract-value">{props.contract.mandate}</span>
          </div>
          <div class="mafw-agent-contract-row">
            <span class="mafw-agent-contract-label">Discretion</span>
            <span class="mafw-agent-contract-value">{props.contract.discretion}</span>
          </div>
          <div class="mafw-agent-contract-row">
            <span class="mafw-agent-contract-label">Escalation</span>
            <span class="mafw-agent-contract-value">
              <For each={props.contract.escalation}>
                {(item) => <span class="mafw-agent-contract-chip">{item}</span>}
              </For>
            </span>
          </div>
          <div class="mafw-agent-contract-row">
            <span class="mafw-agent-contract-label">Audit</span>
            <span class="mafw-agent-contract-value">
              <For each={props.contract.audit}>
                {(item) => <span class="mafw-agent-contract-chip">{item}</span>}
              </For>
            </span>
          </div>
          <div class="mafw-agent-contract-human">
            <span class="mafw-agent-contract-label">人类专属</span>
            <span class="mafw-agent-contract-value">
              <For each={props.contract.humanOnly}>
                {(item) => <span class="mafw-agent-contract-chip is-human">{item}</span>}
              </For>
            </span>
          </div>
        </div>
      </Show>
    </section>
  )
}
