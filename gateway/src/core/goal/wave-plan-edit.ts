// gateway/src/core/goal/wave-plan-edit.ts
// waves 计划的任务编辑（纯函数）：按 externalTaskId（`${wave.id}-t${i+1}`）定位，
// 只改标题/验收，返回新 plan；不做任何 IO。

export interface WaveTaskPatch {
  title?: string;
  acceptance?: string[];
}

export interface WaveTaskRef {
  waveIndex: number;
  taskIndex: number;
}

const MAX_ACCEPTANCE_ITEMS = 20;
const MAX_ACCEPTANCE_CHARS = 500;

function wavesOf(plan: unknown): any[] | null {
  if (!plan || typeof plan !== 'object') return null;
  const waves = (plan as any).waves;
  return Array.isArray(waves) ? waves : null;
}

function externalIdAt(wave: any, index: number): string | null {
  const waveId = typeof wave?.id === 'string' ? wave.id : '';
  if (!waveId) return null;
  return `${waveId}-t${index + 1}`;
}

export function findWaveTask(plan: unknown, externalTaskId: string): WaveTaskRef | null {
  const waves = wavesOf(plan);
  if (!waves) return null;
  for (let waveIndex = 0; waveIndex < waves.length; waveIndex += 1) {
    const wave = waves[waveIndex];
    const tasks = Array.isArray(wave?.tasks) ? wave.tasks : [];
    for (let taskIndex = 0; taskIndex < tasks.length; taskIndex += 1) {
      if (externalIdAt(wave, taskIndex) === externalTaskId) return { waveIndex, taskIndex };
    }
  }
  return null;
}

function normalizeAcceptance(input: string[] | undefined): string[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const value = String(raw ?? '').trim().slice(0, MAX_ACCEPTANCE_CHARS);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= MAX_ACCEPTANCE_ITEMS) break;
  }
  return out;
}

/**
 * 返回编辑后的新 plan；任务不存在/plan 畸形返回 null。
 * - 字符串任务在写入 acceptance 时升级为 `{title, acceptance}`；
 * - `acceptance: []` 表示清空（字段删除，不留空数组）；
 * - 其他 wave/task 保持引用不变（浅层不可变）。
 */
export function editWaveTask(plan: unknown, externalTaskId: string, patch: WaveTaskPatch): unknown | null {
  const waves = wavesOf(plan);
  if (!waves) return null;
  const found = findWaveTask(plan, externalTaskId);
  if (!found) return null;

  const wave = waves[found.waveIndex];
  const raw = wave.tasks[found.taskIndex];
  const baseTitle = typeof raw === 'string'
    ? raw
    : (typeof raw?.title === 'string' ? raw.title : '');

  const nextTitle = typeof patch.title === 'string' ? patch.title.trim() : baseTitle;
  if (!nextTitle) return null;

  const acceptance = normalizeAcceptance(patch.acceptance);
  const previousAcceptance = Array.isArray(raw?.acceptance)
    ? raw.acceptance.map((item: unknown) => String(item)).filter((item: string) => item.trim())
    : undefined;
  const effectiveAcceptance = acceptance === undefined ? previousAcceptance : acceptance;

  const nextTask: Record<string, unknown> = { title: nextTitle };
  if (effectiveAcceptance && effectiveAcceptance.length > 0) nextTask.acceptance = effectiveAcceptance;

  const nextTasks = wave.tasks.slice();
  nextTasks[found.taskIndex] = nextTask;

  const nextWave = { ...wave, tasks: nextTasks };
  const nextWaves = waves.slice();
  nextWaves[found.waveIndex] = nextWave;

  return { ...(plan as object), waves: nextWaves };
}
