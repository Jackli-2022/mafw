import {
  AgentEvent,
  DefaultRequestHandler,
  JsonRpcTransportHandler,
  ServerCallContext,
  UnauthenticatedUser,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from '@a2a-js/sdk/server';
import {
  A2A_VERSION_HEADER,
  type AgentCard,
  type Message,
  type Task,
} from '@a2a-js/sdk';
import type { PodA2ABridge } from './pod-a2a-bridge';
import { PodA2ATaskStore } from './pod-a2a-task-store';
import { PodA2AArtifactStore } from './pod-a2a-artifacts';

export interface PodA2AAgentOptions {
  bridge: PodA2ABridge;
  podId: string;
  podName?: string;
  baseUrl: string;
  artifactRoot: string;
  defaultVersion?: string;
}

export interface PodA2AJsonRpcResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export class PodA2AAgent {
  private readonly agentCardData: AgentCard;
  private readonly artifacts: PodA2AArtifactStore;
  private readonly handler: DefaultRequestHandler;
  private readonly jsonRpc: JsonRpcTransportHandler;
  private readonly options: PodA2AAgentOptions;

  constructor(options: PodA2AAgentOptions) {
    this.options = options;
    this.artifacts = new PodA2AArtifactStore(options.artifactRoot);
    this.agentCardData = this.buildAgentCard();
    const taskStore = new PodA2ATaskStore({ bridge: options.bridge, podId: options.podId });
    const executor: AgentExecutor = {
      execute: (ctx, bus) => this.execute(ctx, bus),
      cancelTask: async (taskId, bus) => this.cancelTask(taskId, bus),
    };
    this.handler = new DefaultRequestHandler(this.agentCardData, taskStore, executor);
    this.jsonRpc = new JsonRpcTransportHandler(this.handler);
  }

  get agentCard(): AgentCard {
    return this.agentCardData;
  }

  getArtifact(id: string): { path: string; contentType: string } | null {
    return this.artifacts.get(id);
  }

  async handleJsonRpc(
    body: string | Record<string, unknown>,
    headers: Record<string, string | undefined>,
  ): Promise<PodA2AJsonRpcResult> {
    const requestedVersion = headers[A2A_VERSION_HEADER?.toLowerCase()] || this.options.defaultVersion || '1.0';
    if (requestedVersion !== '1.0' && requestedVersion !== '1') {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', error: { code: -32600, message: `unsupported A2A version: ${requestedVersion}` } }),
      };
    }
    const context = new ServerCallContext({
      headers,
      requestedVersion,
      user: new UnauthenticatedUser(),
      extensions: undefined,
    } as any);
    const normalized = this.normalizeMethod(body);
    const result = await this.jsonRpc.handle(normalized, context);
    if (typeof (result as any)?.[Symbol.asyncIterator] === 'function') {
      const generator = result as AsyncGenerator<any, void, undefined>;
      const first = await generator.next();
      if (first.done) {
        return { status: 200, headers: { [A2A_VERSION_HEADER]: '1.0' }, body: JSON.stringify({ jsonrpc: '2.0', result: null }) };
      }
      return { status: 200, headers: { [A2A_VERSION_HEADER]: '1.0' }, body: JSON.stringify(first.value) };
    }
    return {
      status: 200,
      headers: { [A2A_VERSION_HEADER]: '1.0', 'Content-Type': 'application/a2a+json' },
      body: JSON.stringify(result),
    };
  }

  private normalizeMethod(body: string | Record<string, unknown>): string | Record<string, unknown> {
    let parsed: any;
    try {
      parsed = typeof body === 'string' ? JSON.parse(body) : { ...body };
    } catch {
      return body;
    }
    const map: Record<string, string> = {
      'message/send': 'SendMessage',
      'message/stream': 'SendStreamingMessage',
      'tasks/get': 'GetTask',
      'tasks/cancel': 'CancelTask',
      'tasks/resubscribe': 'SubscribeToTask',
    };
    if (typeof parsed?.method === 'string' && map[parsed.method]) {
      parsed.method = map[parsed.method];
    }
    return typeof body === 'string' ? JSON.stringify(parsed) : parsed;
  }

  private async execute(ctx: RequestContext, bus: ExecutionEventBus): Promise<void> {
    const actorSessionID = (ctx.userMessage.metadata as any)?.actorSessionID;
    const result = await this.options.bridge.sendMessage(this.options.podId, ctx.userMessage, {
      actorSessionID: typeof actorSessionID === 'string' ? actorSessionID : undefined,
    });
    if ((result as Task).status) bus.publish(AgentEvent.task(result as Task));
    else bus.publish(AgentEvent.message(result as Message));
  }

  private async cancelTask(taskId: string, bus: ExecutionEventBus): Promise<void> {
    const task = this.options.bridge.cancelTask(this.options.podId, taskId);
    if (task) bus.publish(AgentEvent.task(task));
  }

  private buildAgentCard(): AgentCard {
    return {
      name: `MAFW Pod ${this.options.podId}`,
      description: `MAFW Project Pod agent for ${this.options.podName ?? this.options.podId}`,
      url: `${this.options.baseUrl}/a2a/pods/${this.options.podId}`,
      version: '1.0.0',
      protocolVersion: '1.0',
      provider: { url: this.options.baseUrl, organization: 'MAFW' },
      capabilities: {
        streaming: false,
        pushNotifications: false,
        extensions: [],
      },
      defaultInputModes: ['text', 'data', 'file'],
      defaultOutputModes: ['text', 'artifact'],
      skills: [
        {
          id: 'pod.handoff',
          name: 'Pod handoff',
          description: 'Assign work to a Pod member with task, acceptance, and artifact references.',
          tags: ['pod', 'handoff', 'task'],
          examples: [],
          inputModes: ['text', 'data', 'file'],
          outputModes: ['text', 'artifact'],
          securityRequirements: [],
        },
        {
          id: 'pod.status',
          name: 'Pod status',
          description: 'Read Pod task status through A2A tasks/get.',
          tags: ['pod', 'status'],
          examples: [],
          inputModes: ['text'],
          outputModes: ['text'],
          securityRequirements: [],
        },
      ],
      supportedInterfaces: [{
        url: `${this.options.baseUrl}/a2a/pods/${this.options.podId}`,
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
      }] as any,
      securitySchemes: {},
      securityRequirements: [],
      signatures: [],
    } as AgentCard;
  }
}
