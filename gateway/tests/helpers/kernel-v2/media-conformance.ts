/**
 * Media capability conformance kit.
 *
 * The factory must register a standard fixture in the registry it returns:
 *
 * - builtin `pi` (all modalities, builtin: true)
 * - package `image-only` (image only)
 * - package `unhealthy` (image only, health: failed)
 * - project-scoped `local` (image only)
 *
 * It also supplies `override` (same id as builtin `pi`), which the kit
 * registers at the package tier for the override case.
 *
 * The kit then asserts the adapter's resolution/fallback/scope semantics.
 * Provider implementations can run the same kit by satisfying this contract.
 */

import type {
  CapabilityRegistry,
} from '../../../src/kernel-v2/capability-registry';
import type { MediaProvider } from '../../../src/kernel-v2/providers/media';
import {
  createMediaCapability,
  registerMediaProvider,
} from '../../../src/kernel-v2/providers/media';
import type { PromptFn } from '../../../src/media/media-service';

export interface MediaConformanceFactory {
  create(): {
    registry: CapabilityRegistry<MediaProvider>;
    builtinPi: () => PromptFn | undefined;
    onFallback: (reason: string, engine: string, kind: string) => void;
  };
  /** Same id as the builtin pi, registered at the package tier by the kit. */
  override: MediaProvider;
  /** Project scope used by the scope-isolation case. */
  projectScope: { kind: 'project'; projectId: string };
}

const cfg = (over: Record<string, unknown> = {}) => ({
  provider: 'xiaomi',
  model: 'mimo-v2.6-pro',
  ...over,
});

function promptOf(value: PromptFn | undefined): string | undefined {
  if (!value) return undefined;
  return (value as unknown as { __label?: string }).__label;
}

export function labelledPrompt(label: string): PromptFn {
  const fn = (async () => label) as unknown as PromptFn & { __label: string };
  fn.__label = label;
  return fn;
}

export function runMediaConformance(name: string, factory: MediaConformanceFactory): void {
  describe(`${name} conformance`, () => {
    test('resolves the builtin pi path', () => {
      const { registry, builtinPi } = factory.create();
      const media = createMediaCapability(registry, { builtinPi });
      expect(promptOf(media.resolve('image', cfg()))).toBe('builtin');
    });

    test('package override wins over builtin for the same id', () => {
      const { registry, builtinPi } = factory.create();
      registerMediaProvider(registry, factory.override, 'package');
      const media = createMediaCapability(registry, { builtinPi });
      expect(
        promptOf(media.resolve('image', cfg({ image: { model: 'x', engine: 'pi' } }))),
      ).toBe('package');
    });

    test('unknown engine falls back with a reason', () => {
      const reasons: string[] = [];
      const { registry, builtinPi } = factory.create();
      const media = createMediaCapability(registry, {
        builtinPi,
        onFallback: (reason) => reasons.push(reason),
      });
      expect(
        promptOf(media.resolve('image', cfg({ image: { model: 'x', engine: 'missing' } }))),
      ).toBe('builtin');
      expect(reasons).toEqual(['unknown-engine']);
    });

    test('unsupported modality falls back with a reason', () => {
      const reasons: string[] = [];
      const { registry, builtinPi } = factory.create();
      const media = createMediaCapability(registry, {
        builtinPi,
        onFallback: (reason) => reasons.push(reason),
      });
      expect(
        promptOf(media.resolve('video', cfg({ video: { model: 'x', engine: 'image-only' } }))),
      ).toBe('builtin');
      expect(reasons).toEqual(['unsupported-modality']);
    });

    test('unhealthy provider falls back with a reason', () => {
      const reasons: string[] = [];
      const { registry, builtinPi } = factory.create();
      const media = createMediaCapability(registry, {
        builtinPi,
        onFallback: (reason) => reasons.push(reason),
      });
      expect(
        promptOf(media.resolve('image', cfg({ image: { model: 'x', engine: 'unhealthy' } }))),
      ).toBe('builtin');
      expect(reasons).toEqual(['unhealthy']);
    });

    test('missing builtin pi returns undefined', () => {
      const { registry } = factory.create();
      const media = createMediaCapability(registry, { builtinPi: () => undefined });
      expect(media.resolve('image', cfg())).toBeUndefined();
    });

    test('project provider is not visible globally', () => {
      const { registry, builtinPi } = factory.create();
      const media = createMediaCapability(registry, { builtinPi });
      expect(media.engines().some((item) => item.id === 'local')).toBe(false);
      expect(media.engines(factory.projectScope).some((item) => item.id === 'local')).toBe(true);
    });
  });
}
