// Task 9: one declarative config page backed by a package load/save action.
//
// Contract:
//   - the restricted JSON Schema subset is projected into text/number/boolean/
//     select fields only; secret and unsupported fields never render;
//   - load/save capture the plugin generation and page identity before awaiting
//     and discard stale responses;
//   - the form is disabled while a request is pending;
//   - a dirty draft is never submitted after the package revision changes:
//     it is marked stale and the user must reload.
import { For, Show, createEffect, createMemo } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { SelectV2 } from "@mafw/ui/v2/select-v2"
import { Switch as SwitchV2 } from "@mafw/ui/v2/switch-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import type {
  PluginClientDescriptor,
  PluginConfigPageDescriptor,
} from "@mafw/plugin-contract"
import { isPluginGenerationCurrent, pluginGeneration } from "./plugin-store"
import {
  createPluginConfigController,
  formFields,
  type ConfigField,
  type ConfigFormValues,
  type ConfigSelectOption,
} from "./plugin-config-form"

export function PluginConfigPage(props: {
  descriptor: PluginClientDescriptor
  page: PluginConfigPageDescriptor
  sessionID?: string | null
}) {
  const controller = createPluginConfigController({
    schema: () => props.page.schema,
    identity: () => ({ revision: props.descriptor.revision, pageId: props.page.id }),
    load: () =>
      window.api.mafw.plugins.invoke(
        props.descriptor.name,
        props.page.loadAction,
        {},
        props.sessionID ?? undefined,
      ),
    save: (values) =>
      window.api.mafw.plugins.invoke(
        props.descriptor.name,
        props.page.saveAction,
        values,
        props.sessionID ?? undefined,
      ),
    reload: () => window.api.mafw.plugins.reload(props.descriptor.name),
    reloadOnSave: () => props.page.reloadOnSave === true,
    generation: () => pluginGeneration(),
    isGenerationCurrent: (generation) => isPluginGenerationCurrent(generation),
    onError: (message) =>
      showToastV2({ description: message, variant: "error", duration: 4000 } as any),
  })

  const state = controller.state
  const fields = createMemo(() => formFields(props.page.schema))
  const pending = () => state().status === "loading" || state().status === "saving"
  const saveDisabled = () => pending() || state().stale || fields().length === 0

  // Identity effect: only descriptor revision + page id are tracked. Controller
  // bookkeeping is untracked, so settling state never re-triggers this effect.
  createEffect(() => {
    const revision = props.descriptor.revision
    const pageId = props.page.id
    controller.checkIdentity(revision, pageId)
  })

  return (
    <div
      class="mafw-plugin-config-page"
      style={{
        flex: "1",
        "min-height": "0",
        "overflow-y": "auto",
        padding: "12px",
        display: "flex",
        "flex-direction": "column",
        gap: "12px",
      }}
    >
      <div style={{ display: "flex", "flex-direction": "column", gap: "2px" }}>
        <div style={{ "font-size": "13px", "font-weight": "600", color: "var(--text-strong)" }}>
          {props.page.title || props.descriptor.title || props.page.id}
        </div>
        <div style={{ "font-size": "12px", color: "var(--text-weak)" }}>
          {props.descriptor.title || props.descriptor.name}
        </div>
      </div>

      <Show when={state().stale}>
        <div class="mafw-plugin-config-banner" data-tone="warning">
          <span>插件已更新，当前草稿基于旧配置，请重新加载后再保存。</span>
          <ButtonV2
            variant="outline"
            size="small"
            disabled={pending()}
            onClick={() => void controller.reload()}
          >
            重新加载
          </ButtonV2>
        </div>
      </Show>

      <Show when={state().error}>
        <div class="mafw-plugin-config-banner" data-tone="error">
          {state().error}
        </div>
      </Show>

      <Show when={state().errors.length > 0}>
        <div class="mafw-plugin-config-banner" data-tone="error">
          <For each={state().errors}>{(error) => <div>{error}</div>}</For>
        </div>
      </Show>

      <Show
        when={state().status !== "loading" && state().status !== "idle"}
        fallback={
          <div class="mafw-config-inline-loading">
            <LoaderV2 width={14} height={14} /> 加载中…
          </div>
        }
      >
        <Show
          when={fields().length > 0}
          fallback={<div class="mafw-empty">该配置页没有可显示的字段</div>}
        >
          <div style={{ display: "flex", "flex-direction": "column", gap: "10px" }}>
            <For each={fields()}>
              {(field) => (
                <ConfigFieldRow
                  field={field}
                  value={state().values[field.name]}
                  disabled={pending()}
                  onChange={(value) => controller.setValue(field.name, value)}
                />
              )}
            </For>
          </div>
        </Show>
      </Show>

      <div
        style={{
          display: "flex",
          gap: "8px",
          "align-items": "center",
          "padding-top": "4px",
        }}
      >
        <ButtonV2
          variant="contrast"
          size="small"
          disabled={saveDisabled()}
          onClick={() => void controller.save()}
        >
          {state().status === "saving" ? "保存中…" : "保存"}
        </ButtonV2>
        <ButtonV2
          variant="outline"
          size="small"
          disabled={pending()}
          onClick={() => void controller.reload()}
        >
          重新加载
        </ButtonV2>
        <Show when={state().status === "saving"}>
          <span class="mafw-config-inline-loading">
            <LoaderV2 width={12} height={12} />
          </span>
        </Show>
      </div>
    </div>
  )
}

function ConfigFieldRow(props: {
  field: ConfigField
  value: ConfigFormValues[string] | undefined
  disabled: boolean
  onChange: (value: string | number | boolean) => void
}) {
  return (
    <div class="mafw-plugin-config-field" style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
      <div style={{ display: "flex", gap: "4px", "align-items": "baseline" }}>
        <span style={{ "font-size": "12px", color: "var(--text-strong)" }}>{props.field.label}</span>
        <Show when={props.field.required}>
          <span style={{ "font-size": "11px", color: "var(--danger, #e5484d)" }}>必填</span>
        </Show>
      </div>
      <Show when={props.field.description}>
        <div style={{ "font-size": "11px", color: "var(--text-weak)" }}>{props.field.description}</div>
      </Show>
      <Show
        when={props.field.kind === "boolean"}
        fallback={
          <Show
            when={props.field.kind === "select"}
            fallback={
              <Show
                when={props.field.kind === "text"}
                fallback={
                  <TextInputV2
                    type="number"
                    numeric
                    aria-label={props.field.label}
                    value={String(props.value ?? 0)}
                    min={props.field.minimum}
                    max={props.field.maximum}
                    step={props.field.kind === "integer" ? "1" : "any"}
                    disabled={props.disabled}
                    onInput={(event) => {
                      const next = Number(event.currentTarget.value)
                      props.onChange(Number.isFinite(next) ? next : 0)
                    }}
                  />
                }
              >
                <TextInputV2
                  type="text"
                  aria-label={props.field.label}
                  value={String(props.value ?? "")}
                  minLength={props.field.minLength}
                  maxLength={props.field.maxLength}
                  disabled={props.disabled}
                  onInput={(event) => props.onChange(event.currentTarget.value)}
                />
              </Show>
            }
          >
            <SelectField field={props.field} value={props.value} disabled={props.disabled} onChange={props.onChange} />
          </Show>
        }
      >
        <SwitchV2
          checked={props.value === true}
          disabled={props.disabled}
          onChange={(checked: boolean) => props.onChange(checked === true)}
        />
      </Show>
    </div>
  )
}

function SelectField(props: {
  field: ConfigField
  value: ConfigFormValues[string] | undefined
  disabled: boolean
  onChange: (value: string | number | boolean) => void
}) {
  const options = (): ConfigSelectOption[] => props.field.options
  const current = () => options().find((option) => option.value === props.value)
  return (
    <SelectV2<ConfigSelectOption>
      options={options()}
      current={current()}
      value={(option) => String(option.value)}
      label={(option) => option.label}
      disabled={props.disabled}
      onSelect={(option) => {
        if (option) props.onChange(option.value)
      }}
    />
  )
}
