/**
 * LongMemEval-style judge prompts.
 *
 * We cannot access the official repository prompts directly in this environment,
 * so these are conservative, type-aware approximations aligned with the paper's
 * evaluation criteria. When official prompts are available they should replace
 * the templates below.
 */

export interface JudgePrompt {
  system: string;
  user: string;
}

function baseJudgePrompt(question: string, referenceAnswer: string | string[], modelAnswer: string): string {
  const ref = Array.isArray(referenceAnswer) ? referenceAnswer.join('; ') : referenceAnswer;
  return `Evaluate whether the model answer correctly answers the user question.

Question: ${question}
Reference Answer (may be a rubric): ${ref}
Model Answer: ${modelAnswer}

Score 1 if the model answer is factually correct, complete, and aligned with the reference. Score 0 if it is wrong, hallucinated, or unanswerable without the correct refusal.
Output strictly as JSON: {"score": 0 or 1, "reason": "short explanation"}`;
}

const TYPE_INSTRUCTIONS: Record<string, string> = {
  'single-session-user': 'The question asks about information the user mentioned in a single past session. The reference answer is the exact fact. The model must recall this fact from the conversation history.',
  'single-session-assistant': 'The question asks about information the assistant provided in a single past session. The model must recall the assistant-side detail.',
  'single-session-preference': 'The question asks about the user\'s personal preference. A correct answer should reflect the preference stated in the history; generic answers are wrong.',
  'multi-session': 'The question requires synthesizing information across multiple sessions. The model answer must aggregate or compare information from all required sessions.',
  'knowledge-update': 'The user\'s information changed over time. The model answer must use the latest / updated value, not an outdated one.',
  'temporal-reasoning': 'The question involves a specific time range or temporal relation. The model answer must respect the temporal scope and not include irrelevant-time facts.',
  'abstention': 'This question has a false premise or asks about information never mentioned in the history. A correct answer should refuse ("I don\'t know") and, if helpful, mention related facts the user DID mention.',
};

export function buildJudgePrompt(
  questionType: string,
  question: string,
  referenceAnswer: string | string[],
  modelAnswer: string,
): JudgePrompt {
  const typeHint = TYPE_INSTRUCTIONS[questionType] ?? TYPE_INSTRUCTIONS['single-session-user'];
  const system = `You are an expert evaluator for long-term memory chat assistants. ${typeHint}
Always output JSON: {"score": 0 or 1, "reason": "one-sentence explanation"}.`;
  return { system, user: baseJudgePrompt(question, referenceAnswer, modelAnswer) };
}

export function parseJudgeScore(text: string): { score: number; reason: string } {
  const json = (() => {
    try {
      const first = text.indexOf('{');
      const last = text.lastIndexOf('}');
      if (first !== -1 && last > first) return JSON.parse(text.slice(first, last + 1));
    } catch {}
    return null;
  })();
  if (json && typeof json.score === 'number') {
    return { score: json.score === 1 ? 1 : 0, reason: json.reason ?? text };
  }
  // Fallback: look for a leading 1/0 or explicit true/false.
  const m = text.match(/\b(?:score\s*[:=]\s*)?(1|0)\b/);
  if (m) return { score: parseInt(m[1], 10), reason: text.slice(0, 200) };
  return { score: 0, reason: `Unparseable judge output: ${text.slice(0, 200)}` };
}
