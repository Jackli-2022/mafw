import type { GatewayInstanceRecord } from "./gateway-instance-record"

/**
 * A registered old instance can only survive across a desktop restart, so the
 * in-memory child/record globals are empty. Adopt the probed registration first
 * or terminateManagedInstance has nothing to kill and the port wait will fail.
 */
export async function stopRegisteredReplacement(input: {
  registered: GatewayInstanceRecord | null
  adopt(record: GatewayInstanceRecord): void
  terminate(): Promise<void>
}): Promise<void> {
  if (input.registered) input.adopt(input.registered)
  await input.terminate()
}
