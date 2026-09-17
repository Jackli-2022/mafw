// @ts-nocheck
/** 语音分段上传 + 发送。store 操作经回调注入，本模块不认识 Solid store。 */
export async function uploadVoiceSegment(deps: {
  wavBytes: ArrayBuffer
  sessionID: string
  uploadAndCreate: (args: { bytes: ArrayBuffer; mediaType: string }) => Promise<{ id: string; contextId: string; artifactId: string }>
  sendEnriched: (args: { message: string; sessionID: string; parts: any[] }) => Promise<unknown>
}): Promise<{ pointerText: string; partId: string }> {
  const task = await deps.uploadAndCreate({ bytes: deps.wavBytes, mediaType: "audio/wav" })
  const ts = Date.now()
  const partId = `prt_media_${ts}_0`
  const pointerText = `[媒体附件 taskID: ${task.id} contextID: ${task.contextId} artifactId: ${task.artifactId}（媒体: voice-${ts}.wav），这是用户发给你的语音消息——调用 mafw_media_ask 工具获取其内容后，用 mafw_media_speak 工具以语音回复用户（taskID 填 ${task.id}）]`
  await deps.sendEnriched({
    message: "",
    sessionID: deps.sessionID,
    parts: [{ type: "text", id: partId, text: pointerText, synthetic: true }],
  })
  return { pointerText, partId }
}
