import { MediaService, MediaError, MediaConfig, LANG_INSTRUCTIONS, kindFromMediaType, PromptFn } from '../../../gateway/src/media/media-service'

describe('MediaService', () => {
  function makeService(opts: {
    prompt?: PromptFn
    config?: () => Partial<MediaConfig>
    promptImpl?: (parts: any[], o: { providerID: string; modelID: string }) => string
  } = {}) {
    const calls: Array<{ parts: any[]; opts: { providerID: string; modelID: string } }> = []
    const prompt: PromptFn = async (parts, o) => {
      calls.push({ parts, opts: o })
      if (opts.promptImpl) return opts.promptImpl(parts, o)
      return '分析结果'
    }
    const svc = new MediaService({
      prompt: opts.prompt ?? prompt,
      config: opts.config,
    })
    return { svc, calls }
  }

  const defaultCfg = () => ({ provider: 'xiaomi', model: 'mimo-v2.5' })

  describe('kindFromMediaType', () => {
    it('maps image/video/audio prefixes', () => {
      expect(kindFromMediaType('image/png')).toBe('image')
      expect(kindFromMediaType('video/mp4')).toBe('video')
      expect(kindFromMediaType('audio/mpeg')).toBe('audio')
      expect(kindFromMediaType('application/pdf')).toBe('image')
    })
  })

  describe('loadConfig / modelFor', () => {
    it('applies defaults when no gateway config is provided', () => {
      const { svc } = makeService()
      const cfg = svc.loadConfig()
      expect(cfg.provider).toBe('xiaomi')
      expect(cfg.model).toBe('mimo-v2.5')
      expect(svc.modelFor(cfg, 'video')).toEqual({ providerID: 'xiaomi', modelID: 'mimo-v2.5' })
    })

    it('merges gateway config over defaults', () => {
      const { svc } = makeService({
        config: () => ({
          provider: 'xiaomi',
          model: 'mimo-v2.5',
          image: { model: 'mimo-v2.5' },
          video: { provider: 'opencode', model: 'qwen3.7-plus' },
          audio: { model: 'mimo-v2.5' },
          lang: 'zh',
        }),
      })
      const cfg = svc.loadConfig()
      expect(svc.modelFor(cfg, 'image')).toEqual({ providerID: 'xiaomi', modelID: 'mimo-v2.5' })
      expect(svc.modelFor(cfg, 'video')).toEqual({ providerID: 'opencode', modelID: 'qwen3.7-plus' })
      expect(svc.modelFor(cfg, 'audio')).toEqual({ providerID: 'xiaomi', modelID: 'mimo-v2.5' })
    })

    it('per-modality provider falls back to the top-level provider', () => {
      const { svc } = makeService({
        config: () => ({ provider: 'xiaomi', model: 'mimo-v2.5', image: { model: 'img-2' } }),
      })
      const cfg = svc.loadConfig()
      expect(svc.modelFor(cfg, 'image')).toEqual({ providerID: 'xiaomi', modelID: 'img-2' })
    })
  })

  describe('analyze', () => {
    it('sends a file part + text part with the default model pair', async () => {
      const { svc, calls } = makeService({ config: defaultCfg })
      const result = await svc.analyze({ kind: 'image', dataUrl: 'data:image/png;base64,AAAA', mediaType: 'image/png' }, '图里有什么？')
      expect(result).toBe('分析结果')
      expect(calls.length).toBe(1)
      expect(calls[0].opts).toEqual({ providerID: 'xiaomi', modelID: 'mimo-v2.5' })
      expect(calls[0].parts[0]).toMatchObject({ type: 'file', mime: 'image/png', url: 'data:image/png;base64,AAAA' })
      expect(calls[0].parts[1]).toMatchObject({ type: 'text', text: '图里有什么？' })
    })

    it('prepends the LANG instruction when lang is set', async () => {
      const { svc, calls } = makeService({
        config: () => ({ provider: 'xiaomi', model: 'mimo-v2.5', lang: 'zh' }),
      })
      await svc.analyze({ kind: 'image', dataUrl: 'data:image/png;base64,AAAA', mediaType: 'image/png' }, 'q')
      expect(calls[0].parts[1].text).toContain(LANG_INSTRUCTIONS.zh)
    })

    it('selects the per-modality model pair (video → configured video model)', async () => {
      const { svc, calls } = makeService({
        config: () => ({
          provider: 'xiaomi',
          model: 'mimo-v2.5',
          video: { provider: 'opencode', model: 'qwen3.7-plus' },
        }),
      })
      await svc.analyze({ kind: 'video', dataUrl: 'data:video/mp4;base64,AAAA', mediaType: 'video/mp4' }, 'q')
      expect(calls[0].opts).toEqual({ providerID: 'opencode', modelID: 'qwen3.7-plus' })
      expect(calls[0].parts[0]).toMatchObject({ type: 'file', mime: 'video/mp4' })
    })

    it('selects the per-modality model pair (audio)', async () => {
      const { svc, calls } = makeService({
        config: () => ({ provider: 'xiaomi', model: 'mimo-v2.5', audio: { model: 'mimo-v2.5' } }),
      })
      await svc.analyze({ kind: 'audio', dataUrl: 'data:audio/mpeg;base64,QUFB', mediaType: 'audio/mpeg' }, 'q')
      expect(calls[0].opts).toEqual({ providerID: 'xiaomi', modelID: 'mimo-v2.5' })
      expect(calls[0].parts[0]).toMatchObject({ type: 'file', mime: 'audio/mpeg' })
    })

    it('infers the kind from mediaType when kind is not authoritative', async () => {
      const { svc, calls } = makeService({ config: defaultCfg })
      await svc.analyze({ kind: 'image', dataUrl: 'data:video/mp4;base64,AAAA', mediaType: 'video/mp4' }, 'q')
      // explicit kind wins; mediaType only drives the part mime
      expect(calls[0].parts[0].mime).toBe('video/mp4')
    })

    it('caches per (kind, provider, model, media, prompt)', async () => {
      const { svc, calls } = makeService({ config: defaultCfg })
      await svc.analyze({ kind: 'image', dataUrl: 'data:image/png;base64,AAAA', mediaType: 'image/png' }, 'q')
      await svc.analyze({ kind: 'image', dataUrl: 'data:image/png;base64,AAAA', mediaType: 'image/png' }, 'q')
      expect(calls.length).toBe(1)
      await svc.analyze({ kind: 'video', dataUrl: 'data:video/mp4;base64,AAAA', mediaType: 'video/mp4' }, 'q')
      await svc.analyze({ kind: 'image', dataUrl: 'data:image/png;base64,AAAA', mediaType: 'image/png' }, 'q2')
      expect(calls.length).toBe(3)
    })

    it('wraps prompt failures as MediaError', async () => {
      const { svc } = makeService({
        config: defaultCfg,
        prompt: async () => { throw new Error('upstream 503') },
      })
      await expect(svc.analyze({ kind: 'image', dataUrl: 'data:image/png;base64,AAAA', mediaType: 'image/png' }, 'q'))
        .rejects.toBeInstanceOf(MediaError)
      await expect(svc.analyze({ kind: 'image', dataUrl: 'data:image/png;base64,AAAA', mediaType: 'image/png' }, 'q'))
        .rejects.toThrow(/upstream 503/)
    })

    it('throws MediaError on empty output', async () => {
      const { svc } = makeService({
        config: defaultCfg,
        promptImpl: () => '   ',
      })
      await expect(svc.analyze({ kind: 'image', dataUrl: 'data:image/png;base64,AAAA', mediaType: 'image/png' }, 'q'))
        .rejects.toThrow(/empty description/)
    })
  })

  describe('describe (image convenience entry)', () => {
    it('routes an image analyze call with image/png', async () => {
      const { svc, calls } = makeService({ config: defaultCfg })
      await svc.describe('data:image/png;base64,AAAA', 'q')
      expect(calls[0].parts[0]).toMatchObject({ type: 'file', mime: 'image/png', url: 'data:image/png;base64,AAAA' })
    })
  })

  describe('analyzeAudioNarrative', () => {
    it('routes an audio analyze call with the narrative prompt (no JSON)', async () => {
      const { svc, calls } = makeService({ config: defaultCfg })
      const out = await svc.analyzeAudioNarrative({ kind: 'audio', dataUrl: 'data:audio/wav;base64,AAAA', mediaType: 'audio/wav' })
      expect(out).toBe('分析结果')
      expect(calls[0].parts[0]).toMatchObject({ type: 'file', mime: 'audio/wav', url: 'data:audio/wav;base64,AAAA' })
      const textPart = calls[0].parts[1] as { text?: string }
      expect(textPart.text).toContain('用自然语言按顺序描述')
      expect(textPart.text).toContain('不要输出 JSON')
    })

    it('caches per (kind, provider, model, media, prompt)', async () => {
      const { svc, calls } = makeService({ config: defaultCfg })
      const input = { kind: 'audio' as const, dataUrl: 'data:audio/wav;base64,AAAA', mediaType: 'audio/wav' }
      await svc.analyzeAudioNarrative(input)
      await svc.analyzeAudioNarrative(input)
      expect(calls.length).toBe(1)
    })
  })
})
