'use strict';

const test = require('node:test');
const assert = require('node:assert');

const pkg = require('./index.js');

test('declares one panel backed by one action', async () => {
  assert.equal(pkg.name, 'acme');

  const contributions = await pkg.activate({});
  const panel = contributions.ui.panels[0];
  assert.equal(panel.id, 'overview');
  assert.equal(panel.viewAction, 'overview');

  const view = contributions.actions.overview.handler({});
  assert.equal(view.title, panel.title);
  assert.equal(view.body[0].type, 'text');
});
