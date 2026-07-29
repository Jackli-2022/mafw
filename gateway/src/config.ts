import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';

export interface GatewayConfig {
  server: {
    apiPort: number;
    serveUrl: string;
    servePort: number;
    serveHost: string;
    mcpUrl: string;
    dashboardPort: number;
    cors: { origin: string; methods: string; headers: string };
  };
  paths: {
    projectDir: string;
    mafwDir: string;
    globalConfig: string;
    registryFile: string;
    dashboardPublic: string;
    mcpServerScript: string;
  };
  timeouts: {
    serveReadyWait: number;
    serveHealthCheckInterval: number;
    serveRestartDelay: number;
    serveReadyMaxRetries: number;
    backupPollInterval: number;
    graphRunTimeout: number;
    heartbeatTimeout: number;
    sessionRequestTimeout: number;
    sessionHealthCheckTimeout: number;
    serverWaitTimeout: number;
    serverWaitRetryInterval: number;
    triageDeadline: number;
    stuckLoopTimeout: number;
    llmApiTimeout: number;
    streamingCharDelay: number;
  };
  loop: {
    maxRounds: number;
    maxLoops: number;
    initialRound: number;
    degradeOnLoopFactor: number;
  };
  search: {
    defaultTopK: number;
    maxMemoryResults: number;
    axiomsTopK: number;
  };
  memory: {
    defaultEnergy: number;
    defaultMemoryType: string;
    maxCueAnchors: number;
    abstractionMaxLength: number;
    defaultPrimaryAbstractionLength: number;
    defaultSalience: number;
  };
  llm: {
    defaultProvider: string;
    defaultModel: string;
    apiKeyEnv: string;
    anthropicVersion: string;
    maxTokens: number;
  };
  logging: {
    logDir: string;
    maxFileSize: number;
    logLevel: string;
  };
  mcpserver: {
    name: string;
    version: string;
    transportPath: string;
  };
  metrics: {
    maxInMemory: number;
    pruneRetainCount: number;
    recentSnapshotSize: number;
    maxEventEmitterListeners: number;
  };
  chat: {
    executeGraphKeywords: string[];
    searchMemoryKeywords: string[];
  };
  manager: {
    wakeCooldownMs: number;
    reportIntervalMin: number;
  };
  alignment: {
    userWeightsFile: string;
  };
  env: {
    mafwOpencodePath: string;
    enableLegacyMcp: string;
    mafwProjectDir: string;
  };
}

function defaults(projectDir: string): GatewayConfig {
  return {
    server: {
      apiPort: 3000,
      serveUrl: 'http://127.0.0.1:4096',
      servePort: 4096,
      serveHost: '127.0.0.1',
      mcpUrl: 'http://localhost:3001/sse',
      dashboardPort: 3111,
      cors: {
        origin: '*',
        methods: 'GET, POST, OPTIONS',
        headers: 'Content-Type',
      },
    },
    paths: {
      projectDir,
      mafwDir: '.mafw',
      globalConfig: path.join(os.homedir(), '.config', 'mafw', 'config.yaml'),
      registryFile: path.join(projectDir, 'scheduler', 'registered-projects.json'),
      dashboardPublic: path.join(__dirname, '..', 'dist', 'dashboard', 'public'),
      mcpServerScript: './core/mcp-server.js',
    },
    timeouts: {
      serveReadyWait: 60000,
      serveHealthCheckInterval: 1000,
      serveRestartDelay: 5000,
      serveReadyMaxRetries: 60,
      backupPollInterval: 30000,
      graphRunTimeout: 120000,
      heartbeatTimeout: 300000,
      sessionRequestTimeout: 10000,
      sessionHealthCheckTimeout: 5000,
      serverWaitTimeout: 30000,
      serverWaitRetryInterval: 1000,
      triageDeadline: 86400000,
      stuckLoopTimeout: 300000,
      llmApiTimeout: 15000,
      streamingCharDelay: 20,
    },
    loop: {
      maxRounds: 3,
      maxLoops: 5,
      initialRound: 1,
      degradeOnLoopFactor: 0.6,
    },
    search: {
      defaultTopK: 20,
      maxMemoryResults: 50,
      axiomsTopK: 10,
    },
    memory: {
      defaultEnergy: 0.8,
      defaultMemoryType: 'semantic',
      maxCueAnchors: 8,
      abstractionMaxLength: 200,
      defaultPrimaryAbstractionLength: 80,
      defaultSalience: 1.0,
    },
    llm: {
      defaultProvider: 'anthropic',
      defaultModel: 'claude-3-haiku-20240307',
      apiKeyEnv: 'MAFW_LLM_API_KEY',
      anthropicVersion: '2023-06-01',
      maxTokens: 500,
    },
    logging: {
      logDir: path.join(os.homedir(), '.mafw', 'logs'),
      maxFileSize: 5242880,
      logLevel: 'debug',
    },
    mcpserver: {
      name: 'mafw-mcp-server',
      version: '4.1.0',
      transportPath: '/mcp',
    },
    metrics: {
      maxInMemory: 1000,
      pruneRetainCount: 500,
      recentSnapshotSize: 50,
      maxEventEmitterListeners: 100,
    },
    chat: {
      executeGraphKeywords: ['开始', '规划', '执行', 'run'],
      searchMemoryKeywords: ['搜索', '查找', '记忆', 'search'],
    },
    alignment: {
      userWeightsFile: 'user-weights.json',
    },
    manager: {
      wakeCooldownMs: parseInt(process.env.MAFW_MANAGER_WAKE_COOLDOWN || '') || 60000,
      reportIntervalMin: parseInt(process.env.MAFW_MANAGER_REPORT_INTERVAL || '') || 5,
    },
    env: {
      mafwOpencodePath: 'MAFW_OPENCODE_PATH',
      enableLegacyMcp: 'ENABLE_LEGACY_MCP',
      mafwProjectDir: 'MAFW_PROJECT_DIR',
    },
  };
}

export class Config {
  private data: GatewayConfig;

  get raw(): GatewayConfig { return this.data; }

  constructor(projectDir?: string) {
    const pd = projectDir || process.env[defaults('.').env.mafwProjectDir] || '.';
    this.data = defaults(pd);

    const globalFile = this.data.paths.globalConfig;
    this.deepMerge(this.data, this.loadYaml(globalFile));

    const projectFile = path.join(pd, this.data.paths.mafwDir, 'config.yaml');
    this.deepMerge(this.data, this.loadYaml(projectFile));

    this.applyEnvOverrides(this.data);
  }

  get server() { return this.data.server; }
  get paths() { return this.data.paths; }
  get timeouts() { return this.data.timeouts; }
  get loop() { return this.data.loop; }
  get search() { return this.data.search; }
  get memory() { return this.data.memory; }
  get llm() { return this.data.llm; }
  get mcpserver() { return this.data.mcpserver; }
  get metrics() { return this.data.metrics; }
  get chat() { return this.data.chat; }
  get alignment() { return this.data.alignment; }
  get env() { return this.data.env; }
  get manager() { return this.data.manager; }

  resolvePath(...segments: string[]): string {
    return path.join(this.data.paths.projectDir, this.data.paths.mafwDir, ...segments);
  }

  private loadYaml(filePath: string): Partial<GatewayConfig> | null {
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return yaml.load(raw) as Partial<GatewayConfig>;
    } catch {
      return null;
    }
  }

  private deepMerge(target: any, source: any): void {
    if (!source || typeof source !== 'object') return;
    for (const key of Object.keys(source)) {
      const sv = source[key];
      if (sv !== null && typeof sv === 'object' && !Array.isArray(sv)) {
        if (!target[key] || typeof target[key] !== 'object') target[key] = {};
        this.deepMerge(target[key], sv);
      } else if (sv !== undefined) {
        target[key] = sv;
      }
    }
  }

  private envKey(...segments: string[]): string {
    return 'MAFW_' + segments.map(s =>
      s.replace(/([A-Z])/g, '_$1').replace(/^_/, '').toUpperCase()
    ).join('_');
  }

  private applyEnvOverrides(obj: any, prefix: string = ''): void {
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        this.applyEnvOverrides(value, prefix ? prefix + '.' + key : key);
      } else {
        const segments = prefix ? prefix.split('.') : [];
        segments.push(key);
        const envKey = this.envKey(...segments);
        const envVal = process.env[envKey];
        if (envVal === undefined) continue;
        if (typeof value === 'number') {
          obj[key] = Number(envVal);
        } else if (typeof value === 'boolean') {
          obj[key] = envVal === 'true' || envVal === '1';
        } else if (Array.isArray(value)) {
          obj[key] = envVal.split(',').map(s => s.trim());
        } else {
          obj[key] = envVal;
        }
      }
    }
  }
}

export const config = new Config();
