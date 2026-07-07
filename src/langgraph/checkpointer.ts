import * as fs from 'fs';
import * as path from 'path';
import { BaseCheckpointSaver } from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { Checkpoint, CheckpointMetadata, CheckpointTuple } from '@langchain/langgraph';

interface CheckpointData {
  thread_id: string;
  node_id: string;
  ts: string;
  state: Record<string, any>;
}

interface MetadataData {
  step: number;
  retries: number;
  lastError?: string;
}

export class FileCheckpointer extends BaseCheckpointSaver {
  private baseDir: string;

  constructor(baseDir: string) {
    super();
    this.baseDir = baseDir;
  }

  private threadDir(threadId: string): string {
    return path.join(this.baseDir, 'checkpoints', threadId);
  }

  private stepPath(threadId: string, step: number): string {
    return path.join(this.threadDir(threadId), `step_${String(step).padStart(7, '0')}.json`);
  }

  private metadataPath(threadId: string): string {
    return path.join(this.threadDir(threadId), 'metadata.json');
  }

  private nextStep(threadId: string): number {
    const dir = this.threadDir(threadId);
    if (!fs.existsSync(dir)) return 1;
    const files = fs.readdirSync(dir).filter(f => f.startsWith('step_'));
    if (files.length === 0) return 1;
    const maxStep = Math.max(...files.map(f => parseInt(f.replace('step_', '').replace('.json', ''), 10)));
    return maxStep + 1;
  }

  async get(config: RunnableConfig): Promise<any | undefined> {
    const { thread_id } = config.configurable ?? {};
    if (!thread_id) return undefined;
    const dir = this.threadDir(thread_id);
    if (!fs.existsSync(dir)) return undefined;
    const files = fs.readdirSync(dir).filter(f => f.startsWith('step_'));
    if (files.length === 0) return undefined;
    const maxStep = Math.max(...files.map(f => parseInt(f.replace('step_', '').replace('.json', ''), 10)));
    return JSON.parse(fs.readFileSync(this.stepPath(thread_id, maxStep), 'utf-8'));
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const { thread_id } = config.configurable ?? {};
    if (!thread_id) return undefined;
    const dir = this.threadDir(thread_id);
    if (!fs.existsSync(dir)) return undefined;
    const files = fs.readdirSync(dir).filter(f => f.startsWith('step_'));
    if (files.length === 0) return undefined;
    const maxStep = Math.max(...files.map(f => parseInt(f.replace('step_', '').replace('.json', ''), 10)));
    const cpPath = this.stepPath(thread_id, maxStep);
    const data: CheckpointData = JSON.parse(fs.readFileSync(cpPath, 'utf-8'));
    const checkpoint: Checkpoint = {
      v: 1,
      id: `${thread_id}-step-${maxStep}`,
      ts: data.ts,
      channel_values: data.state,
      channel_versions: {},
      versions_seen: {},
    };
    const metaPath = this.metadataPath(thread_id);
    let metadata: CheckpointMetadata | undefined;
    if (fs.existsSync(metaPath)) {
      const meta: MetadataData = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      metadata = { step: meta.step } as any;
    }
    return {
      config,
      checkpoint,
      metadata,
      parentConfig: undefined,
    };
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions?: Record<string, number | string>,
  ): Promise<RunnableConfig> {
    const { thread_id } = config.configurable ?? {};
    if (!thread_id) return config;
    const dir = this.threadDir(thread_id);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const step = ((metadata as any)?.step) ?? this.nextStep(thread_id);
    const state = (checkpoint as any).state ?? checkpoint.channel_values ?? {};
    const data: CheckpointData = {
      thread_id,
      node_id: (checkpoint as any).node_id || '',
      ts: checkpoint.ts || new Date().toISOString(),
      state,
    };
    fs.writeFileSync(this.stepPath(thread_id, step), JSON.stringify(data, null, 2), 'utf-8');
    fs.writeFileSync(
      this.metadataPath(thread_id),
      JSON.stringify({ step, retries: (metadata as any)?.retries ?? 0, lastError: (metadata as any)?.lastError }, null, 2),
      'utf-8',
    );
    return config;
  }

  async *list(config: RunnableConfig, options?: { limit?: number; before?: RunnableConfig; filter?: Record<string, any> }): AsyncGenerator<CheckpointTuple> {
    const { thread_id } = config.configurable ?? {};
    if (!thread_id) return;
    const dir = this.threadDir(thread_id);
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir).filter(f => f.startsWith('step_')).sort();
    const toRead = options?.limit ? files.slice(-options.limit) : files;
    for (const f of toRead) {
      const data: CheckpointData = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
      const step = parseInt(f.replace('step_', '').replace('.json', ''), 10);
      const checkpoint: Checkpoint = {
        v: 1,
        id: `${thread_id}-step-${step}`,
        ts: data.ts,
        channel_values: data.state,
        channel_versions: {},
        versions_seen: {},
      };
      yield { config, checkpoint };
    }
  }

  async putWrites(config: RunnableConfig, writes: any[], taskId: string): Promise<void> {
    // no-op for simple file-based storage
  }

  async deleteThread(threadId: string): Promise<void> {
    const dir = this.threadDir(threadId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  async getCurrentState(threadId: string): Promise<{ round: number; phase: string; verdict: string; lastError?: string } | null> {
    const metaPath = this.metadataPath(threadId);
    const dir = this.threadDir(threadId);
    if (!fs.existsSync(dir) || !fs.existsSync(metaPath)) return null;
    const meta: MetadataData = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const files = fs.readdirSync(dir).filter(f => f.startsWith('step_'));
    if (files.length === 0) return null;
    const maxStep = Math.max(...files.map(f => parseInt(f.replace('step_', '').replace('.json', ''), 10)));
    const cp: CheckpointData = JSON.parse(fs.readFileSync(this.stepPath(threadId, maxStep), 'utf-8'));
    return {
      round: cp.state.round || 1,
      phase: cp.state.phase || 'UNKNOWN',
      verdict: cp.state.reviewVerdict || 'FAIL',
      lastError: meta.lastError,
    };
  }
}
