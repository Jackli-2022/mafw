/**
 * Dev vs packaged managed-gateway spawn.
 *
 * Packaged Desktop ships a gateway payload rebuilt for Electron's Node ABI and
 * runs it with the Electron binary (`ELECTRON_RUN_AS_NODE=1`). A dev checkout
 * keeps the repository's Node-ABI `better-sqlite3`; running it under Electron's
 * Node fails with `NODE_MODULE_VERSION` mismatch, so dev uses the system Node
 * (`MAFW_NODE_BIN`, npm's `npm_node_execpath`, or `node` on PATH).
 */
export interface ManagedGatewaySpawnPlan {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
}

export function planManagedGatewaySpawn(input: {
  packaged: boolean
  execPath: string
  nodeBin?: string
  entry: string
  env: NodeJS.ProcessEnv
}): ManagedGatewaySpawnPlan {
  const env = { ...input.env }
  if (input.packaged) {
    env.ELECTRON_RUN_AS_NODE = "1"
    return { command: input.execPath, args: [input.entry], env }
  }
  delete env.ELECTRON_RUN_AS_NODE
  return { command: input.nodeBin || "node", args: [input.entry], env }
}
