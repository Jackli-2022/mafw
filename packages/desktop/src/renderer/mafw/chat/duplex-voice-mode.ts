/**
 * Duplex ASR microphone routing (Task 8).
 *
 * A single decision function keeps the composer toolbar button and the narrow
 * "more" menu item on the same branch logic: with `voice.duplexV1` on, the
 * microphone starts/stops the continuous `/ws/voice` session; with the flag off
 * the legacy record → WAV → Media Agent path is untouched.
 */
export type VoiceMicAction = "start_duplex" | "stop_duplex" | "start_legacy" | "stop_legacy"

export interface VoiceMicState {
  duplexEnabled: boolean
  duplexActive: boolean
  legacyRecording: boolean
}

export function voiceMicAction(state: VoiceMicState): VoiceMicAction {
  if (state.duplexEnabled) return state.duplexActive ? "stop_duplex" : "start_duplex"
  return state.legacyRecording ? "stop_legacy" : "start_legacy"
}

/**
 * Monotonic start token: every `begin()` retires all earlier generations.
 *
 * Duplex client callbacks (`onPartial`/`onFinal`/`onState`/`onError`) fire from
 * socket, VAD and PCM-tap tasks that may settle long after the user stopped or
 * switched sessions. Comparing the captured generation against `current()`
 * keeps a stale start from writing into a newer start's state.
 */
export interface GenerationGuard {
  begin(): number
  current(): number
  isCurrent(generation: number): boolean
}

export function createGenerationGuard(): GenerationGuard {
  let generation = 0
  return {
    begin() {
      generation += 1
      return generation
    },
    current() {
      return generation
    },
    isCurrent(candidate: number) {
      return candidate === generation
    },
  }
}
