import * as fs from 'fs';
import * as path from 'path';

const read = (file: string) => fs.readFileSync(path.join(__dirname, '../../../src', file), 'utf8');

test('boot wires plugin events and plugin actions into automation', () => {
  const boot = read('boot.ts');
  expect(boot).toContain('onEvent: (event) => kernel.handlePluginEvent(event)');
  expect(boot).toContain('kernel.bindPluginAutomation(kernel.pluginHost)');

  const kernel = read('kernel.ts');
  expect(kernel).toContain('handlePluginEvent(event: PluginEventFrame)');
  expect(kernel).toContain('createPluginAutomationActionResolver');
  expect(kernel).toContain('setExternalActionResolver');
});
