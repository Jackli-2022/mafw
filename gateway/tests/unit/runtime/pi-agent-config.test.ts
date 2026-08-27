import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { install, remove, list, get } from '../../../src/runtime/pi/pi-agent-config';
import type { AgentDefinition } from '../../../src/runtime/agent-definition';

describe('pi-agent-config', () => {
  let tempDir: string;
  let config: { agentDir: string };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-agent-config-test-'));
    config = { agentDir: tempDir };
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('install', () => {
    it('creates prompt file and permissions extension', async () => {
      const definition: AgentDefinition = {
        description: 'Test agent',
        mode: 'all',
        systemPrompt: 'You are a test agent.',
        permissions: {
          edit: 'allow',
          bash: 'deny',
          tools: { read: 'allow' },
          task: {}
        }
      };

      await install('test-agent', definition, config);

      // Check prompt file
      const promptPath = path.join(tempDir, 'prompts', 'test-agent.md');
      expect(fs.existsSync(promptPath)).toBe(true);
      expect(fs.readFileSync(promptPath, 'utf-8')).toBe('You are a test agent.');

      // Check extension file
      const extensionPath = path.join(tempDir, 'extensions', 'test-agent-permissions.js');
      expect(fs.existsSync(extensionPath)).toBe(true);
      const extensionCode = fs.readFileSync(extensionPath, 'utf-8');
      expect(extensionCode).toContain("name: 'test-agent-permissions'");
      expect(extensionCode).toContain("'bash'");
      expect(extensionCode).toContain("'deny'");
    });

    it('creates directories if they do not exist', async () => {
      const definition: AgentDefinition = {
        description: 'Test agent',
        mode: 'all',
        systemPrompt: 'Test prompt',
        permissions: {
          edit: 'allow',
          bash: 'allow',
          tools: {},
          task: {}
        }
      };

      await install('new-agent', definition, config);

      expect(fs.existsSync(path.join(tempDir, 'prompts'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'extensions'))).toBe(true);
    });

    it('overwrites existing files', async () => {
      const definition1: AgentDefinition = {
        description: 'Agent v1',
        mode: 'all',
        systemPrompt: 'Version 1',
        permissions: {
          edit: 'allow',
          bash: 'allow',
          tools: {},
          task: {}
        }
      };

      const definition2: AgentDefinition = {
        description: 'Agent v2',
        mode: 'all',
        systemPrompt: 'Version 2',
        permissions: {
          edit: 'deny',
          bash: 'deny',
          tools: {},
          task: {}
        }
      };

      await install('agent', definition1, config);
      await install('agent', definition2, config);

      const promptPath = path.join(tempDir, 'prompts', 'agent.md');
      expect(fs.readFileSync(promptPath, 'utf-8')).toBe('Version 2');
    });
  });

  describe('remove', () => {
    it('deletes prompt and extension files', async () => {
      const definition: AgentDefinition = {
        description: 'Test agent',
        mode: 'all',
        systemPrompt: 'Test prompt',
        permissions: {
          edit: 'allow',
          bash: 'allow',
          tools: {},
          task: {}
        }
      };

      await install('test-agent', definition, config);
      await remove('test-agent', config);

      const promptPath = path.join(tempDir, 'prompts', 'test-agent.md');
      const extensionPath = path.join(tempDir, 'extensions', 'test-agent-permissions.js');

      expect(fs.existsSync(promptPath)).toBe(false);
      expect(fs.existsSync(extensionPath)).toBe(false);
    });

    it('does not throw if files do not exist', async () => {
      await expect(remove('nonexistent', config)).resolves.not.toThrow();
    });
  });

  describe('list', () => {
    it('returns empty array if prompts directory does not exist', async () => {
      const agents = await list(config);
      expect(agents).toEqual([]);
    });

    it('returns list of agent names', async () => {
      const definition: AgentDefinition = {
        description: 'Test agent',
        mode: 'all',
        systemPrompt: 'Test prompt',
        permissions: {
          edit: 'allow',
          bash: 'allow',
          tools: {},
          task: {}
        }
      };

      await install('agent1', definition, config);
      await install('agent2', definition, config);

      const agents = await list(config);
      expect(agents).toEqual(['agent1', 'agent2']);
    });

    it('filters out non-md files', async () => {
      const promptsDir = path.join(tempDir, 'prompts');
      fs.mkdirSync(promptsDir, { recursive: true });
      fs.writeFileSync(path.join(promptsDir, 'agent1.md'), 'prompt1');
      fs.writeFileSync(path.join(promptsDir, 'readme.txt'), 'readme');

      const agents = await list(config);
      expect(agents).toEqual(['agent1']);
    });
  });

  describe('get', () => {
    it('returns null if agent does not exist', async () => {
      const agent = await get('nonexistent', config);
      expect(agent).toBeNull();
    });

    it('returns agent definition with system prompt', async () => {
      const definition: AgentDefinition = {
        description: 'Test agent',
        mode: 'all',
        systemPrompt: 'You are a test agent.',
        permissions: {
          edit: 'allow',
          bash: 'deny',
          tools: { read: 'allow' },
          task: {}
        }
      };

      await install('test-agent', definition, config);
      const retrieved = await get('test-agent', config);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.systemPrompt).toBe('You are a test agent.');
      expect(retrieved!.permissions.edit).toBe('allow');
      expect(retrieved!.permissions.bash).toBe('deny');
    });
  });
});
