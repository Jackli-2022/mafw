let pendingConstraints: string | null = null

export function setPendingConstraints(v: string | null): void {
  pendingConstraints = v
}

export function sessionSystemHook(input: any, output: any): any {
  if (pendingConstraints) {
    if (!output.system) output.system = []
    output.system.push(pendingConstraints)
    pendingConstraints = null
  }
  return output
}

