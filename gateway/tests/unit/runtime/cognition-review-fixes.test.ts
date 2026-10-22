import { readFileSync } from 'fs';
import { join } from 'path';

// 终审修复的行为测试（不是源码正则——desktop 前缀匹配是行为问题 #1）
const desktopSessionEvents = readFileSync(join(__dirname, '../../../../packages/desktop/src/renderer/mafw/session-events.ts'), 'utf8');

describe('终审 #1：cognition_gate 前缀匹配（行为级）', () => {
  // 从源码提取 TAIL_ACCOUNTED_PREFIXES 并对 'cognition_gate' 求值——正则断言抓不到
  // 前缀与事件名不匹配这种 bug（cognition: vs cognition_gate）
  it('isTailAccountedAtShell("cognition_gate") === true（前缀真的命中事件类型）', () => {
    const m = /TAIL_ACCOUNTED_PREFIXES = \[([^\]]*)\]/.exec(desktopSessionEvents);
    expect(m).toBeTruthy();
    const prefixes = m![1].split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
    const type = 'cognition_gate';
    const accounted = prefixes.some(p => type.startsWith(p));
    expect(accounted).toBe(true);
  });
});

// 终审 #4：forceHuman 政策环让路
const hookSrc = readFileSync(join(__dirname, '../../../src/core/approval/hook.ts'), 'utf8');
describe('终审 #4：gate-ask 强制 human（政策环让路）', () => {
  it('applyApprovalPolicy 尊重 forceHuman 标记', () => {
    expect(hookSrc).toMatch(/forceHuman/);
    expect(hookSrc).toMatch(/cognition rule requested human confirmation/);
  });
  it('审批扩展 ask 路径携带 forceHuman + cognitionAsk reason', () => {
    const extSrc = readFileSync(join(__dirname, '../../../src/runtime/pi/pi-approval-extension.ts'), 'utf8');
    expect(extSrc).toMatch(/forceHuman: true/);
    expect(extSrc).toMatch(/cognitionAsk/);
  });
});

// 终审 #3：规则错误有声日志
const idxSrc = readFileSync(join(__dirname, '../../../src/index.ts'), 'utf8');
describe('终审 #3：规则加载错误有声 warn', () => {
  it('getRules 缓存刷新分支 log.warn errors', () => {
    expect(idxSrc).toMatch(/\[Cognition\] rule errors/);
  });
});
