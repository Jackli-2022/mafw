export interface ResolvedPath {
  abs: string
  inRoot: boolean
}

export function isAbsolutePath(path: string): boolean {
  return /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(path)
}

export function hasParentEscape(path: string): boolean {
  return path.split(/[\\/]/).some((segment) => segment === "..")
}

export function resolvePath(root: string, rel: string): ResolvedPath {
  if (!rel) return { abs: "", inRoot: false }
  if (isAbsolutePath(rel)) return { abs: rel, inRoot: false }
  const abs = `${root.replace(/[\\/]+$/, "")}/${rel.replace(/^[\\/]+/, "")}`
  return { abs, inRoot: !hasParentEscape(rel) }
}
