/**
 * View DTO 生产者契约（review I1/I2/I3 的网关侧）：
 * `/api/sessions`、`/api/provider`、`/api/agents`、permission / question 出口必须
 * 产出规范字段——客户端只读这些字段，不再解析 runtime 原生形状。
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  canonicalModelRef,
  canonicalSessionRevert,
  canonicalSessionStatus,
  enrichPermissionEvent,
  projectAgents,
  projectPermissionList,
  projectPermissionRequest,
  projectProviderEnvelope,
  projectQuestionRequest,
  projectSession,
  projectSessions,
} from '../../../src/runtime/view-projections';
import { mergeAgentLists } from '../../../src/runtime/identity-state';

describe('MafwSession 投影（/api/sessions 出口）', () => {
  it('time.busy > time.idle → status busy（opencode 原生运行态）', () => {
    expect(canonicalSessionStatus({ time: { busy: 20, idle: 10 } })).toBe('busy');
    expect(canonicalSessionStatus({ time: { busy: 10, idle: 20 } })).toBe('idle');
    expect(canonicalSessionStatus({ time: { busy: 10, idle: 10 } })).toBe('idle');
  });

  it('retry 从原生 status 透传（字符串或 `{type}` 状态快照）；无时间戳又无 status → unknown', () => {
    expect(canonicalSessionStatus({ status: 'retry' })).toBe('retry');
    // opencode 2.x 的 session status 快照是 `{ type: 'retry', attempt, message, next }`
    expect(canonicalSessionStatus({ status: { type: 'retry', attempt: 2, message: 'rate limited' } })).toBe('retry');
    expect(canonicalSessionStatus({ status: { type: 'busy' } })).toBe('busy');
    expect(canonicalSessionStatus({})).toBe('unknown');
    expect(canonicalSessionStatus({ time: {} })).toBe('unknown');
    expect(canonicalSessionStatus({ status: 'nonsense' })).toBe('unknown');
    expect(canonicalSessionStatus({ status: { type: 'nonsense' } })).toBe('unknown');
  });

  it('revert → reverted（含 diffs），原生字段保留', () => {
    const raw = {
      id: 'ses_1',
      time: { busy: 5, idle: 4 },
      revert: {
        messageID: 'msg_9',
        partID: 'prt_1',
        diff: [{ file: 'a.ts', additions: 2, deletions: 1, status: 'modified' }],
      },
    };
    const projected = projectSession(raw);
    expect(projected).toMatchObject({
      id: 'ses_1',
      status: 'busy',
      reverted: { messageID: 'msg_9', partID: 'prt_1', diffs: [{ file: 'a.ts', additions: 2, deletions: 1, status: 'modified' }] },
    });
    // 原生键仍在（过渡期）
    expect(projected.revert).toBe(raw.revert);
    expect(canonicalSessionRevert({ id: 'x' })).toBeUndefined();
    expect(canonicalSessionRevert({ restore: { messageID: 'm1' } })).toBeUndefined();
  });

  it('model 取自会话字段；无模型时不伪造', () => {
    expect(canonicalModelRef({ model: { providerID: 'xiaomi', modelID: 'mimo-v2.6-pro', variant: 'fast' } }))
      .toEqual({ providerID: 'xiaomi', modelID: 'mimo-v2.6-pro', variant: 'fast' });
    expect(canonicalModelRef({ providerID: 'pi', modelID: 'm1' })).toEqual({ providerID: 'pi', modelID: 'm1' });
    expect(canonicalModelRef({})).toBeUndefined();

    const projected = projectSession({ id: 's', model: { providerID: 'pi', modelID: 'm1' } });
    expect(projected.model).toEqual({ providerID: 'pi', modelID: 'm1' });
    expect(projectSession({ id: 's' }).model).toBeUndefined();
  });

  it('列表投影逐项、保序，无法投影的条目原样保留', () => {
    const out = projectSessions([
      { id: 's1', status: 'busy' },
      null,
      { title: 'no id' },
      { id: 's2', time: { idle: 9, busy: 1 } },
    ]);
    expect(out.map((s: any) => s?.id)).toEqual(['s1', undefined, undefined, 's2']);
    expect(out[0].status).toBe('busy');
    expect(out[3].status).toBe('idle');
  });
});

describe('MafwProvider 投影：models 恒为数组', () => {
  const opencodeShape = {
    all: [
      {
        id: 'xiaomi',
        name: 'Xiaomi',
        models: {
          'mimo-v2.6-pro': { id: 'mimo-v2.6-pro', name: 'MiMo v2.6 Pro', limit: { context: 200000, output: 8192 }, capabilities: { reasoning: true, input: { image: true } } },
        },
      },
      { id: 'pi', name: 'PI', models: [{ id: 'm1', name: 'M1' }] },
    ],
    default: { providerID: 'xiaomi', modelID: 'mimo-v2.6-pro' },
    connected: ['xiaomi'],
  };

  it('opencode 对象映射 → 数组（每个条目带 providerID / 限制 / profile 扩展）', () => {
    const out = projectProviderEnvelope(opencodeShape);
    expect(out.items).toHaveLength(2);
    expect(out.items[0]).toMatchObject({
      id: 'xiaomi',
      name: 'Xiaomi',
      connected: true,
      models: [{ id: 'mimo-v2.6-pro', name: 'MiMo v2.6 Pro', providerID: 'xiaomi', contextLimit: 200000, outputLimit: 8192 }],
    });
    expect(out.items[0].models[0].extensions).toEqual({ vision: true, thinking: true });
    expect(out.items[1]).toMatchObject({ id: 'pi', connected: false, models: [{ id: 'm1', providerID: 'pi' }] });
    // 原生 `all` 不再下发（唯一规范出口是 items），default/connected 保留
    expect((out as any).all).toBeUndefined();
    expect(out.default).toEqual({ providerID: 'xiaomi', modelID: 'mimo-v2.6-pro' });
  });

  it('pi 数组形状 / 裸数组 / 空输入都不炸', () => {
    expect(projectProviderEnvelope([{ id: 'pi', models: [{ id: 'm1' }] }]).items[0].models).toHaveLength(1);
    expect(projectProviderEnvelope(null).items).toEqual([]);
    expect(projectProviderEnvelope({}).items).toEqual([]);
  });
});

describe('MafwAgent 投影（/api/agents 出口）', () => {
  it('注册表身份 → mafw/可选；runtime 原生 → runtime/按 mode+hidden 判定', () => {
    const merged = mergeAgentLists(
      [{ name: 'lead', description: 'Lead', scope: 'primary', materialized: true }],
      [
        { name: 'build', description: 'Build', mode: 'primary' },
        { name: 'explore', description: 'Explore', mode: 'subagent' },
        { name: 'ghost', mode: 'primary', hidden: true },
      ],
    );
    const out = projectAgents(merged);
    expect(out.map((a) => [a.id, a.label, a.source, a.selectable, a.mode])).toEqual([
      ['lead', 'lead', 'mafw', true, 'primary'],
      ['build', 'build', 'runtime', true, 'primary'],
      ['explore', 'explore', 'runtime', false, 'subagent'],
      ['ghost', 'ghost', 'runtime', false, 'primary'],
    ]);
  });

  it('空输入 → 空数组（客户端不再回退 legacy name 列表）', () => {
    expect(projectAgents(null)).toEqual([]);
    expect(projectAgents([{ name: '' }])).toEqual([]);
  });

  it('runtime 角色标记（default/planning）透传——客户端不按 runtime agent 名分支', () => {
    const out = projectAgents([
      { name: 'Build', mode: 'primary', default: true },
      { name: 'Plan', mode: 'primary', planning: true },
      { name: 'General', mode: 'subagent' },
    ]);
    expect(out[0]).toMatchObject({ id: 'Build', default: true });
    expect(out[0]).not.toHaveProperty('planning');
    expect(out[1]).toMatchObject({ id: 'Plan', planning: true });
    expect(out[1]).not.toHaveProperty('default');
    expect(out[2]).not.toHaveProperty('default');
    expect(out[2]).not.toHaveProperty('planning');
  });
});

describe('MafwPermissionRequest 投影（I1/I2）', () => {
  it('opencode 原生（id/permission/patterns/metadata）→ 规范字段', () => {
    const out = projectPermissionRequest({
      id: 'per_1',
      sessionID: 'ses_1',
      permission: 'bash',
      patterns: ['npm test'],
      metadata: { impact: 'run tests' },
      always: 'npm test',
      tool: { messageID: 'msg_1', callID: 'call_1' },
    }, 'ses_fallback');
    expect(out).toMatchObject({
      id: 'per_1',
      sessionID: 'ses_1',
      kind: 'bash',
      targets: ['npm test'],
      suggestedRule: { scope: 'prefix', value: 'npm test' },
      tool: { messageID: 'msg_1', callID: 'call_1' },
      extensions: { impact: 'run tests' },
    });
  });

  it('pi 原生（requestId/toolName/args/risk）→ id 不丢、targets 取自命令', () => {
    const out = projectPermissionRequest({
      sessionID: 'ses_pi',
      requestId: '6f1c2a9e',
      toolName: 'shell',
      args: { command: 'rm -rf build' },
      risk: 'medium',
    });
    expect(out).toMatchObject({
      id: '6f1c2a9e',
      sessionID: 'ses_pi',
      kind: 'bash',
      targets: ['rm -rf build'],
      suggestedRule: { scope: 'tool', value: 'shell' },
      extensions: { risk: 'medium' },
    });
  });

  it('无 id 的请求被丢弃（列表绝不产出无 id 卡片）', () => {
    expect(projectPermissionRequest({ permission: 'bash', patterns: [] })).toBeNull();
    expect(projectPermissionList([{ permission: 'bash' }, { id: 'ok', permission: 'edit' }])).toHaveLength(1);
  });

  it('live 事件富化与 REST 列表同形（单一出口）', () => {
    const props: Record<string, any> = {
      sessionID: 'ses_pi',
      requestId: 'rq_1',
      toolName: 'shell',
      args: { command: 'npm test' },
      mafwPolicy: { action: 'human' },
    };
    enrichPermissionEvent(props, 'ses_pi');
    // 原生键保留（过渡期），规范键补齐
    expect(props).toMatchObject({ requestId: 'rq_1', toolName: 'shell' });
    expect(props).toMatchObject({ id: 'rq_1', kind: 'bash', targets: ['npm test'], mafwPolicy: { action: 'human' } });
  });

  it('pi 形状 permission.replied（无 toolName/args）→ 仍产出 id/kind，原生答复字段原样保留', () => {
    // 缺口 2 根因：replied 只走 asked 的富化分支外，卡片拿不到 canonical id →
    // 桌面/远端永远销不掉卡（pi 答复因此表现为「卡住」）。
    const props: Record<string, any> = {
      sessionID: 'ses_pi',
      requestId: 'rq_replied',
      approved: false,
      decision: 'reject',
      message: 'user said no',
    };
    const out = enrichPermissionEvent(props, 'ses_pi');
    expect(out).toMatchObject({ id: 'rq_replied', sessionID: 'ses_pi', kind: 'tool', targets: [] });
    // 原生答复字段不改写（approval 语义只在 gateway 策略层，投影不参与）
    expect(props).toMatchObject({
      requestId: 'rq_replied', approved: false, decision: 'reject', message: 'user said no',
    });
    expect(props).not.toHaveProperty('reply');
  });

  it('opencode v2 replied（requestID/reply）→ canonical id 取自 requestID', () => {
    const out = projectPermissionRequest({ sessionID: 'ses_oc', requestID: 'per_2', reply: 'always' });
    expect(out).toMatchObject({ id: 'per_2', kind: 'tool', targets: [] });
  });
});

describe('MafwQuestionRequest 投影', () => {
  it('规范 questions[]（question/options）齐备，原生 form 字段保留', () => {
    const out = projectQuestionRequest({
      id: 'q1',
      sessionID: 's1',
      form: { fields: [] },
      mode: 'form',
      expiresAt: 123,
      questions: [{ question: '哪个文件？', header: '文件', options: [{ label: 'a', value: 'a' }], type: 'string', required: true }],
    });
    expect(out).toMatchObject({ id: 'q1', sessionID: 's1', mode: 'form', expiresAt: 123 });
    expect(out.questions[0]).toMatchObject({
      question: '哪个文件？',
      header: '文件',
      options: [{ label: 'a' }],
      type: 'string',
      required: true,
    });
  });

  it('缺 question 文本时用位置兜底；无 id 原样返回', () => {
    const out = projectQuestionRequest({ id: 'q2', sessionID: 's', questions: [{}] });
    expect(out.questions[0].question).toBe('Question 1');
    expect(projectQuestionRequest({ sessionID: 's' })).toEqual({ sessionID: 's' });
  });
});

describe('出口接线（index.ts）', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../../src/index.ts'), 'utf-8');

  it('/api/sessions 列表与单条都过 projectSession（规范 status/reverted/model）', () => {
    expect(source).toMatch(/JSON\.stringify\(\{ sessions: projectSessions\(sessions\) \}\)/);
    expect(source).toMatch(/JSON\.stringify\(projectSession\(session\)\)/);
  });

  it('/api/provider 走 projectProviderEnvelope（models 恒数组，不再透传 all）', () => {
    expect(source).toMatch(/JSON\.stringify\(projectProviderEnvelope\(result \?\? null\)\)/);
  });

  it('/api/agents 走 projectAgents（id/label/selectable）', () => {
    expect(source).toMatch(/JSON\.stringify\(\{ items: projectAgents\(items\) \}\)/);
  });

  it('/api/permissions 与 live permission.asked/replied 共用投影（enrichPermissionEvent）', () => {
    expect(source).toMatch(/items: projectPermissionList\(items\)/);
    expect(source).toMatch(/enrichPermissionEvent\(props, sessionID\)/);
    // 缺口 2：replied 与 asked 同一投影（只富化 asked 时 pi 答复永远销不掉卡）
    expect(source).toMatch(/MAFW\.permissionAsked \|\| type === MAFW\.permissionReplied/);
  });

  it('/api/questions 与 live question.asked 共用 projectQuestionRequest', () => {
    expect(source).toMatch(/items: \(items \?\? \[\]\)\.map\(\(item: any\) => projectQuestionRequest\(item\)\)/);
    expect(source).toMatch(/projectQuestionRequest\(props, sessionID\)/);
  });
});
