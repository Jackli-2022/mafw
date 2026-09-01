/**
 * L2 reader prompt tests (Chain-of-Note mode). Run:
 *   npx ts-node --project evaluation/longmemeval/tsconfig.json evaluation/longmemeval/src/test-reader-prompt.ts
 */
import assert from 'assert';
import { buildReaderMessages } from './l2-qa';

const msgs = buildReaderMessages('Q?', ['[2023/07/01 (Sat) 10:00] body text'], false, 'date', false, false, false, '2023-08-01');

// plain mode: no note instruction
assert(!msgs[1].content.includes('Note S#'), 'plain mode must not contain note instruction');

// chain-of-note mode: note instruction present + structured answer contract
const con = buildReaderMessages('Q?', ['[2023/07/01 (Sat) 10:00] body text'], true, 'date', false, false, false, '2023-08-01', 'chain-of-note');
assert(con[1].content.includes('Note S# (relevant: yes/no)'), 'chain-of-note must require per-session notes');
assert(con[1].content.includes('using ONLY what your notes established'), 'answer must derive from notes only');
assert(con[1].content.includes('Session 1:'), 'sessions still numbered');
assert(con[0].content.includes('incomplete'), 'abstention hint preserved');

console.log('reader-prompt tests: all passed');
