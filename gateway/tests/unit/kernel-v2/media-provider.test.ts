import { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry';
import {
  createMediaCapability,
  registerMediaProvider,
  type MediaProvider,
} from '../../../src/kernel-v2/providers/media';
import type { MediaConfig } from '../../../src/media/media-service';

const cfg = (over: Partial<MediaConfig> = {}): MediaConfig => ({
  provider: 'xiaomi',
  model: 'mimo-v2.6-pro',
  ...over,
});

const prompt = (name: string) => async () => name;

function registry() {
  return new CapabilityRegistry<MediaProvider>({
    defaultId: 'pi',
    capability: 'media',
    version: '1.0.0',
    revision: 'test',
    plane: 'gateway',
  });
}

describe('Media capability adapter', () => {
  test('defaults to builtin pi', () => {
    const reg = registry();
    registerMediaProvider(reg, {
      id: 'pi',
      modalities: ['image', 'video', 'audio'],
      prompt: prompt('pi'),
      builtin: true,
    });
    const media = createMediaCapability(reg, { builtinPi: () => prompt('builtin-pi') });
    expect(media.resolve('image', cfg())).toBeDefined();
    expect(media.engines()).toEqual([
      { id: 'pi', modalities: ['image', 'video', 'audio'], tier: 'builtin' },
    ]);
  });

  test('package overrides builtin with the same id', () => {
    const reg = registry();
    registerMediaProvider(reg, {
      id: 'pi',
      modalities: ['image'],
      prompt: prompt('builtin'),
      builtin: true,
    });
    registerMediaProvider(
      reg,
      { id: 'pi', modalities: ['image'], prompt: prompt('package') },
      'package',
    );
    const media = createMediaCapability(reg, { builtinPi: () => prompt('builtin-pi') });
    expect(media.engines()[0]).toMatchObject({ id: 'pi', tier: 'package' });
  });

  test('unknown engine falls back to builtin pi and reports the reason', () => {
    const reasons: string[] = [];
    const reg = registry();
    registerMediaProvider(reg, {
      id: 'pi',
      modalities: ['image'],
      prompt: prompt('pi'),
      builtin: true,
    });
    const media = createMediaCapability(reg, {
      builtinPi: () => prompt('builtin-pi'),
      onFallback: (reason) => reasons.push(reason),
    });
    expect(media.resolve('image', cfg({ image: { model: 'x', engine: 'missing' } }))).toBeDefined();
    expect(reasons).toEqual(['unknown-engine']);
  });

  test('unsupported modality falls back and reports the reason', () => {
    const reasons: string[] = [];
    const reg = registry();
    registerMediaProvider(reg, {
      id: 'pi',
      modalities: ['image'],
      prompt: prompt('pi'),
      builtin: true,
    });
    registerMediaProvider(reg, { id: 'vision-only', modalities: ['image'], prompt: prompt('vision') });
    const media = createMediaCapability(reg, {
      builtinPi: () => prompt('builtin-pi'),
      onFallback: (reason) => reasons.push(reason),
    });
    expect(
      media.resolve('video', cfg({ video: { model: 'x', engine: 'vision-only' } })),
    ).toBeDefined();
    expect(reasons).toEqual(['unsupported-modality']);
  });

  test('unhealthy provider falls back to builtin and reports the reason', () => {
    const reasons: string[] = [];
    const reg = registry();
    registerMediaProvider(reg, {
      id: 'pi',
      modalities: ['image'],
      prompt: prompt('pi'),
      builtin: true,
    });
    registerMediaProvider(
      reg,
      {
        id: 'sick',
        modalities: ['image'],
        prompt: prompt('sick'),
        health: () => 'failed',
      },
      'package',
    );
    const media = createMediaCapability(reg, {
      builtinPi: () => prompt('builtin-pi'),
      onFallback: (reason) => reasons.push(reason),
    });
    expect(media.resolve('image', cfg({ image: { model: 'x', engine: 'sick' } }))).toBeDefined();
    expect(reasons).toEqual(['unhealthy']);
  });

  test('missing builtin pi returns undefined instead of throwing', () => {
    const reg = registry();
    registerMediaProvider(reg, {
      id: 'pi',
      modalities: ['image'],
      prompt: prompt('pi'),
      builtin: true,
    });
    const media = createMediaCapability(reg, { builtinPi: () => undefined });
    expect(media.resolve('image', cfg())).toBeUndefined();
  });

  test('builtin pi throwing returns undefined instead of throwing', () => {
    const reg = registry();
    const media = createMediaCapability(reg, {
      builtinPi: () => {
        throw new Error('runtime inactive');
      },
    });
    expect(media.resolve('image', cfg())).toBeUndefined();
  });

  test('scope isolation: project provider is not visible globally', () => {
    const reg = registry();
    const project = { kind: 'project', projectId: 'p1' } as const;
    registerMediaProvider(reg, {
      id: 'pi',
      modalities: ['image'],
      prompt: prompt('global'),
      builtin: true,
    });
    registerMediaProvider(
      reg,
      { id: 'local', modalities: ['image'], prompt: prompt('project') },
      'package',
      project,
    );
    const media = createMediaCapability(reg, { builtinPi: () => prompt('builtin-pi') });
    expect(media.engines().some((item) => item.id === 'local')).toBe(false);
    expect(media.engines(project).some((item) => item.id === 'local')).toBe(true);
  });
});
