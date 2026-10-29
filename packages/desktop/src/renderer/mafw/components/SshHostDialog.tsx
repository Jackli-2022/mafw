// SSH host form: saved profile + optional password/passphrase (spec §8.2).
// Secrets stay in component state and are handed to main once on save.
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { SelectV2 } from "@mafw/ui/v2/select-v2"
import { Switch as SwitchV2 } from "@mafw/ui/v2/switch-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import type { SshAuthMethod, SshHostProfile, SshHostProfileInput, SshSecretInput } from "../../../shared/ssh-host"
import { validateSshHostProfile } from "../../../shared/ssh-host"

const AUTH_OPTIONS: SshAuthMethod[] = ["password", "key", "agent"]
const authLabel = (auth: SshAuthMethod) =>
  auth === "password" ? "密码" : auth === "key" ? "私钥" : "SSH Agent"

export function SshHostDialog(props: {
  open: boolean
  initial?: SshHostProfile
  hosts: SshHostProfile[]
  onCancel: () => void
  onSave: (input: SshHostProfileInput, secret?: SshSecretInput) => void
  onTest: (input: SshHostProfileInput, secret?: SshSecretInput) => Promise<{ ok: boolean; error?: string }>
}) {
  const [name, setName] = createSignal("")
  const [group, setGroup] = createSignal("")
  const [host, setHost] = createSignal("")
  const [port, setPort] = createSignal("22")
  const [username, setUsername] = createSignal("")
  const [auth, setAuth] = createSignal<SshAuthMethod>("password")
  const [privateKeyPath, setPrivateKeyPath] = createSignal("")
  const [jumpHostId, setJumpHostId] = createSignal("")
  const [autoReconnect, setAutoReconnect] = createSignal(true)
  const [keepalive, setKeepalive] = createSignal("15")
  const [password, setPassword] = createSignal("")
  const [passphrase, setPassphrase] = createSignal("")
  const [savePassword, setSavePassword] = createSignal(true)
  const [savePassphrase, setSavePassphrase] = createSignal(true)
  const [showErrors, setShowErrors] = createSignal(false)
  const [testing, setTesting] = createSignal(false)
  const [testResult, setTestResult] = createSignal<{ ok: boolean; error?: string } | null>(null)

  createEffect(() => {
    if (!props.open) return
    const h = props.initial
    setName(h?.name ?? "")
    setGroup(h?.group && h.group !== "未分组" ? h.group : "")
    setHost(h?.host ?? "")
    setPort(String(h?.port ?? 22))
    setUsername(h?.username ?? "")
    setAuth(h?.auth ?? "password")
    setPrivateKeyPath(h?.privateKeyPath ?? "")
    setJumpHostId(h?.jumpHostId ?? "")
    setAutoReconnect(h?.autoReconnect ?? true)
    setKeepalive(String(h?.keepaliveSeconds ?? 15))
    setPassword("")
    setPassphrase("")
    setSavePassword(h?.hasPassword ?? true)
    setSavePassphrase(h?.hasPassphrase ?? true)
    setShowErrors(false)
    setTesting(false)
    setTestResult(null)
  })

  const input = (): SshHostProfileInput => ({
    ...(props.initial ? { id: props.initial.id } : {}),
    name: name(),
    group: group(),
    host: host(),
    port: Number(port()),
    username: username(),
    auth: auth(),
    ...(auth() === "key" ? { privateKeyPath: privateKeyPath() } : {}),
    jumpHostId: jumpHostId() || null,
    autoReconnect: autoReconnect(),
    keepaliveSeconds: Number(keepalive()),
  })

  const validation = () => validateSshHostProfile(input(), { hosts: props.hosts })
  const errors = () => {
    const result = validation()
    return result.ok ? [] : result.errors
  }

  const secret = (): SshSecretInput => {
    const out: SshSecretInput = {}
    if (auth() === "password") {
      if (password()) out.password = password()
      if (!savePassword() && props.initial?.hasPassword) out.clearPassword = true
    }
    if (auth() === "key") {
      if (passphrase()) out.passphrase = passphrase()
      if (!savePassphrase() && props.initial?.hasPassphrase) out.clearPassphrase = true
    }
    return out
  }

  const jumpOptions = () => {
    const ids = props.hosts
      .filter((h) => h.id !== props.initial?.id && !h.jumpHostId)
      .map((h) => h.id)
    return ["", ...ids]
  }
  const jumpLabel = (id: string) => {
    if (!id) return "直连"
    return props.hosts.find((h) => h.id === id)?.name ?? "未知主机"
  }

  const save = () => {
    setShowErrors(true)
    if (!validation().ok) return
    props.onSave(input(), secret())
  }

  const test = async () => {
    setShowErrors(true)
    setTestResult(null)
    if (!validation().ok) return
    setTesting(true)
    try {
      setTestResult(await props.onTest(input(), secret()))
    } catch (err: any) {
      setTestResult({ ok: false, error: err?.message ?? String(err) })
    }
    setTesting(false)
  }

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && props.open) props.onCancel()
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  return (
    <Show when={props.open}>
      <div class="mafw-host-dialog-backdrop" onClick={props.onCancel}>
        <div
          class="mafw-host-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={props.initial ? "编辑 SSH 主机" : "新建 SSH 主机"}
          onClick={(e) => e.stopPropagation()}
        >
          <header class="mafw-host-dialog-head">
            <div>
              <div class="mafw-host-dialog-title">{props.initial ? "编辑 SSH 主机" : "新建 SSH 主机"}</div>
              <div class="mafw-host-dialog-sub">密码与口令经系统钥匙串加密，不会写入配置文件</div>
            </div>
            <ButtonV2 variant="ghost" size="small" aria-label="关闭" onClick={props.onCancel}>
              关闭
            </ButtonV2>
          </header>

          <div class="mafw-host-form">
            <div class="mafw-host-form-grid">
              <label class="mafw-host-field">
                <span>名称</span>
                <TextInputV2 value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder="prod-01" />
              </label>
              <label class="mafw-host-field">
                <span>分组</span>
                <TextInputV2 value={group()} onInput={(e) => setGroup(e.currentTarget.value)} placeholder="生产（可空）" />
              </label>
            </div>
            <div class="mafw-host-form-grid is-address">
              <label class="mafw-host-field">
                <span>主机</span>
                <TextInputV2 value={host()} onInput={(e) => setHost(e.currentTarget.value)} placeholder="10.0.0.12 或 host.example.com" />
              </label>
              <label class="mafw-host-field is-port">
                <span>端口</span>
                <TextInputV2 type="number" value={port()} onInput={(e) => setPort(e.currentTarget.value)} />
              </label>
            </div>
            <div class="mafw-host-form-grid">
              <label class="mafw-host-field">
                <span>用户名</span>
                <TextInputV2 value={username()} onInput={(e) => setUsername(e.currentTarget.value)} placeholder="deploy" />
              </label>
              <label class="mafw-host-field">
                <span>认证方式</span>
                <SelectV2
                  options={AUTH_OPTIONS}
                  current={auth()}
                  value={(x) => x}
                  label={(x) => authLabel(x)}
                  onSelect={(v) => v && setAuth(v)}
                />
              </label>
            </div>

            <Show when={auth() === "password"}>
              <label class="mafw-host-field">
                <span>密码</span>
                <TextInputV2
                  type="password"
                  value={password()}
                  onInput={(e) => setPassword(e.currentTarget.value)}
                  placeholder={props.initial?.hasPassword ? "已保存（留空保持不变）" : "输入密码"}
                />
              </label>
              <label class="mafw-host-toggle">
                <SwitchV2 checked={savePassword()} onChange={setSavePassword}>
                  保存密码（系统钥匙串）
                </SwitchV2>
              </label>
            </Show>

            <Show when={auth() === "key"}>
              <label class="mafw-host-field">
                <span>私钥路径</span>
                <TextInputV2
                  value={privateKeyPath()}
                  onInput={(e) => setPrivateKeyPath(e.currentTarget.value)}
                  placeholder="~/.ssh/id_ed25519"
                />
              </label>
              <label class="mafw-host-field">
                <span>私钥口令（可选）</span>
                <TextInputV2
                  type="password"
                  value={passphrase()}
                  onInput={(e) => setPassphrase(e.currentTarget.value)}
                  placeholder={props.initial?.hasPassphrase ? "已保存（留空保持不变）" : "加密私钥的口令"}
                />
              </label>
              <label class="mafw-host-toggle">
                <SwitchV2 checked={savePassphrase()} onChange={setSavePassphrase}>
                  保存口令（系统钥匙串）
                </SwitchV2>
              </label>
            </Show>

            <div class="mafw-host-form-grid">
              <label class="mafw-host-field">
                <span>跳板机</span>
                <SelectV2
                  options={jumpOptions()}
                  current={jumpHostId()}
                  value={(x) => x}
                  label={jumpLabel}
                  onSelect={(v) => setJumpHostId(v == null ? "" : v)}
                  placeholder="直连"
                />
              </label>
              <label class="mafw-host-field">
                <span>保活间隔（秒）</span>
                <TextInputV2
                  type="number"
                  value={keepalive()}
                  onInput={(e) => setKeepalive(e.currentTarget.value)}
                  placeholder="15"
                />
              </label>
            </div>

            <label class="mafw-host-toggle">
              <SwitchV2 checked={autoReconnect()} onChange={setAutoReconnect}>
                断开后自动重连（最多 5 次）
              </SwitchV2>
            </label>

            <Show when={showErrors() && errors().length > 0}>
              <div class="mafw-host-form-error" role="alert">
                <For each={errors()}>{(error) => <div>{error}</div>}</For>
              </div>
            </Show>
            <Show when={testResult()}>
              {(result) => (
                <div class={`mafw-host-test-result ${result().ok ? "is-ok" : "is-error"}`} role="status">
                  {result().ok ? "连接成功，认证与主机指纹正常。" : `连接失败：${result().error ?? "未知错误"}`}
                </div>
              )}
            </Show>
          </div>

          <footer class="mafw-host-dialog-foot">
            <ButtonV2 variant="ghost" size="small" onClick={props.onCancel}>
              取消
            </ButtonV2>
            <div class="mafw-host-dialog-foot-right">
              <ButtonV2 variant="outline" size="small" disabled={testing()} onClick={() => void test()}>
                {testing() ? "测试中…" : "测试连接"}
              </ButtonV2>
              <ButtonV2 variant="contrast" size="small" onClick={save}>
                保存
              </ButtonV2>
            </div>
          </footer>
        </div>
      </div>
    </Show>
  )
}
