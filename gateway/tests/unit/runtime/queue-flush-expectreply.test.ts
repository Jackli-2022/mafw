import { readFileSync } from 'fs';
import { join } from 'path';
const src = readFileSync(join(__dirname, '../../../src/index.ts'), 'utf8');

describe('终审 #1 修复：flush 保真 expectReply（noReply 通知不得变 LLM 回合）', () => {
  it('QueuedItem 捕获 expectReply（enqueue 侧）', () => {
    const i = src.indexOf('private async enqueueQueuedPrompt(');
    const seg = src.slice(i, i + 900);
    expect(seg).toContain('expectReply');
  });
  it('flush 发送带 expectReply（经 runtime.session.promptAsync 对象形参——不经丢字段的 facade）', () => {
    const i = src.indexOf('private flushSessionQueue(');
    const seg = src.slice(i, i + 900);
    expect(seg).toContain('expectReply');
    expect(seg).toMatch(/this\.runtime!\.session\.promptAsync\(sendOpts\)/);
    expect(seg).toMatch(/sendOpts: any = \{/);
  });
});
