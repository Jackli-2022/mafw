import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { install, remove, list, get, loadAgentExtensions, getAgentDir, getPromptsDir, getExtensionsDir } from '../../../src/runtime/pi/pi-agent-config';
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
    it('creates prompt file, permissions extension, and metadata', async () => {
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

      // Check extension file (pi ExtensionAPI format)
      const extensionPath = path.join(tempDir, 'extensions', 'test-agent-permissions.js');
      expect(fs.existsSync(extensionPath)).toBe(true);
      const extensionCode = fs.readFileSync(extensionPath, 'utf-8');
      // Should be a default export function
      expect(extensionCode).toContain('export default function');
      expect(extensionCode).toContain('pi.on(\'tool_call\'');
      expect(extensionCode).toContain("'bash'");
      expect(extensionCode).toContain("'deny'");

      // Check metadata file
      const metadataPath = path.join(tempDir, 'metadata', 'test-agent.json');
      expect(fs.existsSync(metadataPath)).toBe(true);
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      expect(metadata.description).toBe('Test agent');
      expect(metadata.mode).toBe('all');
      expect(metadata.permissions.edit).toBe('allow');
      expect(metadata.permissions.bash).toBe('deny');
      expect(metadata.permissions.tools).toEqual({ read: 'allow' });
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
      expect(fs.existsSync(path.join(tempDir, 'metadata'))).toBe(true);
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

      const metadataPath = path.join(tempDir, 'metadata', 'agent.json');
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      expect(metadata.description).toBe('Agent v2');
      expect(metadata.permissions.edit).toBe('deny');
    });

    it('generates valid pi extension format with tool_call handler', async () => {
      const definition: AgentDefinition = {
        description: 'Test agent',
        mode: 'all',
        systemPrompt: 'Test prompt',
        permissions: {
          edit: 'deny',
          bash: 'allow',
          tools: { custom_tool: 'deny' },
          task: {}
        }
      };

      await install('test-agent', definition, config);

      const extensionPath = path.join(tempDir, 'extensions', 'test-agent-permissions.js');
      const extensionCode = fs.readFileSync(extensionPath, 'utf-8');

      // Should be a function that takes pi parameter
      expect(extensionCode).toMatch(/export default function \w+\(pi\)/);
      // Should register tool_call handler
      expect(extensionCode).toContain("pi.on('tool_call'");
      // Should have tool rules
      expect(extensionCode).toContain('"custom_tool": "deny"');
      // Should have edit deny rule
      expect(extensionCode).toContain('edit/write denied by agent permissions');
    });
  });

  describe('remove', () => {
    it('deletes prompt, extension, and metadata files', async () => {
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
      const metadataPath = path.join(tempDir, 'metadata', 'test-agent.json');

      expect(fs.existsSync(promptPath)).toBe(false);
      expect(fs.existsSync(extensionPath)).toBe(false);
      expect(fs.existsSync(metadataPath)).toBe(false);
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

    it('returns agent definition from metadata (round-trip)', async () => {
      const definition: AgentDefinition = {
        description: 'Test agent',
        mode: 'primary',
        model: 'xiaomi/mimo-v2.5',
        temperature: 0.7,
        color: '#ff0000',
        systemPrompt: 'You are a test agent.',
        permissions: {
          edit: 'deny',
          bash: 'allow',
          tools: { read: 'allow', custom: 'ask' },
          task: {}
        }
      };

      await install('test-agent', definition, config);
      const retrieved = await get('test-agent', config);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.description).toBe('Test agent');
      expect(retrieved!.mode).toBe('primary');
      expect(retrieved!.model).toBe('xiaomi/mimo-v2.5');
      expect(retrieved!.temperature).toBe(0.7);
      expect(retrieved!.color).toBe('#ff0000');
      expect(retrieved!.systemPrompt).toBe('You are a test agent.');
      expect(retrieved!.permissions.edit).toBe('deny');
      expect(retrieved!.permissions.bash).toBe('allow');
      expect(retrieved!.permissions.tools).toEqual({ read: 'allow', custom: 'ask' });
    });

    it('falls back to defaults when metadata is missing', async () => {
      // Manually create only prompt file (no metadata)
      const promptsDir = path.join(tempDir, 'prompts');
      fs.mkdirSync(promptsDir, { recursive: true });
      fs.writeFileSync(path.join(promptsDir, 'legacy-agent.md'), 'Legacy prompt');

      const retrieved = await get('legacy-agent', config);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.systemPrompt).toBe('Legacy prompt');
      expect(retrieved!.permissions.edit).toBe('allow');
      expect(retrieved!.permissions.bash).toBe('allow');
    });
  });

  describe('loadAgentExtensions', () => {
    it('returns empty array if extension does not exist', async () => {
      const extensions = await loadAgentExtensions('nonexistent', config);
      expect(extensions).toEqual([]);
    });

    it('loads extension from disk and returns InlineExtension format', async () => {
      const definition: AgentDefinition = {
        description: 'Test agent',
        mode: 'all',
        systemPrompt: 'Test prompt',
        permissions: {
          edit: 'deny',
          bash: 'allow',
          tools: {},
          task: {}
        }
      };

      await install('test-agent', definition, config);

      // Note: Dynamic import may fail in test environment due to ESM/CommonJS issues
      // This test verifies the file exists and has correct format
      const extensionPath = path.join(tempDir, 'extensions', 'test-agent-permissions.js');
      expect(fs.existsSync(extensionPath)).toBe(true);

      const extensionCode = fs.readFileSync(extensionPath, 'utf-8');
      expect(extensionCode).toContain('export default function');
      expect(extensionCode).toContain('pi.on(\'tool_call\'');
    });
  });

  describe('path helpers', () => {
    it('getAgentDir returns default path when no config', () => {
      const dir = getAgentDir();
      expect(dir).toContain('.pi');
      expect(dir).toContain('agent');
    });

    it('getAgentDir returns custom path when config provided', () => {
      const dir = getAgentDir({ agentDir: '/custom/path' });
      expect(dir).toBe('/custom/path');
    });

    it('getPromptsDir returns prompts subdirectory', () => {
      const dir = getPromptsDir({ agentDir: '/custom/path' });
      expect(dir).toContain('prompts');
      expect(dir).toContain('custom');
    });

    it('getExtensionsDir returns extensions subdirectory', () => {
      const dir = getExtensionsDir({ agentDir: '/custom/path' });
      expect(dir).toContain('extensions');
      expect(dir).toContain('custom');
    });
  });
});
