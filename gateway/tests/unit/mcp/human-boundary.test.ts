/**
 * E11-4 — the MCP human-only boundary is a *machine-checked* invariant.
 *
 * MCP is a service-principal surface: a loopback MCP call carries no human or
 * device credential, so any tool that accepted / approved / confirmed /
 * shelved / rejected / dismissed / merged / undid / rotated on the human's
 * behalf would either be a permanent 403 impersonation path or — worse — an
 * agent silently acting as the human. The rule is therefore not "no such tool
 * today", it is "adding one requires an explicit review".
 *
 * Three layers, all in this file:
 *   1. exact tool-name snapshot — any new (or renamed) tool fails until the
 *      snapshot is updated, so the diff shows up in review;
 *   2. human-action verbs in names/descriptions, with a 3-entry allowlist that
 *      is itself pinned (each entry must still say what makes it safe);
 *   3. static source scan of `gateway/src/mcp/**` for the human-only helpers —
 *      importing any of them would be the first step of breaking the boundary,
 *      even before a tool is registered.
 *
 * Spec: docs/superpowers/specs/2026-11-13-gateway-e11-identity-hardening-design.md §4
 */
import * as fs from 'fs';
import * as path from 'path';
import { DEFINITIONS, createToolRegistry } from '../../../src/mcp/tool-registry';

/**
 * Sorted `DEFINITIONS[].name` snapshot (47 tools, E11-4).
 * Adding a tool is a boundary decision: update this list deliberately.
 */
const TOOL_NAME_SNAPSHOT = [
  'mafw_add_memory',
  'mafw_ask_user',
  'mafw_cancel_goal',
  'mafw_commit_heuristic',
  'mafw_create_goal',
  'mafw_create_standing_goal',
  'mafw_decision_draft',
  'mafw_desktop_click',
  'mafw_desktop_get_ui_state',
  'mafw_desktop_navigate',
  'mafw_desktop_screenshot',
  'mafw_desktop_scroll',
  'mafw_desktop_type',
  'mafw_draft_automation_rule',
  'mafw_get_automation_history',
  'mafw_get_automation_rule',
  'mafw_get_axioms',
  'mafw_get_deltas',
  'mafw_get_evidence',
  'mafw_get_goal_status',
  'mafw_get_memory',
  'mafw_get_model_route',
  'mafw_get_triage_item',
  'mafw_lead_goal_status',
  'mafw_list_automation_rules',
  'mafw_list_goals',
  'mafw_list_pending_questions',
  'mafw_list_standing_goals',
  'mafw_list_triage_items',
  'mafw_load_state',
  'mafw_merge_memory',
  'mafw_pin_memory',
  'mafw_pod_goal_context',
  'mafw_pod_goal_direction',
  'mafw_pod_review_respond',
  'mafw_propose_triage_decision',
  'mafw_record_feedback',
  'mafw_resolve_merge',
  'mafw_restart_agent',
  'mafw_run_automation',
  'mafw_run_standing_goal',
  'mafw_search_hybrid',
  'mafw_set_goal',
  'mafw_supersede_memory',
  'mafw_update_standing_goal',
  'mafw_update_state',
  'mafw_validate_rule',
];

/** Verbs that belong to the human (or to a human-credentialed HTTP route). */
const HUMAN_ONLY_VERBS = [
  'accept',
  'approve',
  'confirm',
  'shelve',
  'reject',
  'dismiss',
  'merge',
  'undo',
  'rotate',
];

/** Objects whose verbs are human-only actions when a tool governs them. */
const HUMAN_OWNED_OBJECTS = [
  'goal',
  'goals',
  'plan',
  'plans',
  'decision',
  'decisions',
  'triage',
  'item',
  'items',
  'review',
  'reviews',
  'boundary',
  'boundaries',
  'approval',
  'approvals',
  'attention',
  'question',
  'questions',
  'permission',
  'permissions',
  'token',
  'tokens',
  'human',
  'revision',
  'revisions',
  'branch',
  'branches',
  'session',
  'sessions',
  'credential',
  'credentials',
  'proof',
  'acceptance',
];

/**
 * Documented exceptions (exactly three). Each one names a human verb *without*
 * performing the human's action; `DOCUMENTED_REASON` pins the wording that
 * makes it safe, so an edit that turns the description into a real human action
 * fails here too.
 */
const ALLOWLIST: Record<string, { reason: string; descriptionIncludes: string[] }> = {
  mafw_pod_review_respond: {
    reason: 'Tech Lead responds to a review item; only the human resolves/reopens it',
    descriptionIncludes: ['Tech Lead-only', 'Only the human can resolve or reopen'],
  },
  mafw_decision_draft: {
    reason: 'draft only; the human confirms or shelves it in the UI',
    descriptionIncludes: ['Draft a decision record for human confirmation', 'only the human UI can confirm or shelve'],
  },
  mafw_ask_user: {
    reason: 'asks the user; never answers on the human behalf',
    descriptionIncludes: ['Ask the user'],
  },
};

/**
 * `merge` in the memory domain is reversible data plumbing (`merge_memory` /
 * `resolve_merge`), not the human-only boundary/branch merge. Pinned as a name
 * snapshot: any *other* tool with `merge` in its name still fails the verb scan.
 */
const MEMORY_MERGE_TOOLS = ['mafw_merge_memory', 'mafw_resolve_merge'];

/** Human-authority markers that make a verb mention descriptive, not a claim. */
const HUMAN_AUTHORITY = /\b(human|user|you|your|manual|manually)\b/i;

function isAllowlisted(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWLIST, name);
}

/**
 * Human-only verbs used by a tool *name*.
 *
 * A bare verb token is only suspicious in the action position: followed by (or
 * preceding) a human-owned object, or standing alone as the last token
 * (`mafw_pod_accept`). `mafw_merge_memory` is the documented data-plumbing
 * exception.
 */
function forbiddenNameTokens(name: string): string[] {
  const tokens = name.replace(/^mafw_/, '').split('_');
  const hits: string[] = [];
  tokens.forEach((token, i) => {
    if (!HUMAN_ONLY_VERBS.includes(token)) return;
    if (token === 'merge' && MEMORY_MERGE_TOOLS.includes(name)) return;

    const next = tokens[i + 1];
    const prev = tokens[i - 1];
    const isLast = i === tokens.length - 1;

    if (next && HUMAN_OWNED_OBJECTS.includes(next)) {
      hits.push(`${token}_${next}`);
    } else if (isLast && prev && HUMAN_OWNED_OBJECTS.includes(prev)) {
      hits.push(`${prev}_${token}`);
    } else if (isLast) {
      hits.push(token);
    }
  });
  return hits;
}

/**
 * Human-only verbs a tool *description* claims for the tool itself.
 *
 * Only `verb + human-owned object` counts ("Accepts the goal"), because
 * descriptions legitimately mention the human's own action ("manual = human
 * approves the plan", "the user can accept or override it"). A human-authority
 * marker in the same clause marks the mention as descriptive.
 */
function forbiddenDescriptionClaims(description: string): string[] {
  const hits: string[] = [];
  const claim = new RegExp(
    `\\b(accepts?|accepted|approves?|approved|confirms?|confirmed|shelves?|shelved|rejects?|rejected|dismisses?|dismissed|merges?|merged|undoes|undid|rotates?|rotated)\\b`
      + `\\s+(?:the\\s+|a\\s+|an\\s+)?([a-z-]+)`,
    'gi',
  );
  for (const match of description.matchAll(claim)) {
    const object = (match[2] ?? '').toLowerCase();
    if (!HUMAN_OWNED_OBJECTS.includes(object)) continue;

    // Clause-local authority check: ignore anything before the last sentence
    // break so a distant "the user ..." cannot whitewash a later claim.
    const before = description.slice(Math.max(0, (match.index ?? 0) - 60), match.index);
    const clause = before.slice(before.lastIndexOf('.') + 1);
    if (HUMAN_AUTHORITY.test(clause)) continue;

    hits.push(match[0]);
  }
  return hits;
}

describe('MCP tool name snapshot (E11-4)', () => {
  it('exposes exactly the reviewed tool set', () => {
    const names = DEFINITIONS.map((d) => d.name).sort();
    expect(names).toEqual([...TOOL_NAME_SNAPSHOT].sort());
  });

  it('has no duplicate tool names', () => {
    const names = DEFINITIONS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every definition has a handler and every handler has a definition', () => {
    const { handlers } = createToolRegistry();
    expect(Object.keys(handlers).sort()).toEqual(DEFINITIONS.map((d) => d.name).sort());
  });
});

describe('human-only verbs (E11-4)', () => {
  const definable = DEFINITIONS.map((d) => ({
    name: d.name,
    description: d.description ?? '',
    allowlisted: isAllowlisted(d.name),
  }));

  it('no tool name uses a human-only action verb', () => {
    const violations = definable
      .filter((d) => !d.allowlisted)
      .map((d) => ({ name: d.name, hits: forbiddenNameTokens(d.name) }))
      .filter((d) => d.hits.length > 0)
      .map((d) => `${d.name}: ${d.hits.join(', ')}`);
    expect(violations).toEqual([]);
  });

  it('no tool description claims a human-only action on a human-owned object', () => {
    const violations = definable
      .filter((d) => !d.allowlisted)
      .map((d) => ({ name: d.name, hits: forbiddenDescriptionClaims(d.description) }))
      .filter((d) => d.hits.length > 0)
      .map((d) => `${d.name}: ${d.hits.join(' | ')}`);
    expect(violations).toEqual([]);
  });

  it('no tool accepts / approves / shelves on the human behalf', () => {
    const violations = DEFINITIONS.filter((d) => !isAllowlisted(d.name))
      .filter((d) =>
        /\b(accepts?|approves?|shelves?)\b\s+(?:the\s+|a\s+|an\s+)?(?:goal|plan|decision|boundary|review|triage|item)/i.test(
          d.description ?? '',
        ) && !HUMAN_AUTHORITY.test((d.description ?? '').slice(0, 80)),
      )
      .map((d) => d.name);
    expect(violations).toEqual([]);
  });

  it('the detectors actually fire (they are not vacuously green)', () => {
    // Names.
    expect(forbiddenNameTokens('mafw_accept_goal')).toEqual(['accept_goal']);
    expect(forbiddenNameTokens('mafw_pod_accept')).toEqual(['accept']);
    expect(forbiddenNameTokens('mafw_triage_confirm')).toEqual(['triage_confirm']);
    expect(forbiddenNameTokens('mafw_rotate_human_token')).toEqual(['rotate_human']);
    expect(forbiddenNameTokens('mafw_merge_memory')).toEqual([]);
    expect(forbiddenNameTokens('mafw_resolve_merge')).toEqual([]);
    expect(forbiddenNameTokens('mafw_merge_goal_boundary')).toEqual(['merge_goal']);

    // Descriptions.
    expect(forbiddenDescriptionClaims('Accepts the goal and starts the loop')).toEqual(['Accepts the goal']);
    expect(forbiddenDescriptionClaims('Approves the plan on your behalf')).toEqual(['Approves the plan']);
    expect(forbiddenDescriptionClaims('Approves the plan')).toEqual(['Approves the plan']);
    expect(forbiddenDescriptionClaims('Shelve the decision until later')).toEqual(['Shelve the decision']);
    expect(forbiddenDescriptionClaims('Merges the boundary into main')).toEqual(['Merges the boundary']);
    expect(forbiddenDescriptionClaims('Undoes the boundary merge')).toEqual(['Undoes the boundary']);
    expect(forbiddenDescriptionClaims('Merge memories from another worktree')).toEqual([]);
    expect(forbiddenDescriptionClaims('manual = human approves the plan')).toEqual([]);
    expect(forbiddenDescriptionClaims('the user can accept or override it')).toEqual([]);
    expect(forbiddenDescriptionClaims('rejects overwriting enabled rules')).toEqual([]);
  });
});

describe('allowlist (E11-4)', () => {
  it('is exactly the three documented exceptions', () => {
    expect(Object.keys(ALLOWLIST).sort()).toEqual([
      'mafw_ask_user',
      'mafw_decision_draft',
      'mafw_pod_review_respond',
    ]);
  });

  it('every entry exists and still documents why it is safe', () => {
    for (const [name, entry] of Object.entries(ALLOWLIST)) {
      const def = DEFINITIONS.find((d) => d.name === name);
      expect(def).toBeDefined();
      for (const expected of entry.descriptionIncludes) {
        expect(def!.description).toContain(expected);
      }
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });

  it('the memory-fusion merge exception is exactly two tools', () => {
    expect(MEMORY_MERGE_TOOLS).toEqual(['mafw_merge_memory', 'mafw_resolve_merge']);
    for (const name of MEMORY_MERGE_TOOLS) {
      expect(DEFINITIONS.some((d) => d.name === name)).toBe(true);
    }
  });
});

/** Human-only helpers that must never be reachable from the MCP surface. */
const FORBIDDEN_IDENTIFIERS = [
  'requireHumanPrincipal',
  'confirmDecision',
  'shelveDecision',
  'acceptGoal',
  'replyPermission',
  'rotateHumanToken',
  'human.token',
];

interface SourceFile {
  file: string;
  content: string;
}

function walkMcpSources(root: string): SourceFile[] {
  const out: SourceFile[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkMcpSources(full));
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    out.push({ file: path.relative(process.cwd(), full), content: fs.readFileSync(full, 'utf-8') });
  }
  return out;
}

function scanIdentifiers(files: SourceFile[], identifiers: string[] = FORBIDDEN_IDENTIFIERS): string[] {
  const violations: string[] = [];
  for (const { file, content } of files) {
    content.split(/\r?\n/).forEach((line, i) => {
      for (const identifier of identifiers) {
        if (line.includes(identifier)) violations.push(`${file}:${i + 1}: ${identifier} — ${line.trim()}`);
      }
    });
  }
  return violations;
}

describe('MCP source scan (E11-4)', () => {
  const mcpRoot = path.resolve(__dirname, '../../../src/mcp');

  it('walks the real MCP sources (including the transport and the registry)', () => {
    const files = walkMcpSources(mcpRoot).map((f) => f.file.replace(/\\/g, '/'));
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith('src/mcp/tool-registry.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('src/mcp/sse-transport.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('src/mcp/handlers/add-memory.ts'))).toBe(true);
  });

  it('never references a human-only helper', () => {
    expect(scanIdentifiers(walkMcpSources(mcpRoot))).toEqual([]);
  });

  it('the scanner reports file:line (and is not vacuously green)', () => {
    const violations = scanIdentifiers(
      [{ file: 'src/mcp/example.ts', content: 'const x = 1;\n\nrequireHumanPrincipal(req);\n' }],
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('src/mcp/example.ts:3');
    expect(violations[0]).toContain('requireHumanPrincipal');
  });
});
