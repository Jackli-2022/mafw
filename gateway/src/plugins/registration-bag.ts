/**
 * Per-candidate-package lifecycle ledger.
 *
 * Every disposable a package owns — action/event/UI registrations, watchers,
 * timers, listeners and custom `ctx.effect` cleanups — is added to one bag.
 * Disposal is LIFO (the most recently acquired resource is released first),
 * idempotent, and never lets one failing disposer block the rest of cleanup.
 *
 * The bag is intentionally transport-free: the PluginHost creates one bag per
 * candidate and disposes it either when the candidate is discarded or when the
 * old active revision is replaced at commit.
 */

export type RegistrationBagDisposer = () => void | Promise<void>;

export interface RegistrationBagDiagnostic {
  /** Registration name passed to `add()` (or generated for `effect()`). */
  name: string;
  /** Failure message of the disposer, for host diagnostics. */
  message: string;
}

export interface RegistrationBag {
  /** Number of registrations still pending disposal. */
  readonly size: number;
  /** True once `dispose()` was called (even if it is still running). */
  readonly disposed: boolean;
  /** Register a named cleanup; runs in reverse registration order. */
  add(name: string, dispose: RegistrationBagDisposer): void;
  /** Register an anonymous cleanup (`effect#N`). */
  effect(dispose: RegistrationBagDisposer): void;
  /**
   * Run every pending disposer once, newest first.
   *
   * Idempotent: repeated calls return the same promise and never re-run a
   * disposer. Never rejects — failures are returned as diagnostics.
   */
  dispose(): Promise<RegistrationBagDiagnostic[]>;
}

interface RegistrationEntry {
  name: string;
  dispose: RegistrationBagDisposer;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  const text = String(err);
  return text.length > 0 ? text : 'unknown error';
}

function assertDisposer(dispose: unknown): asserts dispose is RegistrationBagDisposer {
  if (typeof dispose !== 'function') {
    throw new TypeError(`registration disposer must be a function (got ${typeof dispose})`);
  }
}

export function createRegistrationBag(): RegistrationBag {
  const entries: RegistrationEntry[] = [];
  let effectCounter = 0;
  let disposal: Promise<RegistrationBagDiagnostic[]> | undefined;

  function invokeNow(entry: RegistrationEntry): void {
    try {
      const result = entry.dispose();
      if (result && typeof (result as Promise<void>).then === 'function') {
        (result as Promise<void>).then(undefined, () => { /* late cleanup failure is non-fatal */ });
      }
    } catch {
      /* late cleanup failure is non-fatal */
    }
  }

  function add(name: string, dispose: RegistrationBagDisposer): void {
    assertDisposer(dispose);
    if (disposal !== undefined) {
      // Late registration after teardown: release immediately so a stale async
      // callback cannot keep a timer/listener alive, but never surface the
      // failure as an unhandled rejection.
      invokeNow({ name, dispose });
      return;
    }
    entries.push({ name, dispose });
  }

  function effect(dispose: RegistrationBagDisposer): void {
    effectCounter += 1;
    add(`effect#${effectCounter}`, dispose);
  }

  async function runDisposers(): Promise<RegistrationBagDiagnostic[]> {
    const diagnostics: RegistrationBagDiagnostic[] = [];
    while (entries.length > 0) {
      const entry = entries.pop() as RegistrationEntry;
      try {
        await entry.dispose();
      } catch (err) {
        diagnostics.push({ name: entry.name, message: describeError(err) });
      }
    }
    return diagnostics;
  }

  function dispose(): Promise<RegistrationBagDiagnostic[]> {
    if (disposal !== undefined) return disposal;
    disposal = runDisposers();
    return disposal;
  }

  return {
    get size() { return entries.length; },
    get disposed() { return disposal !== undefined; },
    add,
    effect,
    dispose,
  };
}
