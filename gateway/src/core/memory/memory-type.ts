// Cortex memory-type policy. `episodic` was retired from Harmonic: "what
// happened" lives in T1 episodes. HTTP/MCP accept the old value for one
// release and coerce it to a semantic gist; native tools no longer expose it.
export type StoredMemoryType = 'semantic' | 'procedural' | 'global';
export type RequestedMemoryType = StoredMemoryType | 'episodic';

export const RETIRED_EPISODIC_WARNING =
  'episodic is retired; stored as semantic gist';

export function isKnownMemoryType(raw: unknown): raw is RequestedMemoryType {
  const value = raw == null || raw === '' ? 'semantic' : String(raw);
  return ['episodic', 'semantic', 'procedural', 'global'].includes(value);
}

export function normalizeMemoryType(raw: unknown): StoredMemoryType {
  const value = raw == null || raw === '' ? 'semantic' : String(raw);
  if (value === 'episodic') return 'semantic';
  if (value === 'procedural' || value === 'global') return value;
  return 'semantic';
}

export function memoryTypeWarnings(raw: unknown): string[] {
  return String(raw ?? '') === 'episodic' ? [RETIRED_EPISODIC_WARNING] : [];
}
