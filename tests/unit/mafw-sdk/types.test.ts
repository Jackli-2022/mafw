import {
  Goal, GoalControlAction, TriageItem, AutomationRule, MemoryUnit,
  Project, Session, GatewayStatus, MemoryActionType,
} from '../../../mafw-sdk/src'

describe('Goal type', () => {
  it('constructs valid Goal object', () => {
    const g: Goal = { goalId: 'g1', phase: 'PLANNING', loop: 1, currentWave: 0, totalWaves: 3 }
    expect(g.goalId).toBe('g1')
    expect(g.phase).toBe('PLANNING')
  })

  it('allows optional error field', () => {
    const g: Goal = { goalId: 'g1', phase: 'FAILED', loop: 1, currentWave: 0, totalWaves: 3, error: 'timeout' }
    expect(g.error).toBe('timeout')
  })
})

describe('GoalControlAction type', () => {
  it('PAUSE action', () => {
    const a: GoalControlAction = { goalId: 'g1', action: 'PAUSE' }
    expect(a.action).toBe('PAUSE')
  })

  it('ABORT action', () => {
    const a: GoalControlAction = { goalId: 'g1', action: 'ABORT' }
    expect(a.action).toBe('ABORT')
  })
})

describe('TriageItem type', () => {
  it('constructs valid TriageItem', () => {
    const t: TriageItem = {
      id: 't1', summary: 'test', automationId: 'a1',
      severity: 'high', state: 'PENDING_CONFIRMATION', discoveredAt: '2026-01-01',
    }
    expect(t.id).toBe('t1')
    expect(t.severity).toBe('high')
    expect(t.state).toBe('PENDING_CONFIRMATION')
  })

  it('allows all state values', () => {
    const c: TriageItem = { id: 't1', summary: '', automationId: 'a1', severity: 'low', state: 'CONFIRMED', discoveredAt: '' }
    const r: TriageItem = { id: 't1', summary: '', automationId: 'a1', severity: 'medium', state: 'REJECTED', discoveredAt: '' }
    expect(c.state).toBe('CONFIRMED')
    expect(r.state).toBe('REJECTED')
  })
})

describe('AutomationRule type', () => {
  it('constructs valid AutomationRule with required fields', () => {
    const r: AutomationRule = {
      id: 'r1', enabled: true,
      trigger: { type: 'cron', schedule: '0 4 * * *', timezone: 'UTC' },
      action: { type: 'cognitive_prune' },
    }
    expect(r.id).toBe('r1')
    expect(r.trigger.schedule).toBe('0 4 * * *')
    expect(r.action.type).toBe('cognitive_prune')
  })

  it('allows optional fields', () => {
    const r: AutomationRule = {
      id: 'r1', enabled: false,
      trigger: { type: 'cron', schedule: '0 * * * *', timezone: 'Asia/Shanghai' },
      action: { type: 'memory_decay' },
      skill: 'mafw-prune',
      args: { threshold: 0.3 },
      onResult: { type: 'triage', auto_confirm: true },
      goal_defaults: { maxLoops: 3 },
    }
    expect(r.skill).toBe('mafw-prune')
    expect(r.args?.threshold).toBe(0.3)
    expect(r.onResult?.type).toBe('triage')
    expect(r.goal_defaults?.maxLoops).toBe(3)
  })
})

describe('MemoryUnit type', () => {
  it('constructs valid MemoryUnit', () => {
    const m: MemoryUnit = {
      id: 'mem-1', type: 'semantic',
      primary_abstraction: 'test fact',
      cue_anchors: ['test'], memory_value: 'value', energy: 0.8,
    }
    expect(m.type).toBe('semantic')
    expect(m.energy).toBe(0.8)
  })
})

describe('Project type', () => {
  it('includes optional mafwDir', () => {
    const p: Project = { id: '/proj', worktree: '/proj', mafwDir: '/proj/.mafw' }
    expect(p.mafwDir).toBe('/proj/.mafw')
  })
})

describe('GatewayStatus type', () => {
  it('constructs all states', () => {
    const s: GatewayStatus = { state: 'ready', port: 3000, url: 'http://localhost:3000', error: null }
    expect(s.state).toBe('ready')
    const f: GatewayStatus = { state: 'failed', port: null, url: null, error: 'connection refused' }
    expect(f.state).toBe('failed')
  })
})
