import { attachVoiceSocket, isVoiceUpgradePath } from '../../src/voice/transport/ws-voice';
import { VoiceSession } from '../../src/voice/session';

test('isVoiceUpgradePath only matches /ws/voice', () => {
  expect(isVoiceUpgradePath('/ws/voice')).toBe(true);
  expect(isVoiceUpgradePath('/ws/voice?x=1')).toBe(true);
  expect(isVoiceUpgradePath('/api/ws')).toBe(false);
  expect(isVoiceUpgradePath('/ws/voicex')).toBe(false);
});

function fakeSession(sent: any[]): VoiceSession {
  return new VoiceSession({
    asr: { name:'fake', capabilities:{streaming:'native',languages:['zh'],punctuation:true,timestamps:'none',sampleRate:16000}, isAvailable:async()=>({ok:true}), createStream:()=>({push:()=>{},abort:()=>{},onPartial:()=>{},end:async()=>({text:'x',durationMs:1,engine:'fake',final:true})}), transcribe:async()=>({text:'x',durationMs:1,engine:'fake',final:true}) } as any,
    send: m => sent.push(m),
  });
}

test('socket routes hello into the session', async () => {
  const sent: any[] = [];
  const handlers = new Map<string, Function>();
  const socket = { send: (d: any) => sent.push(d), close: () => {}, on: (e: string, cb: Function) => handlers.set(e, cb) } as any;
  const session = fakeSession(sent);
  attachVoiceSocket(socket, { createSession: async () => session });
  handlers.get('message')!(Buffer.from(JSON.stringify({type:'hello',sessionId:'s1',mode:'continuous',tier:'auto',language:'zh',format:'pcm16',clientVad:true})), false);
  await new Promise(r => setTimeout(r, 0));
  expect(sent[0]).toMatchObject({ type: 'ready' });
});

test('socket error closes the session', async () => {
  const sent: any[] = [];
  const handlers = new Map<string, Function>();
  const socket = { send: (d: any) => sent.push(d), close: () => {}, on: (e: string, cb: Function) => handlers.set(e, cb) } as any;
  const session = fakeSession(sent);
  attachVoiceSocket(socket, { createSession: async () => session });
  handlers.get('message')!(Buffer.from(JSON.stringify({type:'hello',sessionId:'s1',mode:'continuous',tier:'auto',language:'zh',format:'pcm16',clientVad:true})), false);
  await new Promise(r => setTimeout(r, 0));
  handlers.get('error')!(new Error('tcp reset'));
  expect(session.state).toBe('closed');
});

test('close during sidecar startup closes the late session', async () => {
  const sent: any[] = [];
  const handlers = new Map<string, Function>();
  const socket = { send: (d: any) => sent.push(d), close: () => {}, on: (e: string, cb: Function) => handlers.set(e, cb) } as any;
  let resolveSession: ((s: VoiceSession) => void) | undefined;
  const created = new Promise<VoiceSession>((resolve) => { resolveSession = resolve; });
  attachVoiceSocket(socket, { createSession: () => created });
  handlers.get('message')!(Buffer.from(JSON.stringify({type:'hello',sessionId:'s1',mode:'continuous',tier:'auto',language:'zh',format:'pcm16',clientVad:true})), false);
  handlers.get('close')!();
  const session = fakeSession(sent);
  resolveSession!(session);
  await new Promise(r => setTimeout(r, 0));
  expect(session.state).toBe('closed');
});
