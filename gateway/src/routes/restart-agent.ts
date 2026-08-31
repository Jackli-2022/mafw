import * as http from 'http';

export interface RestartAgentDeps {
  capabilities: () => { agentProcessApi?: boolean };
  isRecovering: () => boolean;
  isSwitching: () => boolean;
  begin: () => void;
  end: () => void;
  restartAgent: () => Promise<{ mode: string }>;
}

export async function handleRestartAgent(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: RestartAgentDeps,
): Promise<void> {
  const json = (status: number, body: any) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (deps.capabilities().agentProcessApi !== true) {
    json(503, { error: 'runtime does not own the agent process (external or in-process runtime)' });
    return;
  }
  if (deps.isRecovering() || deps.isSwitching()) {
    json(409, { error: 'agent process recovery/runtime switch already in progress' });
    return;
  }
  deps.begin();
  try {
    const { mode } = await deps.restartAgent();
    json(200, { success: true, mode });
  } catch (err: any) {
    json(500, { error: err.message });
  } finally {
    deps.end();
  }
}
