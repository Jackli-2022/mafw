/**
 * service-monitor — reference MAFW unified plugin package.
 *
 * A dependency-free example that exercises every first-phase contribution:
 * one workbench panel, one config page, one tool card, one message window, a
 * handful of declarative actions and one registered package event.
 *
 * Copy this directory to a scratch location, install it from
 * Plugins → 安装本地目录, and read docs/guides/plugin-authoring.md for the
 * contract behind each field.
 */
'use strict';

const PACKAGE_NAME = 'service-monitor';
const PANEL_TITLE = 'Service Monitor';
const CHANGED_EVENT = 'plugin:service-monitor:changed';

const DEFAULT_CONFIG = {
  endpoint: 'https://status.example.com',
  intervalSeconds: 60,
  verbose: false,
};

const SERVICES = [
  { id: 'gateway', label: 'Gateway API' },
  { id: 'runtime', label: 'Agent runtime' },
  { id: 'memory', label: 'Memory index' },
];

const CONFIG_SCHEMA = {
  type: 'object',
  title: 'Service Monitor settings',
  description: 'Settings are stored under plugins.service-monitor.config.',
  properties: {
    endpoint: {
      type: 'string',
      title: 'Status endpoint',
      description: 'Where the dashboard reads status from.',
      minLength: 1,
      maxLength: 2048,
      default: DEFAULT_CONFIG.endpoint,
    },
    intervalSeconds: {
      type: 'integer',
      title: 'Check interval (seconds)',
      minimum: 5,
      maximum: 3600,
      default: DEFAULT_CONFIG.intervalSeconds,
    },
    verbose: {
      type: 'boolean',
      title: 'Verbose output',
      default: DEFAULT_CONFIG.verbose,
    },
  },
  required: ['endpoint', 'intervalSeconds', 'verbose'],
  additionalProperties: false,
};

const VIEW_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    subtitle: { type: 'string' },
    icon: { type: 'string' },
    body: { type: 'array', items: { type: 'object' } },
  },
  required: ['body'],
  additionalProperties: false,
};

function healthFor(id) {
  let sum = 0;
  for (let index = 0; index < id.length; index += 1) sum += id.charCodeAt(index);
  return 40 + (sum % 61);
}

function clip(value, max) {
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (typeof text !== 'string') text = String(text);
  const limit = typeof max === 'number' ? max : 400;
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function readConfig(ctx) {
  const raw = ctx.pluginConfig() || {};
  const endpoint =
    typeof raw.endpoint === 'string' && raw.endpoint.length > 0
      ? raw.endpoint
      : DEFAULT_CONFIG.endpoint;
  const intervalSeconds =
    Number.isInteger(raw.intervalSeconds) && raw.intervalSeconds >= 5 && raw.intervalSeconds <= 3600
      ? raw.intervalSeconds
      : DEFAULT_CONFIG.intervalSeconds;
  return {
    endpoint,
    intervalSeconds,
    verbose: raw.verbose === true,
  };
}

function buildPanelView(config, checks, serviceFilter) {
  const services = serviceFilter
    ? SERVICES.filter((service) => service.id === serviceFilter)
    : SERVICES;
  const rows = services.map((service) => ({
    id: service.id,
    label: service.label,
    health: healthFor(service.id),
  }));
  const up = rows.filter((row) => row.health >= 60).length;
  const availability = rows.length === 0 ? 0 : Math.round((up / rows.length) * 100);

  const body = [
    {
      type: 'kv',
      rows: [
        ['Endpoint', config.endpoint],
        ['Interval', `${config.intervalSeconds}s`],
        ['Checks', String(checks)],
      ],
    },
    {
      type: 'progress',
      value: availability,
      label: `${up}/${rows.length} services up`,
    },
    {
      type: 'list',
      items: rows.map((row) => ({
        type: 'text',
        text: `${row.health >= 60 ? 'UP' : 'DOWN'} ${row.label} - ${row.health}%`,
      })),
    },
    {
      type: 'row',
      children: [
        { type: 'action', label: 'Refresh now', action: 'refresh', style: 'primary' },
        { type: 'action', label: 'Message preview', action: 'messageView', input: {
          event: {
            type: CHANGED_EVENT,
            properties: { checked: checks, at: new Date().toISOString(), source: 'manual' },
          },
        } },
      ],
    },
  ];
  if (config.verbose) {
    body.push({
      type: 'markdown',
      text: '**Verbose mode** is on. Configuration saves emit `' + CHANGED_EVENT + '`.',
    });
  }
  if (serviceFilter) {
    body.push({ type: 'text', text: `Filtered to service "${serviceFilter}".` });
  }
  return {
    title: PANEL_TITLE,
    subtitle: `Checking ${SERVICES.length} services every ${config.intervalSeconds}s`,
    icon: 'activity',
    body,
  };
}

function messagePayload(input) {
  // Desktop invokes a message window `viewAction` with the canonical nested
  // shape `{ event: { type, properties }, sessionID? }`. Older direct widget
  // calls may still pass the flat properties object, so accept both.
  const event = input && typeof input.event === 'object' && input.event !== null ? input.event : null;
  const properties =
    event && typeof event.properties === 'object' && event.properties !== null
      ? event.properties
      : input;
  return properties && typeof properties === 'object' ? properties : {};
}

function buildMessageView(input, endpoint) {
  const payload = messagePayload(input);
  const checked = typeof payload.checked === 'number' ? payload.checked : 0;
  const at = typeof payload.at === 'string' ? payload.at : 'unknown time';
  const source = typeof payload.source === 'string' ? payload.source : 'manual';
  return {
    title: 'Service status changed',
    subtitle: at,
    body: [
      {
        type: 'markdown',
        text: `Service monitor recorded **${checked}** check(s) from \`${source}\`.`,
      },
      {
        type: 'kv',
        rows: [
          ['Source', source],
          ['At', at],
          ['Endpoint', endpoint],
        ],
      },
      { type: 'action', label: 'Refresh panel', action: 'refresh', style: 'primary' },
    ],
  };
}

module.exports = {
  name: PACKAGE_NAME,
  async activate(ctx) {
    let checks = 0;

    const emitChanged = (source) => {
      ctx.emit({
        type: CHANGED_EVENT,
        properties: {
          checked: checks,
          at: new Date().toISOString(),
          source,
        },
      });
    };

    return {
      ui: {
        panels: [
          {
            id: 'overview',
            title: PANEL_TITLE,
            icon: 'activity',
            order: 40,
            viewAction: 'refresh',
            refreshOn: [CHANGED_EVENT],
          },
        ],
        configPages: [
          {
            id: 'settings',
            title: 'Service Monitor settings',
            schema: CONFIG_SCHEMA,
            loadAction: 'loadConfig',
            saveAction: 'saveConfig',
            reloadOnSave: false,
          },
        ],
        toolCards: [
          {
            id: 'service-tool',
            tools: ['bash', 'shell'],
            // `bash` already has a built-in Desktop card. Without `override`
            // the whole alias group (bash + mafw_bash + shell + mafw_shell) is
            // skipped, so the example would never render a card.
            override: true,
            viewAction: 'toolCard',
          },
        ],
        messageWindows: [
          {
            id: 'status-change',
            title: 'Service status changed',
            triggerEvent: CHANGED_EVENT,
            viewAction: 'messageView',
            modal: false,
            dismissible: true,
          },
        ],
      },
      events: [
        {
          type: CHANGED_EVENT,
          title: 'Service status changed',
          description: 'Emitted after a configuration save (a user action, not the panel viewAction).',
          scope: 'global',
          schema: {
            type: 'object',
            properties: {
              checked: { type: 'integer', minimum: 0 },
              at: { type: 'string' },
              source: { type: 'string' },
            },
            required: ['checked', 'at', 'source'],
            additionalProperties: false,
          },
        },
      ],
      actions: {
        refresh: {
          title: 'Refresh service status',
          description: 'Returns the panel view without emitting the changed event.',
          timeoutMs: 5000,
          inputSchema: {
            type: 'object',
            properties: {
              service: { type: 'string', title: 'Service id (optional filter)' },
            },
            additionalProperties: false,
          },
          outputSchema: VIEW_OUTPUT_SCHEMA,
          handler(input) {
            checks += 1;
            const serviceFilter =
              input && typeof input.service === 'string' && input.service.length > 0
                ? input.service
                : undefined;
            // This action is the panel's viewAction and the panel refreshes on
            // CHANGED_EVENT. A viewAction must never emit its own refreshOn
            // event or Desktop would re-invoke it forever.
            return buildPanelView(readConfig(ctx), checks, serviceFilter);
          },
        },
        loadConfig: {
          title: 'Load settings',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          handler() {
            return readConfig(ctx);
          },
        },
        saveConfig: {
          title: 'Save settings',
          inputSchema: CONFIG_SCHEMA,
          outputSchema: {
            type: 'object',
            properties: {
              saved: { type: 'boolean' },
              config: { type: 'object' },
            },
            required: ['saved', 'config'],
            additionalProperties: false,
          },
          handler(input) {
            ctx.config.update({
              endpoint: input.endpoint,
              intervalSeconds: input.intervalSeconds,
              verbose: input.verbose,
            });
            emitChanged('saveConfig');
            return { saved: true, config: readConfig(ctx) };
          },
        },
        toolCard: {
          title: 'Render a tool card',
          description: 'Receives the neutral ToolCardModel from Desktop.',
          inputSchema: {
            type: 'object',
            properties: {
              tool: { type: 'string' },
              status: { type: 'string' },
              input: {},
              output: {},
              metadata: {},
            },
            required: ['tool', 'status'],
            additionalProperties: true,
          },
          outputSchema: VIEW_OUTPUT_SCHEMA,
          handler(input) {
            return {
              title: `${PANEL_TITLE}: ${input.tool}`,
              subtitle: `Tool status: ${input.status}`,
              body: [
                {
                  type: 'kv',
                  rows: [
                    ['Tool', input.tool],
                    ['Status', input.status],
                  ],
                },
                { type: 'code', language: 'json', text: clip(input.input) },
                { type: 'code', language: 'text', text: clip(input.output) },
                { type: 'action', label: 'Refresh monitor', action: 'refresh' },
              ],
            };
          },
        },
        messageView: {
          title: 'Render a message window',
          description: 'Receives the canonical window payload (registered event plus sessionID when present).',
          inputSchema: {
            type: 'object',
            properties: {
              event: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  properties: { type: 'object' },
                },
                required: ['type', 'properties'],
              },
              sessionID: { type: 'string' },
            },
            additionalProperties: true,
          },
          outputSchema: VIEW_OUTPUT_SCHEMA,
          handler(input) {
            return buildMessageView(input || {}, readConfig(ctx).endpoint);
          },
        },
      },
    };
  },
};
