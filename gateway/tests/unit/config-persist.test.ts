import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Config } from '../../src/config';

describe('Config.persistOverrides', () => {
  let projectDir: string;
  let dataDir: string;
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persist-proj-'));
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persist-data-'));
    for (const key of ['MAFW_RUNTIME_PLUGIN', 'MAFW_SERVER_API_PORT', 'MAFW_MEDIA_ENGINE']) {
      envBackup[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(envBackup)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('persists merged runtime.plugin to data-dir config.yaml', () => {
    const cfg = new Config(projectDir, dataDir);
    const result = cfg.persistOverrides({ runtime: { plugin: 'pi' } });

    expect(result.changed).toContain('runtime');
    expect(cfg.raw.runtime.plugin).toBe('pi');

    const filePath = path.join(dataDir, 'config.yaml');
    expect(fs.existsSync(filePath)).toBe(true);
    const dumped = fs.readFileSync(filePath, 'utf-8');
    expect(dumped).toContain('plugin: pi');
  });

  test('partial override does not wipe other runtime keys', () => {
    const cfg = new Config(projectDir, dataDir);
    cfg.persistOverrides({ runtime: { pluginConfig: { pi: { approvalPolicy: { autoApprove: ['read'] } } } } });
    cfg.persistOverrides({ runtime: { plugin: 'pi' } });

    expect(cfg.raw.runtime.plugin).toBe('pi');
    expect(cfg.raw.runtime.pluginConfig).toEqual({ pi: { approvalPolicy: { autoApprove: ['read'] } } });
  });

  test('partial media override preserves sibling keys', () => {
    const cfg = new Config(projectDir, dataDir);
    cfg.persistOverrides({ media: { image: { engine: 'gemini-vision' } } });

    expect(cfg.raw.media.image.engine).toBe('gemini-vision');
    expect(cfg.raw.media.image.model).toBe('');
    expect(cfg.raw.media.provider).toBe('xiaomi');
  });

  test('overriding to empty string keeps the key (semantics decided by caller)', () => {
    const cfg = new Config(projectDir, dataDir);
    cfg.persistOverrides({ media: { video: { engine: 'qwen-vl' } } });
    cfg.persistOverrides({ media: { video: { engine: '' } } });
    expect(cfg.raw.media.video.engine).toBe('');
  });
});