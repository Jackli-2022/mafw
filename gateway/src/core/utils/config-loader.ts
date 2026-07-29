import * as fs from 'fs';
import * as path from 'path';
import { MAFWConfig } from '../types/config';

export class ConfigLoader {
  private static instance: ConfigLoader;
  private config: MAFWConfig;

  private static readonly ENV_MAP: Record<string, string> = {
    MAFW_RETRIEVAL_MODE: 'retrieval.mode',
    MAFW_TOKEN_BUDGET: 'retrieval.tokenBudget',
    MAFW_STORAGE_BACKEND: 'storage.backend',
    MAFW_DASHBOARD_PORT: 'dashboard.port',
    MAFW_LOG_LEVEL: 'logging.level',
  };

  private static readonly DEFAULT_CONFIG: MAFWConfig = {
    version: '5.0',
    storage: {
      backend: 'file',
    },
    retrieval: {
      enabled: true,
      mode: 'hybrid',
      bm25: { k1: 1.2, b: 0.75, topK: 20 },
      vector: { model: 'Xenova/all-MiniLM-L6-v2', dimensions: 384, topK: 20 },
      rrf: { k: 60 },
      diversification: { enabled: true, maxPerLoop: 3 },
      tokenBudget: 2000,
    },
    memory: {
      energy: {
        decayRatePerDay: 0.01,
        cleanupThreshold: 0.3,
        criticalThreshold: 0.8,
      },
      maxMemoriesPerTier: 1000,
      mergeSimilarityThreshold: 0.85,
    },
    hooks: {
      enabled: [],
      failBehavior: 'continue',
      timeout: 5000,
    },
    concurrency: {
      maxParallelWaves: 3,
      lockTimeout: 300000,
      stateSyncInterval: 1000,
    },
    dashboard: {
      enabled: true,
      port: 3111,
      refreshInterval: 5000,
    },
    logging: {
      level: 'info',
      maxFiles: 5,
      maxSize: '10m',
    },
  };

  private constructor(projectDir?: string) {
    this.config = this.loadConfig(projectDir);
  }

  static getInstance(projectDir?: string): ConfigLoader {
    if (!ConfigLoader.instance) {
      ConfigLoader.instance = new ConfigLoader(projectDir);
    }
    return ConfigLoader.instance;
  }

  static reset(): void {
    ConfigLoader.instance = undefined as any;
  }

  private loadConfig(projectDir?: string): MAFWConfig {
    let config = this.deepMerge({}, ConfigLoader.DEFAULT_CONFIG);

    const homeDir = process.env.HOME || process.env.USERPROFILE;
    if (homeDir) {
      const globalPath = path.join(homeDir, '.mafw', 'config.json');
      config = this.deepMerge(config, this.readJsonFile(globalPath));
    }

    if (projectDir) {
      const projectConfigPath = path.join(projectDir, '.mafw', 'config.json');
      config = this.deepMerge(config, this.readJsonFile(projectConfigPath));
    }

    config = this.applyEnvVars(config);

    return config;
  }

  private readJsonFile(filePath: string): Partial<MAFWConfig> {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
    } catch {
      // ignore corrupt or unreadable files
    }
    return {};
  }

  private applyEnvVars(config: MAFWConfig): MAFWConfig {
    const result = this.deepMerge({}, config);
    for (const [envKey, configPath] of Object.entries(ConfigLoader.ENV_MAP)) {
      const envValue = process.env[envKey];
      if (envValue !== undefined) {
        this.setNestedValue(result, configPath, this.parseEnvValue(envValue));
      }
    }
    return result;
  }

  private parseEnvValue(value: string): any {
    if (value === 'true') return true;
    if (value === 'false') return false;
    const num = Number(value);
    if (!isNaN(num) && value.trim() !== '') return num;
    return value;
  }

  private setNestedValue(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!(keys[i] in current)) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
  }

  private deepMerge(target: any, source: any): any {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      const srcVal = source[key];
      if (srcVal !== null && typeof srcVal === 'object' && !Array.isArray(srcVal)) {
        result[key] = this.deepMerge(result[key] || {}, srcVal);
      } else {
        result[key] = srcVal;
      }
    }
    return result;
  }

  get(key?: string): any {
    if (!key) return this.config;
    const keys = key.split('.');
    let current: any = this.config;
    for (const k of keys) {
      if (current === undefined || current === null) return undefined;
      current = current[k];
    }
    return current;
  }

  getAll(): MAFWConfig {
    return this.config;
  }

  static deepMerge(target: any, source: any): any {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      const srcVal = source[key];
      if (srcVal !== null && typeof srcVal === 'object' && !Array.isArray(srcVal)) {
        result[key] = ConfigLoader.deepMerge(result[key] || {}, srcVal);
      } else {
        result[key] = srcVal;
      }
    }
    return result;
  }
}
