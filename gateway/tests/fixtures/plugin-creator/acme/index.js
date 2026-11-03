/**
 * acme — deterministic Creator fixture package.
 *
 * One panel whose `viewAction` is the only action. Kept dependency-free so the
 * draft fingerprint only ever sees three plain files and its `acme.test.js`
 * passes under `node --test` from the draft directory.
 */
'use strict';

const PACKAGE_NAME = 'acme';
const PANEL_TITLE = 'Acme Console';

module.exports = {
  name: PACKAGE_NAME,
  async activate() {
    return {
      ui: {
        panels: [
          {
            id: 'overview',
            title: PANEL_TITLE,
            icon: 'layout-grid',
            order: 50,
            viewAction: 'overview',
          },
        ],
      },
      actions: {
        overview: {
          title: 'Acme overview',
          description: 'Returns the panel view; the panel refreshOn list stays empty on purpose.',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          outputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              body: { type: 'array', items: { type: 'object' } },
            },
            required: ['title', 'body'],
            additionalProperties: false,
          },
          handler() {
            return {
              title: PANEL_TITLE,
              body: [{ type: 'text', text: 'Acme is ready.' }],
            };
          },
        },
      },
    };
  },
};
