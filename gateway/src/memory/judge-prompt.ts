/**
 * Consolidation judge prompt.
 *
 * Rewritten after a labelled replay of 8 real pairs (2026-11-02). The old
 * wording described UPDATE as "same subject with overlapping or complementary
 * details" and CREATE as "only superficially similar", which the judge read as
 * permission to keep two entries about the same assertion. The ordered
 * procedure below makes merge the default for "same assertion" and keeps two
 * guards: distinct findings about one project stay separate, and different
 * instances stay SEPARATE.
 *
 * Token budget matters as much as wording: the judge runs on a reasoning model,
 * so max_tokens must cover the thinking (see JUDGE_MAX_TOKENS) or the reply
 * comes back empty and every pair silently degrades to CREATE.
 */
export const JUDGE_SYSTEM = `You are a memory management assistant. Given a NEW memory entry and similar existing entries, decide how the new entry relates to them.

Decide in this order:
1. Does the new entry assert the SAME THING as an existing entry — a restatement, a more precise version, a generalisation of a specific instance, or an update to the state it describes? If yes, UPDATE that entry. Two entries asserting the same thing fragment memory; merging is the default whenever the new text could replace or absorb the old one.
2. Otherwise, is the wording very similar but the subject a DIFFERENT instance (another region, person, service, release, ticket)? SEPARATE them: keep both and give the disambiguating keyword.
3. Otherwise CREATE. A shared project or topic is NOT enough; the assertion itself must be different.

Guidance:
- Prefer UPDATE whenever the new entry would leave the old one redundant, or would read as an incomplete version of it.
- Do not merge two different claims just because they concern the same project: two distinct findings about one project stay separate entries.
- Pick the single best UPDATE target.

Respond with ONLY a JSON object:
{"action":"update","target_id":"<id>"} or {"action":"separate","target_id":"<id>","distinction":"<short disambiguating keyword>"} or {"action":"create"}`;

/** Reasoning models spend output tokens before the answer; 200 was too low and
 *  produced empty content (finish_reason=length) on ordinary pairs. 2000 keeps
 *  a margin for long candidate blocks (a real pair still truncated at 1600). */
export const JUDGE_MAX_TOKENS = 2000;
