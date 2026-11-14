import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { PluginsPackageEntry } from "@mafw/sdk"
import type { PluginClientDescriptor } from "@mafw/plugin-contract"

import {
  buildPackageRows,
  buildPluginPackagesModel,
  contributionBadges,
  deleteConfirmation,
  disableConfirmation,
  enableConfirmation,
  installConfirmation,
  installPickResult,
  packageActions,
  packageDiagnosticsFor,
  packageStatus,
  packageStatusLabel,
  pendingApplyVisible,
  planInstallPreview,
  retainsActiveRevision,
  type PackageNotice,
  type PackageRowView,
} from "./plugin-packages-model"

function row(overrides: Partial<PluginsPackageEntry> = {}): PluginsPackageEntry {
  return {
    name: "demo",
    source: "C:/plugins/demo/index.js",
    status: "ok",
    enabled: true,
    contributions: [],
    version: "1.0.0",
    revision: "boot-a:3",
    ...overrides,
  }
}

function descriptor(overrides: Partial<PluginClientDescriptor> = {}): PluginClientDescriptor {
  return {
    name: "demo",
    version: "1.0.0",
    revision: "boot-a:3",
    ui: {},
    actions: [],
    events: [],
    ...overrides,
  }
}

const EMPTY_VIEW: PackageRowView = {
  name: "demo",
  source: "",
  status: "active",
  statusLabel: "已启用",
  enabled: true,
  contributions: [],
  actions: {
    apply: false,
    reload: true,
    disable: true,
    enable: false,
    remove: true,
    config: false,
    reveal: false,
  },
  retainsActiveRevision: false,
  diagnostics: [],
}

describe("plugin package status", () => {
  it("labels active, pending, error and disabled rows", () => {
    assert.equal(packageStatus(row()), "active")
    assert.equal(packageStatusLabel("active"), "已启用")

    const pending = row({ pendingRevision: "boot-a:4" })
    assert.equal(packageStatus(pending), "pending")
    assert.equal(packageStatusLabel("pending"), "待应用")

    const error = row({ status: "error", error: "boom" })
    assert.equal(packageStatus(error), "error")
    assert.equal(packageStatusLabel("error"), "错误")

    const disabled = row({ status: "disabled", enabled: false })
    assert.equal(packageStatus(disabled), "disabled")
    assert.equal(packageStatusLabel("disabled"), "已禁用")

    assert.equal(packageStatusLabel(packageStatus(pending)), "待应用")
  })

  it("keeps disabled ahead of error and pending", () => {
    const disabled = row({
      status: "error",
      enabled: false,
      error: "boom",
      pendingRevision: "boot-a:4",
    })
    assert.equal(packageStatus(disabled), "disabled")
  })

  it("keeps the active revision visible for a failed candidate", () => {
    const failed = row({ status: "error", error: "activation failed", revision: "boot-a:7" })
    assert.equal(retainsActiveRevision(failed), true)
    assert.equal(retainsActiveRevision(row({ status: "error", revision: undefined })), false)

    const rows = buildPackageRows([failed], [], [])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].status, "error")
    assert.equal(rows[0].error, "activation failed")
    assert.equal(rows[0].activeRevision, "boot-a:7")
    assert.equal(rows[0].retainsActiveRevision, true)
    // Commit failed but the previous activation still answers reload/disable.
    assert.equal(rows[0].actions.reload, true)
    assert.equal(rows[0].actions.disable, true)
  })
})

describe("plugin package contribution badges", () => {
  it("projects UI slots, actions, events and legacy kinds once", () => {
    const desc = descriptor({
      ui: {
        panels: [
          { id: "p1", title: "P1", viewAction: "view" },
          { id: "p2", title: "P2", viewAction: "view" },
        ],
        configPages: [
          { id: "c1", title: "C1", schema: { type: "object" }, loadAction: "load", saveAction: "save" },
        ],
        toolCards: [{ id: "t1", tools: ["bash"], viewAction: "view" }],
        messageWindows: [
          { id: "w1", title: "W1", triggerEvent: "plugin:demo:ping", viewAction: "view" },
          { id: "w2", title: "W2", triggerEvent: "plugin:demo:pong", viewAction: "view" },
        ],
      },
      actions: [
        { name: "view", title: "View", description: "View" },
        { name: "load", title: "Load", description: "Load" },
      ],
      events: [
        { type: "plugin:demo:ping", title: "Ping", description: "Ping" },
        { type: "plugin:demo:pong", title: "Pong", description: "Pong" },
        { type: "plugin:demo:done", title: "Done", description: "Done" },
      ],
    })
    const badges = contributionBadges(row({ contributions: ["runtime", "usage"] }), desc)
    assert.deepEqual(badges.map((badge) => badge.key), [
      "panel",
      "config-page",
      "tool-card",
      "message-window",
      "action",
      "event",
      "runtime",
      "usage",
    ])
    assert.deepEqual(badges.map((badge) => badge.label), [
      "面板 ×2",
      "配置页",
      "工具卡",
      "小窗 ×2",
      "动作 ×2",
      "事件 ×3",
      "Runtime",
      "用量",
    ])
  })

  it("shows a Web page count and the left-rail marker for web surfaces", () => {
    const badge = contributionBadges(
      row(),
      descriptor({
        ui: {
          webSurfaces: [
            {
              id: "tree",
              title: "Tree",
              entry: "index.html",
              scope: "session",
              reloadOnSessionChange: true,
              url: "/api/plugins/demo/ui/index.html",
              rail: { icon: "folder", order: 100, badge: true },
            },
          ],
        },
      }),
    )
    assert.deepEqual(badge, [
      { key: "web", label: "Web 页面 1" },
      { key: "rail", label: "左栏入口" },
    ])
  })

  it("counts web pages once and omits the rail marker without a rail entry", () => {
    const surface = (
      id: string,
      rail?: { icon: string; order: number; badge: boolean },
    ) => ({
      id,
      title: id,
      entry: "index.html",
      scope: "session" as const,
      reloadOnSessionChange: true,
      url: `/api/plugins/demo/ui/${id}/index.html`,
      ...(rail ? { rail } : {}),
    })
    const badges = contributionBadges(
      row(),
      descriptor({
        ui: {
          webSurfaces: [
            surface("a"),
            surface("b", { icon: "folder", order: 100, badge: false }),
          ],
        },
      }),
    )
    assert.deepEqual(badges, [
      { key: "web", label: "Web 页面 2" },
      { key: "rail", label: "左栏入口" },
    ])

    const withoutRail = contributionBadges(
      row(),
      descriptor({ ui: { webSurfaces: [surface("only")] } }),
    )
    assert.deepEqual(withoutRail, [{ key: "web", label: "Web 页面 1" }])
  })

  it("falls back to legacy contributions for a disabled package", () => {
    const badges = contributionBadges(
      row({ status: "disabled", enabled: false, contributions: ["media", "tts"] }),
      undefined,
    )
    assert.deepEqual(badges.map((badge) => badge.label), ["媒体", "语音"])
  })

  it("ignores unknown contribution kinds", () => {
    const badges = contributionBadges(row({ contributions: ["nope", "runtime"] }), undefined)
    assert.deepEqual(badges.map((badge) => badge.key), ["runtime"])
  })
})

describe("plugin package row assembly", () => {
  it("merges committed descriptors that the inventory omits", () => {
    const rows = buildPackageRows(
      [row({ name: "zeta" }), row({ name: "alpha" })],
      [descriptor({ name: "beta", revision: "boot-a:9" })],
      [],
    )
    assert.deepEqual(rows.map((view) => view.name), ["alpha", "beta", "zeta"])
    const beta = rows.find((view) => view.name === "beta")!
    assert.equal(beta.status, "active")
    assert.equal(beta.activeRevision, "boot-a:9")
    assert.equal(beta.actions.reload, true)
  })

  it("does not resurrect an inventory package that is disabled", () => {
    const rows = buildPackageRows(
      [row({ status: "disabled", enabled: false })],
      [descriptor()],
      [],
    )
    assert.equal(rows[0].status, "disabled")
    assert.equal(rows[0].actions.config, false)
    assert.equal(rows[0].actions.enable, true)
  })

  it("attaches package-scoped diagnostics and dedupes the row error", () => {
    const notices: PackageNotice[] = [
      { level: "error", message: "boom", code: "activation", package: "demo" },
      { level: "warning", message: "other", code: "x", package: "other" },
    ]
    const diagnostics = packageDiagnosticsFor(row({ status: "error", error: "boom" }), notices)
    assert.deepEqual(diagnostics.map((entry) => entry.message), ["boom"])
    assert.equal(diagnostics[0].code, "activation")

    const rows = buildPackageRows(
      [row({ status: "error", error: "boom" })],
      [],
      notices,
    )
    assert.equal(rows[0].diagnostics.length, 1)
  })
})

describe("plugin package pending apply visibility", () => {
  it("only offers apply when a pending revision exists", () => {
    const active = row()
    assert.equal(pendingApplyVisible(active), false)
    assert.equal(packageActions(active).apply, false)

    const pending = row({ pendingRevision: "boot-a:4" })
    assert.equal(pendingApplyVisible(pending), true)
    assert.equal(packageActions(pending).apply, true)

    const view = buildPackageRows([pending], [], [])[0]
    assert.equal(view.status, "pending")
    assert.equal(view.pendingRevision, "boot-a:4")
    assert.equal(view.actions.apply, true)
    assert.ok(typeof view.pendingReason === "string" && view.pendingReason.length > 0)
  })

  it("never offers apply on a disabled package even with a stale pending revision", () => {
    const disabled = row({ status: "disabled", enabled: false, pendingRevision: "boot-a:4" })
    assert.equal(pendingApplyVisible(disabled), false)
    assert.equal(packageActions(disabled).apply, false)
  })
})

describe("plugin package disabled actions", () => {
  it("only exposes enable/delete", () => {
    const disabled = row({ status: "disabled", enabled: false, source: "" })
    const actions = packageActions(disabled)
    assert.equal(actions.enable, true)
    assert.equal(actions.disable, false)
    assert.equal(actions.apply, false)
    assert.equal(actions.reload, false)
    assert.equal(actions.config, false)
    assert.equal(actions.remove, true)
    assert.equal(actions.reveal, false)
  })

  it("offers config and reveal only when they can work", () => {
    const withConfig = descriptor({
      ui: {
        configPages: [
          { id: "c1", title: "C1", schema: { type: "object" }, loadAction: "load", saveAction: "save" },
        ],
      },
    })
    const actions = packageActions(row(), withConfig)
    assert.equal(actions.config, true)
    assert.equal(actions.reveal, true)

    assert.equal(packageActions(row({ source: "" }), withConfig).reveal, false)
    assert.equal(packageActions(row(), descriptor()).config, false)
  })
})

describe("plugin package install preview", () => {
  it("summarizes an overwrite diff before replacing a package", () => {
    const existing = row({ version: "1.0.0", contributions: ["panel", "usage"] })
    const preview = planInstallPreview([existing], {
      ok: true,
      name: "demo",
      version: "2.0.0",
      contributions: ["usage", "config"],
    })
    assert.equal(preview.status, "ready")
    assert.equal(preview.overwrite, true)
    assert.equal(preview.name, "demo")
    assert.equal(preview.version, "2.0.0")
    assert.deepEqual(preview.diff, {
      added: ["config"],
      removed: ["panel"],
      unchanged: ["usage"],
      existingVersion: "1.0.0",
      nextVersion: "2.0.0",
      replacesActive: true,
      existingActiveRevision: "boot-a:3",
    })

    const confirmation = installConfirmation(preview)
    assert.ok(confirmation)
    assert.equal(confirmation!.confirmLabel, "覆盖安装")
    assert.match(confirmation!.title, /demo/)
    assert.match(confirmation!.message!, /1\.0\.0/)
    assert.match(confirmation!.message!, /2\.0\.0/)
    assert.match(confirmation!.message!, /config/)
    assert.match(confirmation!.message!, /panel/)
  })

  it("matches the installed package case-insensitively", () => {
    const preview = planInstallPreview(
      [row({ name: "Demo", version: "1.0.0" })],
      { ok: true, name: "demo", version: "1.0.1" },
    )
    assert.equal(preview.overwrite, true)
    assert.equal(preview.diff?.existingVersion, "1.0.0")
  })

  it("installs a fresh package without an overwrite confirmation", () => {
    const preview = planInstallPreview([], {
      ok: true,
      name: "fresh",
      version: "0.1.0",
      contributions: ["panel"],
    })
    assert.equal(preview.status, "ready")
    assert.equal(preview.overwrite, false)
    assert.equal(preview.diff, undefined)
    assert.equal(installConfirmation(preview), null)
  })

  it("install preview shows web surface and rail labels", () => {
    const preview = planInstallPreview([], {
      ok: true,
      name: "demo",
      version: "1.0.0",
      contributions: ["ui"],
      webSurfaces: { count: 2, rail: true },
    })
    assert.equal(preview.status, "ready")
    assert.deepEqual(preview.contributions, ["ui", "Web 页面 2", "左栏入口"])
  })

  it("shows the surface count without a rail entry and leaves the check untouched", () => {
    const contributions = ["actions", "ui"]
    const check = {
      ok: true,
      name: "demo",
      contributions,
      webSurfaces: { count: 1, rail: false },
    }
    const preview = planInstallPreview([], check)
    // The check result is a value the caller keeps: previews must not mutate it.
    assert.deepEqual(contributions, ["actions", "ui"])
    assert.equal(check.contributions, contributions)
    assert.deepEqual(preview.contributions, ["actions", "ui", "Web 页面 1"])
  })

  it("includes web surface and rail labels in the overwrite diff", () => {
    const existing = row({ contributions: ["ui"] })
    const preview = planInstallPreview([existing], {
      ok: true,
      name: "demo",
      contributions: ["ui"],
      webSurfaces: { count: 1, rail: false },
    })
    assert.deepEqual(preview.diff?.added, ["Web 页面 1"])
    assert.deepEqual(preview.diff?.removed, [])
    assert.deepEqual(preview.diff?.unchanged, ["ui"])
    assert.deepEqual(preview.contributions, ["ui", "Web 页面 1"])
    // The confirmation spells the new page out instead of "贡献声明无变化".
    const confirmation = installConfirmation(preview)
    assert.match(confirmation!.message!, /Web 页面 1/)
  })

  it("shows the rail label appearing (and disappearing) in the diff", () => {
    const added = planInstallPreview([row({ contributions: ["ui"] })], {
      ok: true,
      name: "demo",
      contributions: ["ui"],
      webSurfaces: { count: 2, rail: true },
    })
    assert.deepEqual(added.diff?.added, ["Web 页面 2", "左栏入口"])

    // If a previous inventory row recorded the rail label, dropping it shows up
    // as a removal instead of silently keeping "no change".
    const removed = planInstallPreview([row({ contributions: ["ui", "左栏入口"] })], {
      ok: true,
      name: "demo",
      contributions: ["ui"],
      webSurfaces: { count: 1, rail: false },
    })
    assert.ok(removed.diff?.removed.includes("左栏入口"))
  })

  it("keeps a failed check visible and blocks install", () => {
    const preview = planInstallPreview([], {
      ok: false,
      name: "broken",
      error: "manifest missing",
      contributions: ["panel"],
    })
    assert.equal(preview.status, "invalid")
    assert.equal(preview.error, "manifest missing")
    assert.equal(preview.overwrite, false)
    assert.equal(preview.contributions.length, 0)
    assert.equal(installConfirmation(preview), null)
  })

  it("rejects a check result without a package name", () => {
    const preview = planInstallPreview([], { ok: true, version: "1.0.0" })
    assert.equal(preview.status, "invalid")
    assert.match(preview.error!, /名称/)
  })

  it("treats a disabled installed package as replaceable but not active", () => {
    const preview = planInstallPreview(
      [row({ status: "disabled", enabled: false })],
      { ok: true, name: "demo", version: "2.0.0" },
    )
    assert.equal(preview.overwrite, true)
    assert.equal(preview.diff?.replacesActive, false)
  })
})

describe("plugin package directory picker", () => {
  it("treats an empty or cancelled picker result as cancelled", () => {
    assert.deepEqual(installPickResult(null), { status: "cancelled" })
    assert.deepEqual(installPickResult(undefined), { status: "cancelled" })
    assert.deepEqual(installPickResult({ path: null }), { status: "cancelled" })
    assert.deepEqual(installPickResult({ path: "" }), { status: "cancelled" })
  })

  it("returns the picked path or the picker failure", () => {
    assert.deepEqual(installPickResult({ path: "C:/src/demo" }), {
      status: "selected",
      path: "C:/src/demo",
    })
    assert.deepEqual(installPickResult({ error: "dialog failed" }), {
      status: "failed",
      error: "dialog failed",
    })
  })
})

describe("plugin package confirmations", () => {
  it("requires a destructive confirmation for delete", () => {
    const confirmation = deleteConfirmation({ ...EMPTY_VIEW, name: "demo", activeRevision: "boot-a:3" })
    assert.equal(confirmation.title, "删除插件包 demo？")
    assert.equal(confirmation.confirmLabel, "删除")
    assert.equal(confirmation.danger, true)
    assert.match(confirmation.message!, /不可恢复/)
    assert.match(confirmation.message!, /boot-a:3/)
  })

  it("confirms disable and enable without marking them destructive", () => {
    const disabled = disableConfirmation({ ...EMPTY_VIEW, name: "demo" })
    assert.match(disabled.title, /停用插件包 demo/)
    assert.equal(disabled.danger, false)
    assert.match(disabled.message!, /保留/)

    const enabled = enableConfirmation({ ...EMPTY_VIEW, name: "demo" })
    assert.match(enabled.title, /启用插件包 demo/)
    assert.equal(enabled.danger, false)
  })

  it("surfaces safe mode and quarantine without hiding rows", () => {
    const model = buildPluginPackagesModel({
      safeMode: true,
      packages: [
        { ...row({ name: "acme" }), state: "safe-mode", quarantinedReason: "integrity" } as any,
        { ...row({ name: "beta", enabled: false, status: "disabled" }) } as any,
      ],
    })
    assert.equal(model.safeMode, true)
    assert.deepEqual(model.rows.map((entry) => entry.name), ["acme", "beta"])
    assert.match(model.rows[0].badge ?? "", /safe-mode/)
    assert.match(model.banner ?? "", /safe mode|安全模式/)
  })

  it("maps trust and transport fields", () => {
    const model = buildPluginPackagesModel({
      safeMode: false,
      packages: [{
        ...row({ name: "acme" }),
        apiVersion: 2, kind: "untrusted", transport: "worker", permissions: ["actions"],
      } as any],
    })
    assert.equal(model.rows[0].kind, "untrusted")
    assert.equal(model.rows[0].transport, "worker")
    assert.deepEqual(model.rows[0].permissions, ["actions"])
  })
})
