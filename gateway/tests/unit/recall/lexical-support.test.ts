/**
 * Lexical candidate support: the admission gate that keeps a ratio-confident
 * (`FOK=inject`) turn from injecting a pool that shares no word-level unit with
 * the query.
 *
 * Root cause it closes: boundary BM25 tokenizes CJK as *unigrams*, so an
 * unrelated no-answer query can still produce a dominant top1/mean ratio made
 * of scattered single characters (`堪培拉十二月平均降雨量` → 7 pointers; the
 * same shape for `缝纫机改牛仔裤腰围怎么走线`, whose only shared bigram is the
 * question frame `怎么`). Word-level support is the smallest unit that is
 * externally checkable: an ASCII word (stopwords excluded) or a CJK bigram that
 * is not question-frame grammar.
 *
 * Scope: only turns where FOK actually evaluated to `inject` are re-checked.
 * Disabled / missing-scorer / throwing FOK keeps its fail-open `inject`.
 * `low-confidence` / `no-memory` stay suppressed exactly as before, and
 * deterministic exact evidence still runs afterwards — so an exact title /
 * identifier / distinctive cue always bypasses this veto.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachRecallRoutes } from '../../../src/routes/recall';
import { config } from '../../../src/config';
import {
  hasCandidateLexicalSupport,
  selectLexicallySupportedCandidates,
  type LexicalSupportCandidate,
} from '../../../src/recall/lexical-support';
import { recallNeighbors } from '../../../src/recall/recall-context';
import { RetrievalEventBuffer, setRetrievalEventBufferForTest } from '../../../src/core/memory/retrieval-events';

function retrieveEventsForTest(): { buffer: RetrievalEventBuffer; restore: () => void } {
  const buffer = new RetrievalEventBuffer();
  setRetrievalEventBufferForTest(buffer);
  return { buffer, restore: () => setRetrievalEventBufferForTest(null) };
}

function candidate(overrides: Partial<LexicalSupportCandidate> = {}): LexicalSupportCandidate {
  return {
    primary_abstraction: 'candidate',
    cue_anchors: [],
    ...overrides,
  };
}

function entry(overrides: Record<string, any> = {}): any {
  return {
    id: 'mem_flat_default',
    type: 'semantic',
    primary_abstraction: 'default abstraction',
    cue_anchors: [],
    memory_value: 'default value',
    energy: 0.8,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('hasCandidateLexicalSupport', () => {
  test('rejects the 堪培拉 negative shape: generic CJK unigram overlap only', () => {
    // Live candidates for this true no-answer query: the shared characters are
    // isolated unigrams (月/平/…), there is no shared two-character phrase.
    const candidates = [
      candidate({
        primary_abstraction: '右工作台B两层B1下拉定稿',
        cue_anchors: ['B1固定下拉', '工作台一级', '执行二级', '子代理', '后台', '轨迹'],
      }),
      candidate({
        primary_abstraction: 'usage 网关自然月+pct精度落地与stash互踩恢复',
        cue_anchors: ['usage', 'stash', 'calendarMonthStart', 'resetAt', 'push/pop'],
      }),
      candidate({
        primary_abstraction: 'RRF(k=60) 融合会把通道间 raw 分数量级差压平成近乎均匀的融合分',
        cue_anchors: ['RRF', 'k=60', 'score flattening', 'BM25', 'dense embedding'],
      }),
    ];
    expect(hasCandidateLexicalSupport(candidates, '堪培拉十二月平均降雨量')).toBe(false);
  });

  test('rejects the 牛仔裤 negative shape: the only shared CJK bigram is question-frame grammar', () => {
    const candidates = [
      candidate({
        primary_abstraction: '汇报只讲组装结构与改动点',
        cue_anchors: ['把组装后的样子', '只看我们改了哪些', 'step 和前step', 'loop 怎么组装', '汇报偏好', 'repact'],
      }),
      candidate({
        primary_abstraction: 'goal 编排接缝三节点梯度与 W4 数据流',
        cue_anchors: ['goal', '编排', '排接', '接缝', '缝三', 'renderNodePrompt'],
      }),
    ];
    expect(hasCandidateLexicalSupport(candidates, '缝纫机改牛仔裤腰围怎么走线')).toBe(false);
  });

  test('rejects a fresh third-topic negative (ornamental horticulture)', () => {
    const candidates = [
      candidate({ primary_abstraction: 'gateway 启动 adopt 阶梯', cue_anchors: ['desktop', 'adopt', '阶梯'] }),
      candidate({ primary_abstraction: 'note-board 预算裁切', cue_anchors: ['note-board', '预算'] }),
      candidate({ primary_abstraction: 'rebase 冲突解决路径', cue_anchors: ['rebase', '冲突'] }),
    ];
    expect(hasCandidateLexicalSupport(candidates, '如何给室内龟背竹换盆')).toBe(false);
  });

  test.each([
    ['怎样', '牛仔裤腰围怎样改小', 'assembly 怎样组装'],
    ['在哪', '证书到底在哪配置', '请问在哪查看'],
    ['有没有', '企鹅换羽期有没有固定时长', '有没有人看管'],
    ['能不能', 'cert-manager 能不能自动续期', '能不能复用旧连接'],
    ['会不会', '企鹅会不会换羽', '会不会自己复活'],
    ['干嘛', '番茄炒蛋干嘛先放糖', '到底干嘛要迁移'],
    ['需不需要', '马拉松赛前需不需要碳水负荷', '需不需要重启'],
    ['怎么样', 'sourdough 发酵怎么样', '数据怎么样回填'],
  ])('rejects a negative whose only shared bigram is the frame variant %s', (_label, query, candidateText) => {
    expect(hasCandidateLexicalSupport([candidate({ primary_abstraction: candidateText })], query)).toBe(false);
  });

  test('rejects a pure-English negative that shares only stopwords', () => {
    const candidates = [
      candidate({ primary_abstraction: 'the deployment is in the release notes' }),
      candidate({ primary_abstraction: 'an incident review of the rollout' }),
    ];
    expect(hasCandidateLexicalSupport(candidates, 'how do I water a monstera in winter')).toBe(false);
  });

  test('rejects a mixed ASCII+CJK negative that shares only stopwords and no bigram', () => {
    const candidates = [
      candidate({ primary_abstraction: 'the deployment is in the release notes' }),
    ];
    expect(hasCandidateLexicalSupport(candidates, 'how do I water a monstera in winter 怎么养')).toBe(false);
  });

  test('keeps ASCII identifiers whole even though stopwords are excluded', () => {
    expect(hasCandidateLexicalSupport(
      [candidate({ primary_abstraction: 'isEnabled flag parsing', cue_anchors: ['isEnabled'] })],
      'isEnabled',
    )).toBe(true);
    expect(hasCandidateLexicalSupport(
      [candidate({ primary_abstraction: 'the is' })],
      'isEnabled',
    )).toBe(false);
  });

  test('matches acronym-run identifier parts like splitIdentifierParts', () => {
    // HTTPServer → HTTP + Server; a 1-char camel prefix never becomes a part.
    expect(hasCandidateLexicalSupport(
      [candidate({ primary_abstraction: 'HTTPServer 证书链' })],
      'server',
    )).toBe(true);
    expect(hasCandidateLexicalSupport(
      [candidate({ primary_abstraction: 'xRead helper' })],
      'read',
    )).toBe(false);
  });

  test('accepts Chinese bigram support (implicit paraphrase shape)', () => {
    const candidates = [
      candidate({
        primary_abstraction: 'MAFW 的 HarmonicIndex 是活单例权威存储——任何迁移/回填若由第二个索引实例执行都会被下一个 save 覆盖',
        cue_anchors: ['MAFW', 'HarmonicIndex', '迁移回填', '活单例'],
      }),
    ];
    expect(hasCandidateLexicalSupport(candidates, '为什么记忆回填或迁移会被下一个进程整体覆盖')).toBe(true);
  });

  test('accepts a current-state positive: shared topic bigram + ASCII words', () => {
    const candidates = [
      candidate({
        primary_abstraction: '「提交」仅本地 commit 不 push',
        cue_anchors: ['提交', 'commit', 'push', '本地 main', 'workbench plan'],
      }),
    ];
    expect(hasCandidateLexicalSupport(candidates, '提交只做本地 commit 不 push 的约定')).toBe(true);
  });

  test('accepts a mixed ASCII+CJK positive', () => {
    expect(hasCandidateLexicalSupport(
      [candidate({ primary_abstraction: 'serve sidecar 健康轮询必须用 raw HTTP 而非 SDK wrapper' })],
      'sidecar 健康检查 flapping 为什么改用原始 HTTP',
    )).toBe(true);
  });

  test('accepts ASCII identifiers as word-level support', () => {
    expect(hasCandidateLexicalSupport(
      [candidate({ primary_abstraction: 'note board budget', cue_anchors: ['NOTE_BOARD_BUDGET'] })],
      'NOTE_BOARD_BUDGET',
    )).toBe(true);
    expect(hasCandidateLexicalSupport(
      [candidate({ primary_abstraction: '线上检索效果与磁盘直查显著分叉', cue_anchors: ['5cd9885f5'] })],
      '5cd9885f5',
    )).toBe(true);
  });

  test('routes ASCII word matches by token, never by substring', () => {
    // `id` must not be satisfied by `valid`/`provided`.
    expect(hasCandidateLexicalSupport(
      [candidate({ primary_abstraction: 'all providers are valid', cue_anchors: [] })],
      'id',
    )).toBe(false);
  });

  test('never builds a CJK bigram across a title/cue or run boundary', () => {
    // Title ends with 接 and the next cue starts with 缝; the query bigram 接缝
    // must not be assembled from that boundary.
    expect(hasCandidateLexicalSupport(
      [candidate({ primary_abstraction: '编排接', cue_anchors: ['缝三'] })],
      '接缝',
    )).toBe(false);
    expect(hasCandidateLexicalSupport(
      [candidate({ primary_abstraction: '迁移 回填' })],
      '移回',
    )).toBe(false);
  });

  test('ignores body text: support is title + cue anchors only', () => {
    expect(hasCandidateLexicalSupport(
      [candidate({ primary_abstraction: 'unrelated title', cue_anchors: ['unrelated-cue'] })],
      '迁移回填的整体覆盖',
    )).toBe(false);
  });

  test('fails open when the query has no word-level unit', () => {
    expect(hasCandidateLexicalSupport([candidate({ primary_abstraction: 'whatever' })], '')).toBe(true);
    expect(hasCandidateLexicalSupport([candidate({ primary_abstraction: 'whatever' })], '？')).toBe(true);
    expect(hasCandidateLexicalSupport([], '迁移回填')).toBe(false);
  });
});

describe('selectLexicallySupportedCandidates', () => {
  test('keeps support order and drops unsupported pointers', () => {
    const supported = candidate({ primary_abstraction: 'commit push 约定' });
    const unsupported = candidate({ primary_abstraction: 'flylink 探针三曲线分离' });
    const selection = selectLexicallySupportedCandidates([supported, unsupported], 'commit push 的约定');
    expect(selection.applicable).toBe(true);
    expect(selection.supported).toEqual([supported]);
  });

  test('reports an applicable empty selection when nothing is supported', () => {
    const selection = selectLexicallySupportedCandidates(
      [candidate({ primary_abstraction: 'flylink 探针三曲线分离' })],
      '堪培拉十二月平均降雨量',
    );
    expect(selection.applicable).toBe(true);
    expect(selection.supported).toEqual([]);
  });

  test('is not applicable (keeps every candidate) when the query has no unit', () => {
    const only = candidate({ primary_abstraction: 'whatever' });
    const selection = selectLexicallySupportedCandidates([only], '？');
    expect(selection.applicable).toBe(false);
    expect(selection.supported).toEqual([only]);
  });
});

describe('recallNeighbors after pointer filtering', () => {
  test('attaches neighbours only to the supported anchors that remain', () => {
    const entries = [
      entry({ id: 'mem_nb_a', primary_abstraction: 'neighbour a' }),
      entry({ id: 'mem_flat_unsupported', primary_abstraction: 'flylink 探针三曲线分离' }),
      entry({ id: 'mem_nb_mid', primary_abstraction: 'neighbour mid' }),
      entry({ id: 'mem_flat_supported', primary_abstraction: 'commit push 约定' }),
      entry({ id: 'mem_nb_b', primary_abstraction: 'neighbour b' }),
    ];
    const index = { getIndex: () => ({ entries }) };
    const selection = selectLexicallySupportedCandidates(
      [
        { id: 'mem_flat_unsupported', primary_abstraction: 'flylink 探针三曲线分离', cue_anchors: [] },
        { id: 'mem_flat_supported', primary_abstraction: 'commit push 约定', cue_anchors: [] },
      ],
      'commit push 的约定',
    );
    const neighbors = recallNeighbors(
      index,
      selection.supported.map((c: any) => ({ ...c, score: 1, energy: 0.8, memory_value: '' })),
      {},
    );
    expect([...neighbors.keys()]).toEqual(['mem_flat_supported']);
    expect(neighbors.get('mem_flat_unsupported')).toBeUndefined();
    expect(neighbors.get('mem_flat_supported')!.some(n => n.id === 'mem_nb_b')).toBe(true);
  });
});

// ---- Route-level contract: the veto can only downgrade an evaluated inject ----

function fakeReq(url: string, method = 'GET'): IncomingMessage {
  return {
    method,
    url,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
    on() { return this; },
  } as unknown as IncomingMessage;
}

function fakeRes(): { res: ServerResponse; status: number; body: string } {
  const out = { res: null as unknown as ServerResponse, status: 0, body: '' };
  out.res = {
    writeHead: (status: number) => { out.status = status; },
    end: (payload?: unknown) => { out.body = String(payload ?? ''); },
    setHeader: () => {},
  } as unknown as ServerResponse;
  return out;
}

interface HarnessOptions {
  rawScores?: number[];
  omitRawScorer?: boolean;
  scorerThrows?: boolean;
  mafwDir?: string;
}

function routeHarness(entries: any[], options: HarnessOptions = {}) {
  const byId = new Map(entries.map(e => [e.id, e]));
  const flatIds = entries.filter(e => e.id.startsWith('mem_flat_')).map(e => e.id);
  const index: any = {
    getIndex: () => ({ entries }),
    searchScored: () => flatIds.map(id => ({ entry: byId.get(id), score: 1 })),
    search: () => flatIds.map(id => byId.get(id)),
  };
  if (!options.omitRawScorer) {
    index.bm25RawScores = options.scorerThrows
      ? () => { throw new Error('scorer exploded'); }
      : () => options.rawScores ?? [10, 1, 1, 1];
  }
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachRecallRoutes(registry, {
    buildInstructionBlocks: async () => ({ revision: '', memoryGuide: '', userProfile: '', agentPriors: '' }),
    instructionSync: () => null,
    memoryService: () => ({ harmonicIndex: index }) as any,
    recallCalledBySession: () => new Map<string, number>(),
    leadSessionRegistry: () => ({ findBySessionId: () => null }) as any,
    registeredProjects: () => new Map(),
    mafwDir: () => options.mafwDir ?? os.tmpdir(),
    getGatewayDb: () => ({ kvGet: () => null }) as any,
    getScanService: () => null,
  });
  return {
    run: async (query: string): Promise<string> => {
      const url = `/api/recall/context?sessionID=s1&query=${encodeURIComponent(query)}`;
      const match = registry.match('GET', url as never);
      const out = fakeRes();
      await (match!.def.handler as any)(fakeReq(url), out.res, match!.params);
      expect(out.status).toBe(200);
      return JSON.parse(out.body).pointers as string;
    },
  };
}

describe('recall.context lexical-support wiring', () => {
  const original = {
    fok: { ...config.search.fok },
    snapshot: { ...config.search.snapshot },
    arbiter: config.search.arbiter,
    boundaryDense: config.search.boundaryDense,
    temporalNeighbors: { ...config.search.temporalNeighbors },
  };

  beforeAll(() => {
    config.search.fok = { ...config.search.fok, enabled: true, low: 1.2, high: 1.35 };
    config.search.snapshot = { ...config.search.snapshot, enabled: false };
    config.search.arbiter = false;
    config.search.boundaryDense = false;
    config.search.temporalNeighbors = { ...config.search.temporalNeighbors, presentation: false };
  });

  afterAll(() => {
    config.search.fok = original.fok;
    config.search.snapshot = original.snapshot;
    config.search.arbiter = original.arbiter;
    config.search.boundaryDense = original.boundaryDense;
    config.search.temporalNeighbors = original.temporalNeighbors;
  });

  const canberraEntries = () => [
    entry({ id: 'mem_flat_1', primary_abstraction: '右工作台B两层B1下拉定稿', cue_anchors: ['B1固定下拉', '子代理', '后台'] }),
    entry({ id: 'mem_flat_2', primary_abstraction: 'usage 网关自然月+pct精度落地与stash互踩恢复', cue_anchors: ['usage', 'stash', 'resetAt'] }),
    entry({ id: 'mem_flat_3', primary_abstraction: 'RRF(k=60) 融合会把通道间 raw 分数压平成近乎均匀', cue_anchors: ['RRF', 'BM25'] }),
  ];

  test('the 堪培拉 negative shape injects no body even at FOK=inject', async () => {
    const { run } = routeHarness(canberraEntries());
    const pointers = await run('堪培拉十二月平均降雨量');
    expect(pointers).toContain('相关记忆：无');
    expect(pointers).not.toContain('<recall');
    expect(pointers).not.toContain('#mem-');
  });

  test('the 牛仔裤 negative shape injects no body even at FOK=inject', async () => {
    const { run } = routeHarness([
      entry({ id: 'mem_flat_1', primary_abstraction: '汇报只讲组装结构与改动点', cue_anchors: ['loop 怎么组装', '汇报偏好'] }),
      entry({ id: 'mem_flat_2', primary_abstraction: 'goal 编排接缝三节点梯度与 W4 数据流', cue_anchors: ['编排', '排接', '接缝', '缝三'] }),
    ]);
    const pointers = await run('缝纫机改牛仔裤腰围怎么走线');
    expect(pointers).toContain('相关记忆：无');
    expect(pointers).not.toContain('<recall');
  });

  test('keeps a lexically supported current-state hit at FOK=inject', async () => {
    const { run } = routeHarness([
      entry({ id: 'mem_flat_1', primary_abstraction: '「提交」仅本地 commit 不 push', cue_anchors: ['提交', 'commit', 'push', '本地 main'] }),
      entry({ id: 'mem_flat_2', primary_abstraction: 'unrelated runner note', cue_anchors: ['runner'] }),
    ]);
    const pointers = await run('提交只做本地 commit 不 push 的约定');
    expect(pointers).toContain('相关记忆：见下方');
    expect(pointers).toContain('<recall>');
    expect(pointers).toContain('#mem-flat_1');
  });

  test('filters unsupported pointers out of a supported body', async () => {
    const { run } = routeHarness([
      entry({ id: 'mem_flat_1', primary_abstraction: '「提交」仅本地 commit 不 push', cue_anchors: ['提交', 'commit'] }),
      entry({ id: 'mem_flat_2', primary_abstraction: 'flylink 探针三曲线分离', cue_anchors: ['flylink', '探针'] }),
    ]);
    const pointers = await run('提交只做本地 commit 不 push 的约定');
    expect(pointers).toContain('#mem-flat_1');
    expect(pointers).not.toContain('#mem-flat_2');
  });

  test('deterministic exact evidence still bypasses the lexical veto', async () => {
    const { run } = routeHarness([
      entry({ id: 'mem_flat_1', primary_abstraction: 'flat one', cue_anchors: ['flat-one'] }),
      entry({ id: 'mem_flat_2', primary_abstraction: 'flat two', cue_anchors: ['flat-two'] }),
      entry({
        id: 'mem_1794931298999_alpfjc',
        primary_abstraction: '线上检索效果与磁盘直查显著分叉',
        cue_anchors: ['2026-11-18-live-retrieval-effect', '5cd9885f5', 'REST/MCP'],
      }),
    ]);
    const pointers = await run('5cd9885f5');
    expect(pointers).toContain('相关记忆：见下方');
    expect(pointers).toContain('<recall>');
    expect(pointers).toContain('#mem-alpfjc');
  });

  test('exact evidence cannot resurrect an unsupported negative (weak cue decoy)', async () => {
    const { run } = routeHarness([
      ...canberraEntries(),
      // A short (3-char) topical cue fails the exact-evidence length/coverage
      // rules; it must not turn this negative into a related body.
      entry({ id: 'mem_decoy', primary_abstraction: '旅行记录', cue_anchors: ['堪培拉'] }),
    ]);
    const pointers = await run('堪培拉十二月平均降雨量');
    expect(pointers).toContain('相关记忆：无');
    expect(pointers).not.toContain('<recall');
  });

  test('FOK disabled keeps its fail-open inject (veto not applied)', async () => {
    config.search.fok = { ...config.search.fok, enabled: false };
    try {
      const { run } = routeHarness(canberraEntries());
      const pointers = await run('堪培拉十二月平均降雨量');
      expect(pointers).toContain('相关记忆：见下方');
      expect(pointers).toContain('<recall>');
      expect(pointers).toContain('#mem-flat_1');
    } finally {
      config.search.fok = { ...config.search.fok, enabled: true, low: 1.2, high: 1.35 };
    }
  });

  test('a missing raw scorer keeps its fail-open inject (veto not applied)', async () => {
    const { run } = routeHarness(canberraEntries(), { omitRawScorer: true });
    const pointers = await run('堪培拉十二月平均降雨量');
    expect(pointers).toContain('相关记忆：见下方');
    expect(pointers).toContain('<recall>');
  });

  test('a throwing raw scorer keeps its fail-open inject (veto not applied)', async () => {
    const { run } = routeHarness(canberraEntries(), { scorerThrows: true });
    const pointers = await run('堪培拉十二月平均降雨量');
    expect(pointers).toContain('相关记忆：见下方');
    expect(pointers).toContain('<recall>');
  });

  test('note-board survives the veto', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-nb-veto-'));
    try {
      const sticky = {
        id: 'mem_sticky_reminder',
        type: 'semantic',
        primary_abstraction: 'sticky reminder',
        cue_anchors: ['提醒'],
        memory_value: '记得喝水',
        energy: 0.8,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        sticky_until: new Date(Date.now() + 86400e3).toISOString(),
      } as any;
      const { writeOKFFile } = require('../../../src/memory/okf-writer');
      const fileName = writeOKFFile(dir, sticky);
      const { getOKFDirectory } = require('../../../src/memory/okf-writer');
      const filePath = `memory/${getOKFDirectory(sticky)}/${fileName}`;
      const { run } = routeHarness([
        ...canberraEntries(),
        entry({ ...sticky, filePath }),
      ], { mafwDir: dir });
      const pointers = await run('堪培拉十二月平均降雨量');
      expect(pointers).toContain('相关记忆：无');
      expect(pointers).not.toContain('<recall');
      expect(pointers).toContain('<note-board>');
      expect(pointers).toContain('记得喝水');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a vetoed body records no ACT-R retrieval exposure', async () => {
    const { buffer, restore } = retrieveEventsForTest();
    try {
      const { run } = routeHarness(canberraEntries());
      await run('堪培拉十二月平均降雨量');
      expect(buffer.needFor('mem_flat_1')).toBe(0);
      expect(buffer.needFor('mem_flat_2')).toBe(0);
      expect(buffer.needFor('mem_flat_3')).toBe(0);
    } finally {
      restore();
    }
  });

  test('a rendered body records exactly the injected candidates', async () => {
    const { buffer, restore } = retrieveEventsForTest();
    try {
      const { run } = routeHarness([
        entry({ id: 'mem_flat_1', primary_abstraction: '「提交」仅本地 commit 不 push', cue_anchors: ['提交', 'commit'] }),
        entry({ id: 'mem_flat_2', primary_abstraction: 'flylink 探针三曲线分离', cue_anchors: ['flylink', '探针'] }),
      ]);
      await run('提交只做本地 commit 不 push 的约定');
      expect(buffer.needFor('mem_flat_1')).toBe(1);
      expect(buffer.needFor('mem_flat_2')).toBe(0);
    } finally {
      restore();
    }
  });

  test('ordinary no-memory suppression is unchanged', async () => {
    const { run } = routeHarness([
      entry({ id: 'mem_flat_1', primary_abstraction: '「提交」仅本地 commit 不 push', cue_anchors: ['提交', 'commit'] }),
    ], { rawScores: [1, 1, 1, 1] });
    const pointers = await run('提交只做本地 commit 不 push 的约定');
    expect(pointers).toContain('相关记忆：无');
    expect(pointers).not.toContain('<recall');
  });
});
