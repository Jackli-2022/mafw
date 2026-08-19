import { messageHasAudio, voiceGuideMessagesHook, voiceGuideSystemHook, buildVoiceGuide } from '../../../src/hooks/voice-guide';

const AUDIO_POINTER = '[媒体附件 taskID: t1 contextID: c1（媒体: voice-1723.wav），查看这个媒体请调用 mafw_media_ask 工具（taskID 填 t1）]';
const IMAGE_POINTER = '[媒体附件 taskID: t2 contextID: c2（媒体: shot.png），查看这个媒体请调用 mafw_media_ask 工具（taskID 填 t2）]';

describe('voice-guide', () => {
  describe('messageHasAudio', () => {
    it('detects audio pointer parts (voice-*.wav)', () => {
      expect(messageHasAudio({ role: 'user', parts: [{ type: 'text', text: AUDIO_POINTER }] })).toBe(true)
    })

    it('detects generic audio extensions in pointers (.mp3/.m4a/.ogg)', () => {
      expect(messageHasAudio({ role: 'user', parts: [{ type: 'text', text: '[媒体附件 taskID: x contextID: y（媒体: note.mp3）]' }] })).toBe(true)
      expect(messageHasAudio({ role: 'user', parts: [{ type: 'text', text: '[媒体附件 taskID: x contextID: y（媒体: clip.m4a）]' }] })).toBe(true)
    })

    it('detects raw audio file parts by mime', () => {
      expect(messageHasAudio({ role: 'user', parts: [{ type: 'file', mediaType: 'audio/mpeg', url: 'file:///a.mp3' }] })).toBe(true)
    })

    it('rejects image pointers and text-only messages', () => {
      expect(messageHasAudio({ role: 'user', parts: [{ type: 'text', text: IMAGE_POINTER }] })).toBe(false)
      expect(messageHasAudio({ role: 'user', parts: [{ type: 'text', text: '普通文本' }] })).toBe(false)
      expect(messageHasAudio({ role: 'user', parts: [] })).toBe(false)
    })
  })

  describe('voiceGuideMessagesHook (state transitions)', () => {
    it('sets voice state on audio input and clears on plain text', () => {
      const audioOutput = { messages: [{ role: 'user', parts: [{ type: 'text', text: AUDIO_POINTER }] }] }
      voiceGuideMessagesHook({ sessionID: 's1' }, audioOutput)
      expect(voiceGuideSystemHook({ sessionID: 's1' }, { system: [] }).system.join('\n')).toContain('语音对话')

      const textOutput = { messages: [{ role: 'user', parts: [{ type: 'text', text: '纯文本问题' }] }] }
      voiceGuideMessagesHook({ sessionID: 's1' }, textOutput)
      const out = { system: [] }
      voiceGuideSystemHook({ sessionID: 's1' }, out)
      expect(out.system.join('\n')).not.toContain('语音对话')
    })

    it('ignores messages without a session and unknown sessions', () => {
      voiceGuideMessagesHook({}, { messages: [{ role: 'user', parts: [{ type: 'text', text: AUDIO_POINTER }] }] })
      const out = { system: [] }
      voiceGuideSystemHook({ sessionID: 'no-such' }, out)
      expect(out.system).toHaveLength(0)
    })
  })

  describe('voiceGuideSystemHook (injection)', () => {
    it('injects the guide once and does not duplicate', () => {
      voiceGuideMessagesHook({ sessionID: 's2' }, { messages: [{ role: 'user', parts: [{ type: 'file', mediaType: 'audio/wav' }] }] })
      const out: { system: string[] } = { system: [] }
      voiceGuideSystemHook({ sessionID: 's2' }, out)
      voiceGuideSystemHook({ sessionID: 's2' }, out)
      expect(out.system.filter((s) => s.includes('<voice-guide>'))).toHaveLength(1)
      expect(out.system.join('\n')).toContain('mafw_media_speak')
    })

    it('coexists with the memory guide block', () => {
      voiceGuideMessagesHook({ sessionID: 's3' }, { messages: [{ role: 'user', parts: [{ type: 'text', text: AUDIO_POINTER }] }] })
      const out = { system: ['<memory-guide>... 记忆 ...</memory-guide>'] }
      voiceGuideSystemHook({ sessionID: 's3' }, out)
      expect(out.system.join('\n')).toContain('<memory-guide>')
      expect(out.system.join('\n')).toContain('<voice-guide>')
    })
  })

  describe('buildVoiceGuide', () => {
    it('renders the guide with header/footer', () => {
      const g = buildVoiceGuide()
      expect(g.startsWith('<voice-guide>')).toBe(true)
      expect(g.endsWith('</voice-guide>')).toBe(true)
      expect(g).toContain('mafw_media_speak')
    })
  })
})
