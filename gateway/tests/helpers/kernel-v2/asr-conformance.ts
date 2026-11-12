/**
 * ASR capability conformance kit.
 *
 * The factory registers the default builtin engine and supplies:
 * - `override`: same name as the default, registered at package tier by the kit
 * - `throwing`: an engine whose `isAvailable()` throws
 *
 * The kit asserts default/override/fallback/availability semantics.
 */

import type { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry';
import { createAsrCapability, registerAsrEngine } from '../../../src/kernel-v2/providers/asr';
import type { AsrEngine } from '../../../src/voice/types';

export interface AsrConformanceFactory {
  create(): {
    registry: CapabilityRegistry<AsrEngine>;
    defaultEngine: string;
  };
  override: AsrEngine;
  throwing: AsrEngine;
}

export function runAsrConformance(name: string, factory: AsrConformanceFactory): void {
  describe(`${name} conformance`, () => {
    test('resolves the default engine', () => {
      const { registry, defaultEngine } = factory.create();
      expect(createAsrCapability(registry).resolve().name).toBe(defaultEngine);
    });

    test('package override wins for the same name', () => {
      const { registry, defaultEngine } = factory.create();
      registerAsrEngine(registry, factory.override, 'package');
      const entry = createAsrCapability(registry)
        .list()
        .find((item) => item.id === defaultEngine);
      expect(entry?.tier).toBe('package');
    });

    test('unknown name falls back to the default engine', () => {
      const { registry, defaultEngine } = factory.create();
      expect(createAsrCapability(registry).resolve('missing').name).toBe(defaultEngine);
    });

    test('available() reports a thrown probe as unavailable', async () => {
      const { registry } = factory.create();
      registerAsrEngine(registry, factory.throwing, 'package');
      await expect(createAsrCapability(registry).available(factory.throwing.name)).resolves.toEqual({
        ok: false,
        reason: 'down',
      });
    });
  });
}
