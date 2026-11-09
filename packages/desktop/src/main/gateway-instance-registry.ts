import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { parseGatewayInstanceRecord, type GatewayInstanceRecord } from "./gateway-instance-record"

export function gatewayInstanceRegistryRoot(homeDir = homedir()): string {
  return join(homeDir, ".mafw", "runtime", "desktop-gateway")
}

export function gatewayInstanceRecordPath(root: string, channel: string, instanceId: string): string {
  return join(root, channel, `${instanceId}.json`)
}

export async function readGatewayInstanceRecords(
  root: string,
  channel: string,
): Promise<GatewayInstanceRecord[]> {
  let names: string[]
  try {
    names = await readdir(join(root, channel))
  } catch {
    return []
  }
  const records: GatewayInstanceRecord[] = []
  for (const name of names) {
    if (!name.endsWith(".json") || name.startsWith(".tmp-")) continue
    try {
      const parsed = parseGatewayInstanceRecord(
        JSON.parse(await readFile(join(root, channel, name), "utf8")),
      )
      if (parsed) records.push(parsed)
    } catch {
      // A stale/corrupt registration is not ownership evidence.
    }
  }
  return records.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

export async function writeGatewayInstanceRecord(
  root: string,
  record: GatewayInstanceRecord,
): Promise<void> {
  const file = gatewayInstanceRecordPath(root, record.channel, record.instanceId)
  await mkdir(dirname(file), { recursive: true })
  const temp = join(dirname(file), `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, "utf8")
  try {
    await rename(temp, file)
  } catch (err) {
    await rm(temp, { force: true })
    throw err
  }
}

export async function removeGatewayInstanceRecord(
  root: string,
  record: Pick<GatewayInstanceRecord, "channel" | "instanceId">,
): Promise<void> {
  await rm(gatewayInstanceRecordPath(root, record.channel, record.instanceId), { force: true })
}
