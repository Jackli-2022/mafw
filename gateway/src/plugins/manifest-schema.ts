/**
 * The published `plugin.json` JSON Schema — the machine-readable half of the
 * package standard.
 *
 * One invariant governs this file: **it is never stricter than
 * `parsePackageManifest`**. For any candidate manifest,
 *
 *   parsePackageManifest(m).ok === validateWithSchema(m)
 *
 * so an agent or editor writing to this schema cannot produce a package the
 * gateway refuses to activate, and a package the gateway accepts is never
 * flagged in an editor. `gateway/tests/unit/plugins/manifest-schema-parity.test.ts`
 * compiles this document with Ajv and holds both verdicts side by side.
 *
 * Two consequences worth stating, because they look like omissions:
 *
 * - **No top-level `additionalProperties: false`.** The parser lets vendors add
 *   their own top-level metadata and only reads the keys it knows.
 * - **`contributes` is strict only at `apiVersion: 2`**, where an invalid block
 *   is fatal. At apiVersion 1 the parser downgrades it to a warning and drops
 *   the block so legacy packages keep activating; a schema that rejected those
 *   manifests would be stricter than the runtime for every v1 package carrying
 *   a stale block.
 *
 * Shared rules come from `package-manifest.ts` (name + permission patterns) so
 * a parser change cannot silently outrun the published contract.
 */
import { PLUGIN_UI_LIMITS } from '@mafw/plugin-contract';
import {
  BASE_PERMISSION_TOKENS,
  PACKAGE_NAME_PATTERN_SOURCE,
  SCOPED_PERMISSION_PREFIXES,
} from './package-manifest';

function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `actions|events|config\.read|…|files\.read:[\s\S]+|…` — mirrors `isKnownPermissionToken`. */
const PERMISSION_PATTERN = `^(?:${[
  ...BASE_PERMISSION_TOKENS.map(literal),
  ...SCOPED_PERMISSION_PREFIXES.map((prefix) => `${literal(prefix)}[\\s\\S]+`),
].join('|')})$`;

/**
 * `isSafeMain()` as a regex (emptiness is handled by `minLength`): no NUL, no
 * drive letter, not absolute, and no `..` path *segment* — a file that merely
 * contains `..` is fine.
 */
const MAIN_PATTERN = '^(?![A-Za-z]:)'
  + '(?![/\\\\])'
  + '(?![\\s\\S]*\\u0000)'
  + '(?!(?:[\\s\\S]*[/\\\\])?\\.\\.(?:[/\\\\]|$))';

/**
 * `parseHostRange()` as a regex: `*`, or whitespace-separated comparators.
 * Comparators never contain whitespace themselves — the parser splits on `\s+`
 * first, so `>= 5.1.0` is two tokens and therefore invalid.
 */
const HOST_RANGE_PATTERN = '^\\s*(?:\\*|(?:[<>]=?|=)?\\d+\\.\\d+\\.\\d+'
  + '(?:[-+][0-9A-Za-z.-]+)?(?:\\s+(?:[<>]=?|=)?\\d+\\.\\d+\\.\\d+'
  + '(?:[-+][0-9A-Za-z.-]+)?)*)\\s*$';

/**
 * Tool-name rule of `@mafw/plugin-contract` (`TOOL_NAME_PATTERN` in
 * `validate.ts`, which is not exported). Unlike the package name it has no
 * trailing-dot rule; the contract is the source of truth.
 */
const TOOL_NAME_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]*$';

export const MANIFEST_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'MAFW plugin.json',
  description:
    'Unified plugin package manifest. This schema is never stricter than the gateway parser: '
    + 'a manifest that validates here is one the gateway can parse.',
  type: 'object',
  required: ['name'],
  properties: {
    name: {
      type: 'string',
      pattern: PACKAGE_NAME_PATTERN_SOURCE,
      description:
        'Package identity, and the event namespace (`plugin:<name>:<event>`). '
        + 'Deliberately uncapped: `mafw plugin init` has its own 100-character limit.',
    },
    version: { type: 'string', minLength: 1, description: 'Package version (free-form).' },
    main: {
      type: 'string',
      minLength: 1,
      pattern: MAIN_PATTERN,
      description: 'Entry file relative to the package directory; defaults to `index.js`.',
    },
    apiVersion: {
      enum: [1, 2],
      description: 'Manifest/trust generation; absent means 1 (legacy).',
    },
    kind: {
      enum: ['trusted', 'untrusted'],
      description: '`untrusted` is only legal together with `apiVersion: 2`.',
    },
    permissions: {
      type: 'array',
      items: { type: 'string', minLength: 1, pattern: PERMISSION_PATTERN },
      description: 'Consent tokens a human approves at install time.',
    },
    host: {
      type: 'string',
      pattern: HOST_RANGE_PATTERN,
      description: 'Gateway version range, e.g. `*` or `>=5.1.0 <6.0.0`.',
    },
    integrity: {
      type: 'object',
      required: ['algorithm', 'files'],
      properties: {
        algorithm: { const: 'sha256' },
        files: {
          type: 'object',
          description: 'Relative path → sha256 digest of the packaged file.',
          additionalProperties: { type: 'string', minLength: 1 },
        },
      },
    },
    deprecated: { type: 'string', minLength: 1, description: 'Replacement hint for authors.' },
    standardVersion: {
      type: 'integer',
      minimum: 1,
      description: 'Manifest standard the package was written against.',
    },
    contributes: {
      description:
        'Static plane ownership — the upper bound `activate()` may register. '
        + 'Strictly validated at `apiVersion: 2`; a warning-only block at apiVersion 1.',
    },
  },
  allOf: [
    {
      // An invalid block is fatal only at apiVersion 2; at apiVersion 1 the
      // parser warns and drops it, so the schema stays silent there.
      if: { properties: { apiVersion: { const: 2 } }, required: ['apiVersion'] },
      then: { properties: { contributes: { $ref: '#/$defs/contributes' } } },
    },
    {
      if: { properties: { kind: { const: 'untrusted' } }, required: ['kind'] },
      then: { properties: { apiVersion: { const: 2 } }, required: ['apiVersion'] },
    },
  ],
  $defs: {
    stringList: { type: 'array', items: { type: 'string', minLength: 1 } },
    anyList: { type: 'array' },
    toolDescriptor: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'description', 'inputSchema'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 64, pattern: TOOL_NAME_PATTERN },
        title: { type: 'string', pattern: '\\S' },
        description: { type: 'string', minLength: 1, maxLength: 512, pattern: '\\S' },
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        timeoutMs: { type: 'integer', minimum: 1, maximum: PLUGIN_UI_LIMITS.maxActionTimeoutMs },
        scope: { enum: ['global', 'session'] },
      },
    },
    contributes: {
      type: 'object',
      additionalProperties: false,
      properties: {
        gateway: { $ref: '#/$defs/gatewayContributes' },
        desktop: { $ref: '#/$defs/desktopContributes' },
      },
    },
    gatewayContributes: {
      type: 'object',
      additionalProperties: false,
      properties: {
        actions: { $ref: '#/$defs/stringList' },
        events: { $ref: '#/$defs/stringList' },
        tools: { type: 'array', items: { $ref: '#/$defs/toolDescriptor' } },
        observers: { $ref: '#/$defs/stringList' },
        http: { type: 'boolean' },
      },
    },
    desktopContributes: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ui: {
          type: 'object',
          additionalProperties: false,
          properties: {
            panels: { $ref: '#/$defs/anyList' },
            toolCards: { $ref: '#/$defs/anyList' },
            configPages: { $ref: '#/$defs/anyList' },
            messageWindows: { $ref: '#/$defs/anyList' },
          },
        },
        web: {
          type: 'object',
          additionalProperties: false,
          properties: { webSurfaces: { $ref: '#/$defs/anyList' } },
        },
        main: {
          type: 'object',
          additionalProperties: false,
          required: ['legacy'],
          properties: { legacy: { const: true } },
        },
      },
    },
  },
};
