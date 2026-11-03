// Truthful row-action feedback for unified plugin packages.
//
// The management UI must never claim more than the gateway actually did:
// - `application:'pending'` means the files were saved but the running package
//   (and therefore the UI) still uses the old revision;
// - a runtime package can apply while the runtime switch fails or is left to
//   the operator (`runtimeSwitch: 'failed' | 'required'`).
//
// Pure string logic so the wording is unit-testable without rendering.

export type PackageRuntimeSwitch = "applied" | "failed" | "required"

export interface PackageActionResultLike {
  name?: string
  application?: string
  pendingRevision?: string
  error?: string
  runtimeSwitch?: PackageRuntimeSwitch
  runtimeError?: string
}

export interface PackageActionMessage {
  description: string
  /** true → toast should use the error styling/longer duration. */
  isError: boolean
}

/**
 * @param result manager/route result (absent for void operations)
 * @param verb   short action verb, e.g. "应用" / "重新加载" / "启用" / "删除"
 */
export function describePackageAction(
  result: PackageActionResultLike | void | null,
  verb: string,
): PackageActionMessage {
  if (!result) return { description: `${verb}成功`, isError: false }

  const name = typeof result.name === "string" && result.name.length > 0 ? result.name : ""
  const target = name ? ` ${name}` : ""

  if (result.application === "failed") {
    return { description: `${verb}${target} 失败：${result.error ?? "未知错误"}`, isError: true }
  }

  if (result.application === "pending") {
    // Saved, not live: saying "成功" here is the exact lie the review found.
    return { description: `${verb}${target} 已保存，新版本待应用`, isError: false }
  }

  const done = `${verb}${target} 成功`
  if (result.runtimeSwitch === "applied") {
    return { description: `${done}（运行时已切换）`, isError: false }
  }
  if (result.runtimeSwitch === "failed") {
    return {
      description: `${done}，但切换运行时失败：${result.runtimeError ?? "未知错误"}`,
      isError: true,
    }
  }
  if (result.runtimeSwitch === "required") {
    return { description: `${done}，需手动切换运行时后生效`, isError: false }
  }
  return { description: done, isError: false }
}
