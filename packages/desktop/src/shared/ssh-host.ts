// SSH host profile vocabulary + validation (spec 2026-10-29 §8).
// Shared by the renderer form and main-side persistence; contains no secrets.

export type SshAuthMethod = "password" | "key" | "agent"

export type SshHostProfile = {
  id: string
  name: string
  group: string
  host: string
  port: number
  username: string
  auth: SshAuthMethod
  privateKeyPath?: string
  jumpHostId?: string | null
  autoReconnect: boolean
  keepaliveSeconds: number
  hasPassword?: boolean
  hasPassphrase?: boolean
  createdAt: number
  updatedAt: number
}

export type SshHostProfileInput = {
  id?: string
  name: string
  group: string
  host: string
  port: number
  username: string
  auth: SshAuthMethod
  privateKeyPath?: string
  jumpHostId?: string | null
  autoReconnect: boolean
  keepaliveSeconds: number
}

export type SshSecretInput = {
  password?: string
  passphrase?: string
  clearPassword?: boolean
  clearPassphrase?: boolean
}

export type KnownHostEntry = {
  host: string
  port: number
  keyType: string
  publicKey: string
  fingerprint: string
  addedAt: number
  lastSeenAt: number
}

export type SshHostValidation =
  | { ok: true; value: SshHostProfileInput }
  | { ok: false; errors: string[] }

const CONTROL = /[\u0000-\u001f\u007f]/
const WHITESPACE = /\s/

function bad(errors: string[], message: string): void {
  errors.push(message)
}

/** Stable known_hosts key. */
export function sshHostKey(host: string, port: number): string {
  return `${host}:${port}`
}

/** Validate and normalize a host profile before persistence or connection. */
export function validateSshHostProfile(
  input: SshHostProfileInput,
  opts: { hosts: Pick<SshHostProfile, "id" | "jumpHostId">[] },
): SshHostValidation {
  const errors: string[] = []
  if (input.id !== undefined && !String(input.id).trim()) bad(errors, "主机 id 不能为空")

  const name = String(input.name ?? "").trim()
  if (!name) bad(errors, "名称不能为空")
  else if (name.length > 64) bad(errors, "名称不能超过 64 个字符")
  else if (CONTROL.test(name)) bad(errors, "名称不能包含控制字符")

  const group = String(input.group ?? "").trim() || "未分组"
  if (group.length > 64) bad(errors, "分组不能超过 64 个字符")
  else if (CONTROL.test(group)) bad(errors, "分组不能包含控制字符")

  const host = String(input.host ?? "").trim()
  if (!host) bad(errors, "主机不能为空")
  else if (host.length > 255) bad(errors, "主机不能超过 255 个字符")
  else if (WHITESPACE.test(host) || CONTROL.test(host)) bad(errors, "主机不能包含空白或控制字符")

  const port = Number(input.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) bad(errors, "端口必须是 1-65535 的整数")

  const username = String(input.username ?? "").trim()
  if (!username) bad(errors, "用户名不能为空")
  else if (username.length > 64) bad(errors, "用户名不能超过 64 个字符")
  else if (WHITESPACE.test(username) || CONTROL.test(username)) bad(errors, "用户名不能包含空白或控制字符")

  if (input.auth !== "password" && input.auth !== "key" && input.auth !== "agent") {
    bad(errors, "认证方式不合法")
  }

  const privateKeyPath = String(input.privateKeyPath ?? "").trim()
  if (input.auth === "key" && !privateKeyPath) bad(errors, "密钥认证需要填写私钥路径")

  const jumpHostId = input.jumpHostId ? String(input.jumpHostId) : null
  if (jumpHostId) {
    const jump = opts.hosts.find((h) => h.id === jumpHostId)
    if (!jump) bad(errors, "跳板机不存在")
    else if (input.id && jump.id === input.id) bad(errors, "跳板机不能是自己")
    else if (jump.jumpHostId) bad(errors, "该主机自身使用跳板机，v1 不支持链式跳板")
  }

  const keepalive = Number(input.keepaliveSeconds)
  if (!Number.isInteger(keepalive) || keepalive < 0 || keepalive > 3600) {
    bad(errors, "保活间隔必须是 0-3600 的整数")
  }

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    value: {
      ...(input.id ? { id: input.id } : {}),
      name,
      group,
      host,
      port,
      username,
      auth: input.auth,
      ...(privateKeyPath ? { privateKeyPath } : {}),
      jumpHostId,
      autoReconnect: input.autoReconnect !== false,
      keepaliveSeconds: keepalive,
    },
  }
}
