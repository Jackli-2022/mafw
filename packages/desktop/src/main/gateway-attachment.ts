export interface GatewayAttachmentView {
  attached: boolean
  attachedOrigin: string | null
}

/**
 * "Attached" means this desktop is using a gateway it did not spawn.
 *
 * The distinction matters for the dev flow: attaching to a running gateway is
 * valid only after a successful handshake, and the UI must say so instead of
 * presenting someone else's process as the managed one.
 */
export function resolveGatewayAttachment(input: {
  ready: boolean
  spawnedByUs: boolean
  distribution?: string | null
}): GatewayAttachmentView {
  if (!input.ready || input.spawnedByUs) {
    return { attached: false, attachedOrigin: null }
  }
  const origin = input.distribution?.trim()
  return { attached: true, attachedOrigin: origin ? origin : null }
}
