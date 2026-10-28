import { parseClientMessage, serverError } from './protocol';
import type { VoiceSession } from '../session';

export interface VoiceSocketLike {
  send(data: string | Buffer): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', cb: (data: Buffer, isBinary: boolean) => void): void;
  on(event: 'close', cb: () => void): void;
}

export interface VoiceSocketDeps {
  createSession: () => Promise<VoiceSession>;
}

export function isVoiceUpgradePath(url: string): boolean {
  return url === '/ws/voice' || url.startsWith('/ws/voice?');
}

/**
 * Bind one `/ws/voice` socket to a VoiceSession. The session is created on the
 * first valid `hello`, not on upgrade, so sidecar/model failures become an
 * error frame instead of a dropped connection.
 */
export function attachVoiceSocket(
  socket: VoiceSocketLike,
  deps: VoiceSocketDeps,
): void {
  let session: VoiceSession | undefined;
  let creating: Promise<VoiceSession> | undefined;
  let closed = false;

  const send = (msg: ReturnType<typeof serverError> | object) => {
    if (closed) return;
    try {
      socket.send(JSON.stringify(msg));
    } catch {
      /* socket is going away; close handler owns cleanup */
    }
  };

  const ensureSession = async (): Promise<VoiceSession> => {
    if (session) return session;
    if (!creating) {
      creating = deps.createSession().finally(() => { creating = undefined; });
    }
    session = await creating;
    return session;
  };

  const handle = async (data: Buffer, isBinary: boolean): Promise<void> => {
    if (isBinary) {
      if (!session) {
        send(serverError('hello_required', 'send hello first', true));
        return;
      }
      session.handleAudio(data);
      return;
    }

    let msg;
    try {
      msg = parseClientMessage(data.toString('utf8'));
    } catch (err: any) {
      send(serverError('invalid_voice_message', err?.message || String(err), true));
      return;
    }

    if (msg.type === 'hello' && !session) {
      try {
        await ensureSession();
      } catch (err: any) {
        send(serverError('voice_unavailable', err?.message || String(err), true));
        return;
      }
    }

    if (!session) {
      send(serverError('hello_required', 'send hello first', true));
      return;
    }
    await session.handleControl(msg);
  };

  socket.on('message', (data: Buffer, isBinary: boolean) => {
    void handle(data, isBinary);
  });
  socket.on('close', () => {
    closed = true;
    session?.close();
  });
}
