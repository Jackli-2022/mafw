/** Neutral runtime transport: the only turn-level protocol a driver must implement. */

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface RuntimeModelRef {
  providerID: string;
  modelID: string;
  variant?: string;
}

export interface AttachmentRef {
  id: string;
  bytes: number;
  mime: string;
  /** gateway-resolved local path for in-process adapters */
  path?: string;
  /** loopback URL for out-of-process adapters */
  url?: string;
}

export type AdapterPartInput =
  | { type: 'text'; text: string }
  | { type: 'file'; ref: AttachmentRef; mime: string; filename?: string };

export interface RuntimeSnapshot {
  state: 'available' | 'unavailable';
  reason?: string;
  authenticated?: boolean;
  version?: string;
  update?: { title: string; message: string; command: string };
  warning?: { title: string; message: string };
}

export interface RuntimeFactoryContext {
  gatewayPort?: number;
  rootDir?: string;
  projectDir?: string;
  pluginConfig(name: string): Record<string, unknown>;
  credentials?: { getApiKey(provider: string): string | null };
  /**
   * Gateway-owned policy hooks. The adapter wires them into its native
   * approval/cognition machinery; the gateway never touches native objects.
   * Return values stay opaque to the contract and are narrowed by the adapter.
   */
  policy?: RuntimePolicyHooks;
  log?: { info(message: string): void; warn(message: string): void };
}

export interface RuntimePolicyCandidate {
  tool?: string;
  command?: string;
  patterns?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Policy hooks a gateway may hand to a driver. All are optional and
 * fail-open: a missing hook means the adapter keeps its own default.
 * Return values are intentionally `unknown`; only the adapter that owns the
 * native policy type narrows them.
 */
export interface RuntimePolicyHooks {
  evaluatePermission?(sessionID: string, candidate: RuntimePolicyCandidate): unknown;
  gateToolCall?(sessionID: string, payload: { tool: string; input: Record<string, unknown> }): unknown;
  gatePrompt?(sessionID: string, text: string): unknown;
  redactToolResult?(sessionID: string, tool: string, content: unknown[]): unknown;
}

export type DeliveryMode = 'steer' | 'followup' | 'queue';

export interface SendTurnInput {
  sessionID: string;
  /** Minted by gateway; the adapter must echo it on every turn/part/usage event. */
  turnID: string;
  text: string;
  parts?: AdapterPartInput[];
  system?: string;
  agent?: string;
  model?: RuntimeModelRef;
  variant?: string;
  thinkingLevel?: ThinkingLevel;
  cwd?: string;
  /** Busy delivery hint: steer = inject into the running turn, queue = gateway queue. */
  delivery?: DeliveryMode;
  /** false = notification-only turn; do not trigger a model answer. */
  expectReply?: boolean;
  /** Gateway queue idempotency key; the adapter only passes it through. */
  idempotencyKey?: string;
  /** Structured submission schema (goal plan/execute/review). */
  outputSchema?: unknown;
  /** Turn budget; adapter enforces natively when it can. */
  budget?: { maxTurns?: number; maxCostUsd?: number };
  metadata?: Record<string, unknown>;
}

export interface ApprovalDecision {
  behavior: 'allow' | 'deny' | 'answer';
  message?: string;
  always?: boolean;
}

export type RequestOutcome = 'allowed-once' | 'rejected' | 'answered' | 'unavailable';
export type SteerOutcome = 'steered' | 'refused' | 'indeterminate';

export interface RuntimeTransport {
  start?(): Promise<void>;
  stop?(): Promise<void>;
  createSession(input: { directory: string; parentID?: string; title?: string }): Promise<{ sessionID: string }>;
  sendTurn(input: SendTurnInput): Promise<{ turnID: string }>;
  interruptTurn(sessionID: string, turnID?: string): Promise<void>;
  respondToRequest?(sessionID: string, requestID: string, decision: ApprovalDecision): Promise<RequestOutcome>;
  steer?(sessionID: string, text: string, parts?: AdapterPartInput[]): Promise<SteerOutcome>;
  snapshot?(): Promise<RuntimeSnapshot>;
  onEvent(listener: (event: import('./adapter-event.ts').AdapterEvent) => void): () => void;
}
