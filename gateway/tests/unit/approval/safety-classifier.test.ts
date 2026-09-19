import { classifySafety, commandTextOf } from '../../../src/core/approval/safety-classifier';

describe('classifySafety（白名单 + 危险正则）', () => {
  it('只读白名单工具恒 safe（含大写）', () => {
    for (const t of ['read', 'grep', 'glob', 'ls', 'find', 'Read', 'GREP']) {
      expect(classifySafety({ toolName: t, patterns: [] })).toBe('safe');
    }
  });

  it('rm 带 -r/-f 旗标 → dangerous；无旗标 safe', () => {
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'rm -rf /tmp/x' } } })).toBe('dangerous');
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'rm -fr a' } } })).toBe('dangerous');
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'rm file.txt' } } })).toBe('safe');
  });

  it('git 破坏性命令 → dangerous', () => {
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'git push --force origin main' } } })).toBe('dangerous');
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'git push -f' } } })).toBe('dangerous');
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'git reset --hard HEAD~3' } } })).toBe('dangerous');
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'git clean -fd' } } })).toBe('dangerous');
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'git status' } } })).toBe('safe');
  });

  it('数据库/磁盘/系统命令 → dangerous', () => {
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'psql -c "drop table users"' } } })).toBe('dangerous');
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'TRUNCATE TABLE users' } } })).toBe('dangerous');
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'mkfs.ext4 /dev/sda1' } } })).toBe('dangerous');
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'shutdown /s /t 0' } } })).toBe('dangerous');
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'dd if=img.iso of=/dev/sdb' } } })).toBe('dangerous');
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'format c:' } } })).toBe('dangerous');
  });

  it('fork bomb → dangerous', () => {
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: ':(){ :|:& };:' } } })).toBe('dangerous');
  });

  it('patterns 兜底：无 args 时用 patterns 判定', () => {
    expect(classifySafety({ toolName: 'bash', patterns: ['git push --force'] })).toBe('dangerous');
    expect(classifySafety({ toolName: 'bash', patterns: ['npm test'] })).toBe('safe');
  });

  it('写类安全命令 → safe', () => {
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'npm run build' } } })).toBe('safe');
    expect(classifySafety({ toolName: 'edit', patterns: ['src/app.ts'] })).toBe('safe');
  });

  it('commandTextOf：args.command 优先，args 字符串次之，patterns 兜底', () => {
    expect(commandTextOf({ toolName: 'bash', patterns: ['p'], metadata: { args: { command: 'cmd' } } })).toBe('cmd');
    expect(commandTextOf({ toolName: 'bash', patterns: ['p'], metadata: { args: 'raw string' } })).toBe('raw string');
    expect(commandTextOf({ toolName: 'bash', patterns: ['a', 'b'] })).toBe('a b');
  });
});
