/** Core session model (subset of @opencode-ai/sdk Session) */
export interface Session {
  id: string;
  projectID: string;
  directory: string;
  title: string;
  time: {
    created: number;
    updated: number;
  };
}

/** Project model (subset of @opencode-ai/sdk Project) */
export interface Project {
  id: string;
  worktree: string;
}

/** Streamed chat message part */
export interface TextPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: 'text';
  text: string;
}

/** Delta event received from OpenCode Serve */
export interface MessageDeltaEvent {
  type: 'message.part.updated';
  payload: {
    sessionID: string;
    messageID: string;
    part: TextPart;
    delta?: string;
  };
}

/** Completion event */
export interface MessageCompleteEvent {
  type: 'message.complete';
  payload: {
    sessionID: string;
    messageID: string;
  };
}

/** Error event */
export interface MessageErrorEvent {
  type: 'message.error';
  payload: {
    sessionID: string;
    messageID: string;
    error: string;
  };
}

/** Chat delta callback */
export type DeltaCallback = (delta: string) => void;

/** Chat complete callback */
export type CompleteCallback = (info: { sessionID: string; messageID: string }) => void;

/** Chat error callback */
export type ErrorCallback = (error: Error) => void;

/** Unsubscribe function */
export type Unsubscribe = () => void;

/** GatewayClient chat namespace */
export interface ChatNamespace {
  send(message: string): Promise<{ sessionID: string }>;
  onDelta(cb: DeltaCallback): Unsubscribe;
  onComplete(cb: CompleteCallback): Unsubscribe;
  onError(cb: ErrorCallback): Unsubscribe;
}

/** GatewayClient session namespace */
export interface SessionNamespace {
  list(): Promise<Session[]>;
  get(id: string): Promise<Session>;
}

/** GatewayClient project namespace */
export interface ProjectNamespace {
  getCurrent(): Promise<Project>;
  setCurrent(path: string): Promise<void>;
}

/** GatewayClient config namespace (not supported) */
export interface ConfigNamespace {
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
}

/** Complete GatewayClient interface (compatible with @opencode-ai/sdk subset) */
export interface IGatewayClient {
  chat: ChatNamespace;
  session: SessionNamespace;
  project: ProjectNamespace;
  config: ConfigNamespace;
}

/** Options for creating a GatewayClient */
export interface GatewayClientOptions {
  baseUrl?: string;
}

/** Error thrown for unsupported methods */
export class MethodNotSupportedError extends Error {
  constructor(method: string) {
    super(`Method not supported by Gateway SDK: ${method}`);
    this.name = 'MethodNotSupportedError';
  }
}
