import * as fs from 'fs';

export async function waitForFile(
  filePath: string,
  timeoutMs: number = 5 * 60 * 1000,
  pollInterval: number = 500
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (fs.existsSync(filePath)) {
        fs.accessSync(filePath, fs.constants.R_OK);
        return true;
      }
    } catch {
    }
    await new Promise(r => setTimeout(r, pollInterval));
  }
  return false;
}

export interface SessionClient {
  create: (opts: {
    directory: string;
    metadata?: Record<string, unknown>;
  }) => Promise<{ id: string; createdAt?: string }>;
  promptAsync: (opts: {
    sessionID: string;
    message: string;
  }) => Promise<unknown>;
  delete: (opts: { sessionID: string }) => Promise<unknown>;
}

export async function createAndPromptSession(
  client: SessionClient,
  projectDir: string,
  skillCommand: string,
  goalId: string,
): Promise<string> {
  const session = await client.create({
    directory: projectDir,
    metadata: { mafw: true, goalId, skill: skillCommand },
  });
  await client.promptAsync({
    sessionID: session.id,
    message: `${skillCommand} ${goalId}`,
  });
  return session.id;
}

export async function destroySession(
  client: SessionClient,
  sessionId: string
): Promise<void> {
  try {
    await client.delete({ sessionID: sessionId });
  } catch {
  }
}
