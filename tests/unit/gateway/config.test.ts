import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Config, GatewayConfig } from '../../../gateway/src/config';

describe('Config', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns default values when no file or env overrides', () => {
    const cfg = new Config(tmpDir);
    expect(cfg.server.apiPort).toBe(3000);
    expect(cfg.server.serveUrl).toBe('http://127.0.0.1:4096');
    expect(cfg.loop.maxRounds).toBe(3);
    expect(cfg.loop.maxLoops).toBe(5);
    expect(cfg.search.defaultTopK).toBe(20);
    expect(cfg.timeouts.backupPollInterval).toBe(30000);
    expect(cfg.paths.projectDir).toBe(tmpDir);
  });

  it('resolves paths relative to mafwDir', () => {
    const cfg = new Config(tmpDir);
    expect(cfg.resolvePath('state')).toBe(path.join(tmpDir, '.mafw', 'state'));
    expect(cfg.resolvePath('requests', 'goal-1.json')).toBe(path.join(tmpDir, '.mafw', 'requests', 'goal-1.json'));
  });

  it('loads project-level YAML config', () => {
    const mafwDir = path.join(tmpDir, '.mafw');
    fs.mkdirSync(mafwDir, { recursive: true });
    fs.writeFileSync(path.join(mafwDir, 'config.yaml'), `
server:
  apiPort: 4000
loop:
  maxRounds: 5
`, 'utf-8');

    const cfg = new Config(tmpDir);
    expect(cfg.server.apiPort).toBe(4000);
    expect(cfg.loop.maxRounds).toBe(5);
    expect(cfg.search.defaultTopK).toBe(20);
  });

  it('env var overrides YAML config', () => {
    const oldPort = process.env.MAFW_SERVER_API_PORT;
    process.env.MAFW_SERVER_API_PORT = '5000';

    try {
      const cfg = new Config(tmpDir);
      expect(cfg.server.apiPort).toBe(5000);
    } finally {
      if (oldPort) process.env.MAFW_SERVER_API_PORT = oldPort;
      else delete process.env.MAFW_SERVER_API_PORT;
    }
  });

  it('env var overrides nested config values', () => {
    const old = process.env.MAFW_LOOP_MAX_ROUNDS;
    process.env.MAFW_LOOP_MAX_ROUNDS = '7';

    try {
      const cfg = new Config(tmpDir);
      expect(cfg.loop.maxRounds).toBe(7);
    } finally {
      if (old) process.env.MAFW_LOOP_MAX_ROUNDS = old;
      else delete process.env.MAFW_LOOP_MAX_ROUNDS;
    }
  });

  it('env var handles arrays as comma-separated', () => {
    const old = process.env.MAFW_CHAT_EXECUTE_GRAPH_KEYWORDS;
    process.env.MAFW_CHAT_EXECUTE_GRAPH_KEYWORDS = 'go,run,start';

    try {
      const cfg = new Config(tmpDir);
      expect(cfg.chat.executeGraphKeywords).toEqual(['go', 'run', 'start']);
    } finally {
      if (old) process.env.MAFW_CHAT_EXECUTE_GRAPH_KEYWORDS = old;
      else delete process.env.MAFW_CHAT_EXECUTE_GRAPH_KEYWORDS;
    }
  });

  it('prioritizes env > project YAML > defaults', () => {
    const mafwDir = path.join(tmpDir, '.mafw');
    fs.mkdirSync(mafwDir, { recursive: true });
    fs.writeFileSync(path.join(mafwDir, 'config.yaml'), `
server:
  apiPort: 4000
`, 'utf-8');

    const oldPort = process.env.MAFW_SERVER_API_PORT;
    process.env.MAFW_SERVER_API_PORT = '6000';

    try {
      const cfg = new Config(tmpDir);
      expect(cfg.server.apiPort).toBe(6000);
    } finally {
      if (oldPort) process.env.MAFW_SERVER_API_PORT = oldPort;
      else delete process.env.MAFW_SERVER_API_PORT;
    }
  });

  it('ignores missing YAML file', () => {
    const cfg = new Config(tmpDir);
    expect(cfg.server.apiPort).toBe(3000);
  });

  it('provides typed accessors for all config groups', () => {
    const cfg = new Config(tmpDir);
    expect(cfg.server).toBeDefined();
    expect(cfg.paths).toBeDefined();
    expect(cfg.timeouts).toBeDefined();
    expect(cfg.loop).toBeDefined();
    expect(cfg.search).toBeDefined();
    expect(cfg.memory).toBeDefined();
    expect(cfg.llm).toBeDefined();
    expect(cfg.mcpserver).toBeDefined();
    expect(cfg.metrics).toBeDefined();
    expect(cfg.chat).toBeDefined();
    expect(cfg.alignment).toBeDefined();
    expect(cfg.env).toBeDefined();
  });
});
