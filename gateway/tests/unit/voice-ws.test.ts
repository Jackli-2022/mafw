import { attachVoiceSocket, isVoiceUpgradePath } from '../../src/voice/transport/ws-voice';
import { VoiceSession } from '../../src/voice/session';

test('isVoiceUpgradePath only matches /ws/voice', () => {
  expect(isVoiceUpgradePath('/ws/voice')).toBe(true);
  expect(isVoiceUpgradePath('/ws/voice?x=1')).toBe(true);
  expect(isVoiceUpgradePath('/api/ws')).toBe(false);
  expect(isVoiceUpgradePath('/ws/voicex')).toBe(false);
});

test('socket routes hello into the session', async () => {
  const sent: any[] = [];
  const handlers = new Map<string, Function>();
  const socket = { send: (d: any) => sent.push(d), close: () => {}, on: (e: string, cb: Function) => handlers.set(e, cb) } as any;
  const session = new VoiceSession({
    asr: { name:'fake', capabilities:{streaming:'native',languages:['zh'],punctuation:true,timestamps:'none',sampleRate:16000}, isAvailable:async()=>({ok:true}), createStream:()=>({push:()=>{},abort:()=>{},onPartial:()=>{},end:async()=>({text:'x',durationMs:1,engine:'fake',final:true})}), transcribe:async()=>({text:'x',durationMs:1,engine:'fake',final:true}) } as any,
    send: m => sent.push(m),
  });
  attachVoiceSocket(socket, { createSession: async () => session });
  handlers.get('message')!(Buffer.from(JSON.stringify({type:'hello',sessionId:'s1',mode:'continuous',tier:'auto',language:'zh',format:'pcm16',clientVad:true})), false);
  await new Promise(r => setTimeout(r, 0));
  expect(sent[0]).toMatchObject({ type: 'ready' });
});
