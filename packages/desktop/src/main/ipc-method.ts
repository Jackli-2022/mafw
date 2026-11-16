/**
 * Resolve a nested IPC method name (`"jobs.list"`) against a namespace object.
 * Pure so the dispatcher contract is testable without importing Electron.
 */
export function resolveIpcMethod(
  ns: Record<string, any>,
  method: string,
): ((...a: unknown[]) => unknown) | undefined {
  let cur: any = ns
  for (const part of method.split(".")) {
    if (cur == null) return undefined
    cur = cur[part]
  }
  return typeof cur === "function" ? (cur as (...a: unknown[]) => unknown) : undefined
}
