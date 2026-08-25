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
    /** Optional API token — required for non-loopback connections (remote
     *  mobile clients over Tailscale etc.). Env: MAFW_SERVER_API_TOKEN. */
    apiToken?: string;
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
    /** Default harmonic retriever: 'token' (legacy substring counting) or 'bm25'. */
    defaultRetriever: 'token' | 'bm25';
    /** Two-stage reranking: 'off' | 'heuristic' | 'cross-encoder'. */
    reranker: 'off' | 'heuristic' | 'cross-encoder';
    /** How many candidates the retriever returns before reranking. */
    recallK: number;
    /** Drop reranked results below topScore × cutoffRatio (0 = disabled). */
    cutoffRatio: number;
    /** Heuristic reranker weights. */
    rerankWeights: {
      bm25: number;
      recency: number;
      energy: number;
      salience: number;
    };
    /** Anchor-graph multi-hop expansion (Memora-style). */
    graph: {
      enabled: boolean;
      maxHops: number;
      maxNeighbors: number;
      damping: number;
      candidateCap: number;
      rerankGraphWeight: number;
    };
    /** Agent-driven iterative expansion rounds for mafw_search_hybrid (0 = first round only). */
    maxExpandRounds: number;
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
  recall: {
    stepInjectThreshold: number;
    stepInjectMaxMemories: number;
    stepInjectIntervalMs: number;
    stepInjectQueueCap: number;
    stepInjectTtlMs: number;
    turnStaleMs: number;
    obsCapturePath: string;
    sessionWorkerTtlMs: number;
    reflectThresholdEpisodic: number;
    maxEpisodicPerReflect: number;
    workerModel: { providerID: string; modelID: string };
    workerCompactIdleMs: number;
  };
  usage: {
    pollIntervalMs: number;
    limits: {
      'opencode-go': { '5h': number; '7d': number; month: number };
      zen: { balance: number };
    };
    budgets: Record<string, number>;
    cookies: Record<string, string>;
    pluginConfig: Record<string, any>;
    disabledPlugins?: string[];
  };
  media: {
    /** opencode provider that owns the credentials (must be connected in opencode). */
    provider: string;
    /** default model ID for every modality. */
    model: string;
    /** default engine name (default: 'pi'). */
    engine?: string;
    /** per-modality overrides: { provider?, model, engine? } — provider/engine fall back to defaults. */
    image?: { provider?: string; model: string; engine?: string };
    video?: { provider?: string; model: string; engine?: string };
    audio?: { provider?: string; model: string; engine?: string };
    lang?: string;
    /** Plugin-specific configuration. */
    pluginConfig?: Record<string, any>;
    /** TTS (text-to-speech) configuration — MiMo-V2.5-TTS family. */
    tts?: {
      /** OpenAI-compatible endpoint (sk- billing: https://api.xiaomimimo.com/v1). */
      baseUrl?: string;
      /** TTS model ID. */
      model?: string;
      /** Default preset voice. */
      defaultVoice?: string;
      /** Allowed preset voices (display list). */
      voices?: string[];
    };
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
      apiToken: '',
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
      defaultRetriever: 'bm25',
      reranker: 'off',
      recallK: 50,
      cutoffRatio: 0,
      rerankWeights: {
        bm25: 0.6,
        recency: 0.2,
        energy: 0.1,
        salience: 0.1,
      },
      graph: {
        enabled: true,
        maxHops: 1,
        maxNeighbors: 3,
        damping: 0.6,
        candidateCap: 50,
        rerankGraphWeight: 0.15,
      },
      maxExpandRounds: 2,
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
    recall: {
      stepInjectThreshold: 0.7,
      stepInjectMaxMemories: 2,
      stepInjectIntervalMs: 15 * 60 * 1000,
      stepInjectQueueCap: 3,
      stepInjectTtlMs: 24 * 60 * 60 * 1000,
      turnStaleMs: 30 * 60 * 1000,
      obsCapturePath: 'memory/gateway.db',
      sessionWorkerTtlMs: 24 * 60 * 60 * 1000,
      reflectThresholdEpisodic: 3,
      maxEpisodicPerReflect: 100,
      workerModel: { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      workerCompactIdleMs: 8 * 60 * 60 * 1000,
    },
    usage: {
      pollIntervalMs: 60000,
      limits: {
        'opencode-go': { '5h': 12, '7d': 30, month: 60 },
        zen: { balance: 100 },
      },
      budgets: {},
      cookies: {},
      pluginConfig: {},
    },
    media: {
      provider: 'xiaomi',
      model: 'mimo-v2.5',
      // Nested stubs so MAFW_MEDIA_IMAGE_MODEL / MAFW_MEDIA_VIDEO_MODEL /
      // MAFW_MEDIA_AUDIO_MODEL / MAFW_MEDIA_LANG env overrides are honored by
      // applyEnvOverrides (it only walks keys present in the defaults).
      // Empty model falls back to the top-level `model` at resolve time.
      image: { model: '' },
      video: { model: '' },
      audio: { model: '' },
      lang: '',
      tts: {
        baseUrl: 'https://api.xiaomimimo.com/v1',
        model: 'mimo-v2.5-tts',
        defaultVoice: '茉莉',
        voices: ['冰糖', '茉莉', '苏打', '白桦', 'Mia', 'Chloe', 'Milo', 'Dean'],
      },
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
  private readonly projectDirValue: string;
  private readonly dataDirValue: string;

  get raw(): GatewayConfig { return this.data; }

  /**
   * MAFW data root — pinned to the user's home .mafw directory so the memory
   * store (T1 db, harmonic index, reflect cursor), manager sessions and the
   * registry never depend on the process working directory, MAFW_PROJECT_DIR
   * or the gateway package's install location. The `paths.mafwDir` config key
   * no longer redirects this. Tests may inject an alternative dataDir.
   */
  private static gatewayMafwDir(): string {
    return path.join(os.homedir(), '.mafw');
  }

  constructor(projectDir?: string, dataDir?: string) {
    // Resolve to an absolute path so relative stores (T1 db, cursors, memory
    // files) never depend on the process working directory at runtime.
    this.projectDirValue = path.resolve(
      projectDir || process.env[defaults('.').env.mafwProjectDir] || '.',
    );
    this.dataDirValue = dataDir ? path.resolve(dataDir) : Config.gatewayMafwDir();
    this.data = this.buildData(this.projectDirValue);
  }

  private buildData(pd: string): GatewayConfig {
    const data = defaults(pd);

    const globalFile = data.paths.globalConfig;
    this.deepMerge(data, this.loadYaml(globalFile));

    // Project-level config now lives in the fixed data directory (migrated
    // with the memory store) rather than the project-relative .mafw.
    const projectFile = path.join(this.dataDirValue, 'config.yaml');
    this.deepMerge(data, this.loadYaml(projectFile));

    this.applyEnvOverrides(data);
    return data;
  }

  /**
   * Hot-reload config files. Rebuilds from defaults so deleted keys fall back
   * to default values; immutable sections (server/paths) keep their old values
   * and are reported as restart-required so runtime state stays consistent
   * with what is actually listening/serving.
   */
  reload(): { changed: string[]; restartRequired: string[] } {
    const before = JSON.stringify(this.data);
    const next = this.buildData(this.projectDirValue);
    const restartRequired: string[] = [];
    if (JSON.stringify(next.server) !== JSON.stringify(this.data.server)) {
      // Split apiToken from restart-required: token changes take effect on
      // next request without a gateway restart.
      const { apiToken: _nextToken, ...nextServerRest } = next.server as any;
      const { apiToken: _curToken, ...curServerRest } = this.data.server as any;
      if (JSON.stringify(nextServerRest) !== JSON.stringify(curServerRest)) {
        next.server = this.data.server;
        restartRequired.push('server');
      } else {
        // Only apiToken changed — apply it without restart
        this.data.server.apiToken = next.server.apiToken;
      }
    }
    if (JSON.stringify(next.paths) !== JSON.stringify(this.data.paths)) {
      next.paths = this.data.paths;
      restartRequired.push('paths');
    }
    const after = JSON.stringify(next);
    const changed: string[] = [];
    if (before !== after) {
      for (const key of Object.keys(this.data)) {
        if (JSON.stringify((this.data as any)[key]) !== JSON.stringify((next as any)[key])) changed.push(key);
      }
    }
    this.data = next;
    return { changed, restartRequired };
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
  get recall() { return this.data.recall; }
  get usage() { return this.data.usage; }

  /**
   * MAFW data root — pinned to the gateway package's own .mafw directory so
   * the memory store (T1 db, harmonic index, reflect cursor) and pipeline
   * runtime files never depend on the process working directory or
   * MAFW_PROJECT_DIR. The `paths.mafwDir` config key no longer redirects this.
   */
  resolvePath(...segments: string[]): string {
    return path.join(this.dataDirValue, ...segments);
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
