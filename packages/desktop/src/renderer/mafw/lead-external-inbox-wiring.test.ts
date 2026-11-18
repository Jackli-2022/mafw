import * as fs from 'node:fs';
import { test, expect } from 'bun:test';

function read(relative: string): string {
  return fs.readFileSync(new URL(relative, import.meta.url), 'utf-8');
}

test('ChatPane renders the Lead external inbox and receives the pod id', () => {
  const pane = read('./components/ChatPane.tsx');
  expect(pane).toMatch(/LeadExternalInbox/);
  expect(pane).toMatch(/leadPodId/);
});

test('MafwShell passes the current Lead pod to ChatPane', () => {
  const shell = read('./MafwShell.tsx');
  expect(shell).toMatch(/leadPodId=\{.*podStore\.detail\(\)\?\.pod\.id/);
});

test('the inbox reads and answers deliveries through the preload API', () => {
  const inbox = read('./components/LeadExternalInbox.tsx');
  expect(inbox).toMatch(/events\.deliveries/);
  expect(inbox).toMatch(/events\.readDelivery/);
  expect(inbox).toMatch(/events\.answerDelivery/);
});
