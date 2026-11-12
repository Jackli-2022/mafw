/**
 * Sanitized canonical event snapshot for observers.
 *
 * The observer must never receive prompts, credentials or arbitrary runtime
 * payloads. Only the envelope fields and a depth-limited, secret-filtered copy
 * of `properties` survive.
 */

import type { CanonicalEvent } from './observer';

export interface EventFacetLike {
  type: string;
  sessionID?: string;
  directory?: string;
  properties?: Record<string, unknown>;
}

const SECRET_KEY = /(token|secret|password|prompt|apikey|api_key|authorization|credential)/i;
const MAX_DEPTH = 4;
const MAX_STRING = 2_000;
const MAX_ARRAY = 100;

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null) return null;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(key)) continue;
      const sanitized = sanitizeValue(item, depth + 1);
      if (sanitized !== undefined) out[key] = sanitized;
    }
    return out;
  }
  return undefined;
}

export function toCanonicalEvent(facets: EventFacetLike, at = Date.now()): CanonicalEvent {
  const properties =
    facets.properties && typeof facets.properties === 'object'
      ? (sanitizeValue(facets.properties, 0) as Record<string, unknown>)
      : undefined;
  const projectId =
    properties && typeof properties.projectId === 'string' ? properties.projectId : undefined;

  return {
    type: facets.type,
    ...(facets.sessionID ? { sessionID: facets.sessionID } : {}),
    ...(projectId ? { projectId } : {}),
    at,
    ...(properties && Object.keys(properties).length > 0 ? { properties } : {}),
  };
}
