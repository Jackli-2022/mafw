/**
 * The published `plugin.json` JSON Schema — the machine-readable half of the
 * package standard.
 *
 * Parity, precisely:
 *
 * - **Never stricter**: no manifest this schema rejects is one
 *   `parsePackageManifest` accepts. An editor must not flag a package the
 *   gateway loads.
 * - **Exact over the published matrix and corpora** in
 *   `manifest-schema-parity.test.ts`: every case there gets the same verdict
 *   from this document and from the parser.
 * - **One known loose edge**, pinned by that suite's "knowingly looser" case:
 *   JSON Schema `maxLength` counts **code points** while the contract's
 *   `requireString` counts **UTF-16 code units**. A tool `description` built
 *   from astral characters can validate here and still be refused by the
 *   parser (300 emoji = 300 code points but 600 code units). The asymmetry is
 *   one-way — a string over 512 code points is over 512 code units too — so the
 *   schema stays never-stricter.
 *
 * Two structural consequences worth stating, because they look like omissions:
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
    'Unified plugin package manifest. Never stricter than the gateway parser: every manifest it '
    + 'rejects is one the runtime refuses. It can be looser where JSON Schema counts code points '
    + 'and the runtime counts UTF-16 code units (a tool description of astral characters).',
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
      // Bounded at `MAX_VALUE` ("finite") and deliberately not at
      // `MAX_SAFE_INTEGER`: a JSON number such as `1e400` parses to `Infinity`,
      // which the parser rejects but Ajv's bare `integer` check accepts, while
      // `2 ** 53`, `1e21`, `1e308` and `MAX_VALUE` are all integers the parser
      // *accepts*. A safe-integer bound would close the `Infinity` hole and open
      // a stricter-than-parser edge; this bound closes it and widens nothing.
      maximum: Number.MAX_VALUE,
      description: 'Manifest standard the package was written against (finite integer ≥ 1).',
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
    {
      // Untrusted workers only support actions/events, so a legacy plane
      // declaration is refused by the parser at manifest time. Mirroring it
      // here cannot become stricter than the parser: `untrusted` already
      // implies apiVersion 2 (previous rule), where `contributes` is strict.
      if: { properties: { kind: { const: 'untrusted' } }, required: ['kind'] },
      then: {
        properties: {
          contributes: {
            properties: {
              gateway: {
                not: {
                  anyOf: [
                    { required: ['runtime'] },
                    { required: ['media'] },
                    { required: ['tts'] },
                    { required: ['usage'] },
                  ],
                },
              },
            },
          },
        },
      },
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
        // Legacy singleton planes: named declarations, not arrays. `{}` is a
        // declaration whose name defaults to the package name.
        runtime: { $ref: '#/$defs/legacyNamePlane' },
        media: { $ref: '#/$defs/legacyMediaPlane' },
        tts: { $ref: '#/$defs/legacyNamePlane' },
        usage: { $ref: '#/$defs/legacyNamePlane' },
      },
    },
    legacyNamePlane: {
      type: 'object',
      additionalProperties: false,
      properties: {
        // Mirrors `readLegacyPlaneName`: a blank name can never match an
        // instance, so it is rejected rather than silently normalized.
        name: { type: 'string', minLength: 1, pattern: '\\S' },
      },
    },
    legacyMediaPlane: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1, pattern: '\\S' },
        modalities: { $ref: '#/$defs/stringList' },
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
