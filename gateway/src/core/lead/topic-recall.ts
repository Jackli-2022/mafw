import type { TopicMessageIndexRow } from "./topic-message-index";

export interface RecallTopicInput {
  id: string;
  title: string;
  summary: string | null;
  index: TopicMessageIndexRow[];
}

export interface RecallCandidate {
  topicId: string;
  title: string;
  score: number;
  matches: string[];
}

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/g;

const STOPWORDS = new Set([
  "the", "is", "are", "was", "were", "be", "been", "being", "of", "to", "in", "on",
  "for", "and", "or", "a", "an", "it", "this", "that", "these", "those", "with",
  "at", "by", "from", "as", "has", "have", "had", "do", "does", "did", "what",
  "when", "where", "which", "who", "how", "status", "please", "can", "could",
  "would", "should", "about", "any", "all", "my", "our", "your", "there", "here",
]);

function queryTokens(query: string): string[] {
  const lower = query.toLowerCase();
  const tokens = new Set<string>();
  for (const match of lower.replace(CJK_RE, " ").match(/[a-z0-9_]+/g) ?? []) {
    if (match.length >= 2 && !STOPWORDS.has(match)) tokens.add(match);
  }
  for (const run of lower.match(new RegExp(CJK_RE.source, "g")) ?? []) {
    if (run.length === 1) tokens.add(run);
    for (let i = 0; i + 1 < run.length; i += 1) tokens.add(run.slice(i, i + 2));
  }
  return [...tokens];
}

function scoreTopic(tokens: string[], topic: RecallTopicInput): RecallCandidate | null {
  const title = topic.title.toLowerCase();
  const summary = (topic.summary ?? "").toLowerCase();
  const indexText = topic.index.map((row) => row.text.toLowerCase()).join("\n");
  const matches: string[] = [];
  let score = 0;
  let titleHit = false;
  let summaryHit = false;
  let indexHits = 0;
  for (const token of tokens) {
    let hit = false;
    if (title.includes(token)) { score += 0.6; titleHit = true; hit = true; }
    if (summary.includes(token)) { score += 0.3; summaryHit = true; hit = true; }
    if (indexText.includes(token)) { score += 0.1; indexHits += 1; hit = true; }
    if (hit) matches.push(token);
  }
  if (matches.length === 0) return null;
  // A single common index word is not enough evidence to page in a topic.
  if (!titleHit && !summaryHit && indexHits < 2) return null;
  return { topicId: topic.id, title: topic.title, score: Number(score.toFixed(3)), matches };
}

/**
 * Deterministic page-fault recall. Low-confidence matches are dropped rather
 * than injected: contamination is worse than a miss.
 */
export function recallTopics(input: {
  query: string;
  topics: RecallTopicInput[];
  maxTopics?: number;
  minScore?: number;
}): RecallCandidate[] {
  const tokens = queryTokens(input.query);
  if (tokens.length === 0) return [];
  const minScore = input.minScore ?? 0.2;
  const maxTopics = Math.max(0, Math.trunc(input.maxTopics ?? 2));
  return input.topics
    .map((topic) => scoreTopic(tokens, topic))
    .filter((candidate): candidate is RecallCandidate => !!candidate && candidate.score >= minScore)
    .sort((a, b) => b.score - a.score || a.topicId.localeCompare(b.topicId))
    .slice(0, maxTopics);
}

/** Build the per-turn `<recalled-topic>` block (summary + a few key lines). */
export function buildRecalledBlock(candidate: RecallCandidate, topic: RecallTopicInput): string {
  const keyRows = [...topic.index]
    .filter((row) => row.text.trim())
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === "user" ? -1 : 1;
      return b.createdAt.localeCompare(a.createdAt);
    })
    .slice(0, 5)
    .map((row) => `- [${row.role}] ${row.text.replace(/\s+/g, " ").slice(0, 200)}`);

  const lines = [
    `<recalled-topic topicId="${topic.id}" title="${topic.title.replace(/"/g, "&quot;")}">`,
    "Summary:",
    topic.summary?.trim() || "(no summary yet)",
  ];
  if (keyRows.length > 0) lines.push("Key messages:", ...keyRows);
  lines.push("</recalled-topic>");
  return lines.join("\n");
}
