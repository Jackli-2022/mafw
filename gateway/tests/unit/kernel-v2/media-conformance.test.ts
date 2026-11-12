import { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry';
import {
  createMediaCapability,
  registerMediaProvider,
  type MediaProvider,
} from '../../../src/kernel-v2/providers/media';
import { createMediaEchoProvider } from '../../fixtures/kernel-v2/media-echo-provider';
import { labelledPrompt, runMediaConformance } from '../../helpers/kernel-v2/media-conformance';

function fixtureRegistry(): CapabilityRegistry<MediaProvider> {
  const registry = new CapabilityRegistry<MediaProvider>({
    defaultId: 'pi',
    capability: 'media',
    version: '1.0.0',
    revision: 'kit',
    plane: 'gateway',
  });
  registerMediaProvider(registry, {
    id: 'pi',
    modalities: ['image', 'video', 'audio'],
    prompt: labelledPrompt('builtin-pi'),
    builtin: true,
  });
  registerMediaProvider(
    registry,
    { id: 'image-only', modalities: ['image'], prompt: labelledPrompt('image-only') },
    'package',
  );
  registerMediaProvider(
    registry,
    {
      id: 'unhealthy',
      modalities: ['image'],
      prompt: labelledPrompt('unhealthy'),
      health: () => 'failed',
    },
    'package',
  );
  registerMediaProvider(
    registry,
    { id: 'local', modalities: ['image'], prompt: labelledPrompt('local') },
    'package',
    { kind: 'project', projectId: 'p1' },
  );
  return registry;
}

runMediaConformance('media adapter', {
  create() {
    return {
      registry: fixtureRegistry(),
      builtinPi: () => labelledPrompt('builtin'),
      onFallback: () => {},
    };
  },
  override: { id: 'pi', modalities: ['image'], prompt: labelledPrompt('package') },
  projectScope: { kind: 'project', projectId: 'p1' },
});

test('test package provider resolves without core edits', async () => {
  const registry = new CapabilityRegistry<MediaProvider>({
    defaultId: 'pi',
    capability: 'media',
    version: '1.0.0',
    revision: 'g2',
    plane: 'gateway',
  });
  registerMediaProvider(registry, {
    id: 'pi',
    modalities: ['image'],
    prompt: labelledPrompt('builtin-pi'),
    builtin: true,
  });
  registerMediaProvider(registry, createMediaEchoProvider(), 'package');

  const media = createMediaCapability(registry, { builtinPi: () => labelledPrompt('builtin') });
  const resolved = media.resolve('image', {
    provider: 'xiaomi',
    model: 'mimo-v2.6-pro',
    image: { model: 'mimo-v2.6-pro', engine: 'echo' },
  });
  expect(resolved).toBeDefined();
  await expect(resolved!([], { providerID: 'xiaomi', modelID: 'mimo-v2.6-pro' })).resolves.toBe(
    'echo',
  );
  expect(media.engines().find((item) => item.id === 'echo')?.tier).toBe('package');
});
