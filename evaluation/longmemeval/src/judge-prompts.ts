/**
 * LongMemEval official judge prompts — ported from the upstream repository
 * (xiaowu0162/LongMemEval, src/evaluation/evaluate_qa.py, ICLR 2025).
 *
 * Key differences from the old approximation:
 * - Output is "yes"/"no" ONLY (max_tokens≈10 in the official run), not JSON.
 * - Per-type templates with type-specific leniency:
 *   - temporal-reasoning: off-by-one day counts are not penalized
 *   - knowledge-update: an updated answer alongside stale info is correct
 *   - single-session-preference: rubric need not be fully satisfied; the
 *     response is correct as long as it recalls/utilizes the user's info
 *   - abstention: model must identify the question as unanswerable
 */

export interface JudgePrompt {
  system: string;
  user: string;
}

export function buildJudgePrompt(
  questionType: string,
  question: string,
  referenceAnswer: string | string[],
  modelAnswer: string,
  abstention = false,
): JudgePrompt {
  const ref = Array.isArray(referenceAnswer) ? referenceAnswer.join('; ') : referenceAnswer;

  let user: string;
  if (abstention) {
    user = `I will give you an unanswerable question, an explanation, and a response from a model. Please answer yes if the model correctly identifies the question as unanswerable. The model could say that the information is incomplete, or some other information is given but the asked information is not.

Question: ${question}

Explanation: ${ref}

Model Response: ${modelAnswer}

Does the model correctly identify the question as unanswerable? Answer yes or no only.`;
  } else if (questionType === 'temporal-reasoning') {
    user = `I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. In addition, do not penalize off-by-one errors for the number of days. If the question asks for the number of days/weeks/months, etc., and the model makes off-by-one errors (e.g., predicting 19 days when the answer is 18), the model's response is still correct.

Question: ${question}

Correct Answer: ${ref}

Model Response: ${modelAnswer}

Is the model response correct? Answer yes or no only.`;
  } else if (questionType === 'knowledge-update') {
    user = `I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response contains some previous information along with an updated answer, the response should be considered as correct as long as the updated answer is the required answer.

Question: ${question}

Correct Answer: ${ref}

Model Response: ${modelAnswer}

Is the model response correct? Answer yes or no only.`;
  } else if (questionType === 'single-session-preference') {
    user = `I will give you a question, a rubric for desired personalized response, and a response from a model. Please answer yes if the response satisfies the desired response. Otherwise, answer no. The model does not need to reflect all the points in the rubric. The response is correct as long as it recalls and utilizes the user's personal information correctly.

Question: ${question}

Rubric: ${ref}

Model Response: ${modelAnswer}

Is the model response correct? Answer yes or no only.`;
  } else {
    // single-session-user / single-session-assistant / multi-session
    user = `I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no.

Question: ${question}

Correct Answer: ${ref}

Model Response: ${modelAnswer}

Is the model response correct? Answer yes or no only.`;
  }

  return { system: '', user };
}

/** Parse the official yes/no judge output. */
export function parseJudgeScore(text: string): { score: number; reason: string } {
  const lower = text.toLowerCase().trim();
  if (lower.startsWith('yes') || lower.includes(' answer yes ') || /^yes[.!]?$/.test(lower)) {
    return { score: 1, reason: text.slice(0, 200) };
  }
  if (lower.startsWith('no') || lower.includes(' answer no ') || /^no[.!]?$/.test(lower)) {
    return { score: 0, reason: text.slice(0, 200) };
  }
  // Robust fallback: any "yes" (not preceded by "no") counts as yes, matching
  // the official `'yes' in eval_response.lower()` check.
  if (lower.includes('yes')) return { score: 1, reason: text.slice(0, 200) };
  return { score: 0, reason: `Unparseable judge output: ${text.slice(0, 200)}` };
}
