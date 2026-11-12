import { CapabilityRegistry } from '../../src/kernel-v2/capability-registry';
import {
  createMediaCapability,
  registerMediaProvider,
} from '../../src/kernel-v2/providers/media';
import { createAsrCapability, registerAsrEngine } from '../../src/kernel-v2/providers/asr';
import { createTtsCapability } from '../../src/kernel-v2/providers/tts';
import { createUsageCapability } from '../../src/kernel-v2/providers/usage';
import {
  createCommandCapability,
  registerCommandSource,
} from '../../src/kernel-v2/providers/commands';
import {
  createNotificationCapability,
  registerNotificationChannel,
} from '../../src/kernel-v2/providers/notifications';
import {
  createAutomationCapability,
  registerAutomationAction,
} from '../../src/kernel-v2/providers/automation';
import { createMediaEchoProvider } from '../fixtures/kernel-v2/media-echo-provider';
import { createFakeAsrEngine } from '../fixtures/kernel-v2/asr-fake-provider';
import { createCommandPackageSource } from '../fixtures/kernel-v2/command-package-source';
import { createNotificationWebhookChannel } from '../fixtures/kernel-v2/notification-webhook-channel';
import { createAutomationEchoAction } from '../fixtures/kernel-v2/automation-echo-action';
import type { TtsEngine } from '../../src/tts/types';
import type { ExternalAdapter, UsageProvider } from '../../src/usage/types';

function ttsEngine(name: string): TtsEngine {
  return {
    name,
    profile: {
      streaming: 'native',
      voiceCloning: false,
      styleControl: false,
      languages: ['zh'],
      sampleRate: 24000,
    },
    voices: () => [{ id: name, label: name, lang: 'zh' }],
    async *synthesizeStream() {},
    async synthesize() {
      return Buffer.from(name);
    },
  };
}

function usageAdapter(name: string): ExternalAdapter {
  const provider: UsageProvider = {
    name,
    windows: [{ window: 'day', used: 1, limit: 10, unit: 'tokens', pct: 10 }],
    severity: 'low',
  };
  return { name, fetch: async () => provider };
}

test('a test package can replace builtin media/asr/tts/usage providers without core edits', async () => {
  const mediaRegistry = new CapabilityRegistry({
    defaultId: 'pi',
    capability: 'media',
    version: '1.0.0',
    revision: 'g2',
    plane: 'gateway',
  });
  registerMediaProvider(mediaRegistry, {
    id: 'pi',
    modalities: ['image', 'video', 'audio'],
    prompt: async () => 'pi',
    builtin: true,
  });
  registerMediaProvider(mediaRegistry, createMediaEchoProvider(), 'package');
  const media = createMediaCapability(mediaRegistry, { builtinPi: () => async () => 'builtin' });
  expect(media.engines().find((item) => item.id === 'echo')?.tier).toBe('package');

  const asrRegistry = new CapabilityRegistry({
    defaultId: 'qwen3-asr-vllm',
    capability: 'asr',
    version: '1.0.0',
    revision: 'g2',
    plane: 'gateway',
  });
  registerAsrEngine(asrRegistry, createFakeAsrEngine('qwen3-asr-vllm'));
  registerAsrEngine(asrRegistry, createFakeAsrEngine('package-asr'), 'package');
  expect(createAsrCapability(asrRegistry).list().map((item) => item.id)).toContain('package-asr');

  const ttsRegistry = new CapabilityRegistry<TtsEngine>({
    defaultId: 'mimo',
    capability: 'tts',
    version: '1.0.0',
    revision: 'g2',
    plane: 'gateway',
  });
  ttsRegistry.register('builtin', { id: 'mimo', value: ttsEngine('mimo') });
  ttsRegistry.register('package', { id: 'mimo', value: ttsEngine('mimo-package') });
  const tts = createTtsCapability(ttsRegistry);
  expect(tts.resolve().name).toBe('mimo-package');
  expect(tts.list().find((item) => item.id === 'mimo')?.tier).toBe('package');

  const usageRegistry = new CapabilityRegistry<ExternalAdapter>({
    defaultId: 'opencode',
    capability: 'usage',
    version: '1.0.0',
    revision: 'g2',
    plane: 'gateway',
  });
  usageRegistry.register('builtin', { id: 'opencode', value: usageAdapter('opencode') });
  usageRegistry.register('package', { id: 'opencode', value: usageAdapter('opencode-package') });
  const usage = createUsageCapability(usageRegistry);
  expect(usage.adapters().map((item) => item.name)).toEqual(['opencode-package']);
});

test('a test package can add commands/notifications/automation actions without core edits', async () => {
  const commandsRegistry = new CapabilityRegistry({
    defaultId: 'builtin',
    capability: 'commands',
    version: '1.0.0',
    revision: 'g2',
    plane: 'gateway',
  });
  registerCommandSource(commandsRegistry, {
    id: 'builtin',
    scan: async () => [
      {
        name: 'help',
        description: 'help',
        template: 'help',
        sourceFile: 'help.md',
      },
    ],
  });
  registerCommandSource(commandsRegistry, createCommandPackageSource(), 'package');
  expect((await createCommandCapability(commandsRegistry).list()).map((item) => item.name)).toEqual([
    'help',
    'package:hello',
  ]);

  const notificationsRegistry = new CapabilityRegistry({
    defaultId: 'push',
    capability: 'notifications',
    version: '1.0.0',
    revision: 'g2',
    plane: 'gateway',
  });
  registerNotificationChannel(notificationsRegistry, {
    id: 'push',
    send: async () => {},
  });
  registerNotificationChannel(notificationsRegistry, createNotificationWebhookChannel(), 'package');
  const notifications = createNotificationCapability(notificationsRegistry);
  expect((await notifications.notify({ type: 'goal.updated' })).delivered).toEqual([
    'push',
    'webhook',
  ]);

  const automationRegistry = new CapabilityRegistry({
    defaultId: 'echo',
    capability: 'automation-action',
    version: '1.0.0',
    revision: 'g2',
    plane: 'gateway',
  });
  registerAutomationAction(automationRegistry, { id: 'echo', handler: async () => 'echo' });
  registerAutomationAction(automationRegistry, createAutomationEchoAction(), 'package');
  await expect(
    createAutomationCapability(automationRegistry).run('echo-action', { ruleId: 'r7' }),
  ).resolves.toEqual({ ok: true, value: { echoed: 'r7' } });
});
