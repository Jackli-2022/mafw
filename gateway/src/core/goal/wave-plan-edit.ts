// gateway/src/core/goal/wave-plan-edit.ts
// waves 计划的任务编辑（纯函数）：按任务稳定 id（`task.taskId`，缺省回退
// `${wave.id}-t${i+1}`）定位；只改计划结构，不做任何 IO。

export interface WaveTaskPatch {
  title?: string;
  acceptance?: string[];
}

export interface WaveTaskRef {
  waveIndex: number;
  taskIndex: number;
}

export interface WaveTaskInput {
  title: string;
  acceptance?: string[];
}

const MAX_ACCEPTANCE_ITEMS = 20;
const MAX_ACCEPTANCE_CHARS = 500;

function wavesOf(plan: unknown): any[] | null {
  if (!plan || typeof plan !== 'object') return null;
  const waves = (plan as any).waves;
  return Array.isArray(waves) ? waves : null;
}

/** 任务的外部 id：稳定 `taskId` 优先，legacy 任务回退位置 id。 */
export function taskIdAt(wave: any, task: any, index: number): string | null {
  const explicit = typeof task?.taskId === 'string' ? task.taskId.trim() : '';
  if (explicit) return explicit;
  const waveId = typeof wave?.id === 'string' ? wave.id : '';
  return waveId ? `${waveId}-t${index + 1}` : null;
}

export function findWaveTask(plan: unknown, externalTaskId: string): WaveTaskRef | null {
  const waves = wavesOf(plan);
  if (!waves) return null;
  for (let waveIndex = 0; waveIndex < waves.length; waveIndex += 1) {
    const wave = waves[waveIndex];
    const tasks = Array.isArray(wave?.tasks) ? wave.tasks : [];
    for (let taskIndex = 0; taskIndex < tasks.length; taskIndex += 1) {
      if (taskIdAt(wave, tasks[taskIndex], taskIndex) === externalTaskId) {
        return { waveIndex, taskIndex };
      }
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

function taskTitle(task: unknown): string {
  if (typeof task === 'string') return task.trim();
  return typeof (task as any)?.title === 'string' ? String((task as any).title).trim() : '';
}

/** 一个 wave 内已显式占用的 id（只有显式 taskId 阻止补号）。 */
function explicitIds(wave: any): Set<string> {
  const used = new Set<string>();
  const tasks = Array.isArray(wave?.tasks) ? wave.tasks : [];
  for (const task of tasks) {
    const id = typeof task?.taskId === 'string' ? task.taskId.trim() : '';
    if (id) used.add(id);
  }
  return used;
}

function nextId(waveId: string, used: Set<string>, start: number): string {
  let n = Math.max(1, start);
  while (used.has(`${waveId}-t${n}`)) n += 1;
  return `${waveId}-t${n}`;
}

/**
 * 给缺 id 的任务补稳定 `taskId`（legacy 任务补成当前位置 id，因此对已有投影是无迁移）；
 * 返回新 plan 与是否发生变化。
 */
export function ensureWaveTaskIds(plan: unknown): { plan: unknown; changed: boolean } {
  const waves = wavesOf(plan);
  if (!waves) return { plan, changed: false };
  let changed = false;
  const nextWaves = waves.map((wave) => {
    const waveId = typeof wave?.id === 'string' ? wave.id : '';
    if (!waveId || !Array.isArray(wave?.tasks)) return wave;
    const used = explicitIds(wave);
    let waveChanged = false;
    const tasks = wave.tasks.map((task: any, index: number) => {
      if (typeof task?.taskId === 'string' && task.taskId.trim()) return task;
      const candidate = index + 1;
      const id = used.has(`${waveId}-t${candidate}`)
        ? nextId(waveId, used, candidate + 1)
        : `${waveId}-t${candidate}`;
      used.add(id);
      waveChanged = true;
      const base = typeof task === 'string' ? { title: task } : { ...(task ?? {}) };
      return { ...base, taskId: id };
    });
    if (!waveChanged) return wave;
    changed = true;
    return { ...wave, tasks };
  });
  return changed ? { plan: { ...(plan as object), waves: nextWaves }, changed } : { plan, changed };
}

/**
 * 返回编辑后的新 plan；任务不存在/plan 畸形返回 null。
 * - 字符串任务在写入 acceptance 时升级为对象任务；
 * - `acceptance: []` 表示清空（字段删除，不留空数组）；
 * - 其他字段（taskId 等）保留，其他任务保持引用不变。
 */
export function editWaveTask(plan: unknown, externalTaskId: string, patch: WaveTaskPatch): unknown | null {
  const waves = wavesOf(plan);
  if (!waves) return null;
  const found = findWaveTask(plan, externalTaskId);
  if (!found) return null;

  const wave = waves[found.waveIndex];
  const raw = wave.tasks[found.taskIndex];
  const baseTitle = taskTitle(raw);
  const nextTitle = typeof patch.title === 'string' ? patch.title.trim() : baseTitle;
  if (!nextTitle) return null;

  const acceptance = normalizeAcceptance(patch.acceptance);
  const previousAcceptance = Array.isArray(raw?.acceptance)
    ? raw.acceptance.map((item: unknown) => String(item)).filter((item: string) => item.trim())
    : undefined;
  const effectiveAcceptance = acceptance === undefined ? previousAcceptance : acceptance;

  const nextTask: Record<string, unknown> = typeof raw === 'string'
    ? { title: nextTitle }
    : { ...(raw ?? {}), title: nextTitle };
  if (effectiveAcceptance && effectiveAcceptance.length > 0) nextTask.acceptance = effectiveAcceptance;
  else delete nextTask.acceptance;

  const nextTasks = wave.tasks.slice();
  nextTasks[found.taskIndex] = nextTask;

  const nextWave = { ...wave, tasks: nextTasks };
  const nextWaves = waves.slice();
  nextWaves[found.waveIndex] = nextWave;

  return { ...(plan as object), waves: nextWaves };
}

/**
 * 追加任务到指定 wave（`waveId` 为空 → 最后一个 wave）。
 * 先补齐稳定 id，再发新 id；返回新 plan + 新任务 id。
 */
export function addWaveTask(
  plan: unknown,
  waveId: string | null,
  input: WaveTaskInput,
): { plan: unknown; taskId: string } | null {
  const waves = wavesOf(plan);
  if (!waves || waves.length === 0) return null;
  const title = String(input.title ?? '').trim();
  if (!title) return null;

  const ensured = ensureWaveTaskIds(plan).plan;
  const targetWaves = wavesOf(ensured)!;
  const targetIndex = waveId
    ? targetWaves.findIndex((wave) => wave?.id === waveId)
    : targetWaves.length - 1;
  if (targetIndex < 0) return null;
  const wave = targetWaves[targetIndex];
  const waveIdValue = typeof wave?.id === 'string' ? wave.id : '';
  if (!waveIdValue) return null;

  const used = explicitIds(wave);
  const maxNumeric = Array.from(used).reduce((max, id) => {
    const m = /-t(\d+)$/.exec(id);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  const taskId = nextId(waveIdValue, used, Math.max(maxNumeric + 1, (wave.tasks?.length ?? 0) + 1));

  const nextTask: Record<string, unknown> = { taskId, title };
  const acceptance = normalizeAcceptance(input.acceptance);
  if (acceptance && acceptance.length > 0) nextTask.acceptance = acceptance;

  const tasks = Array.isArray(wave?.tasks) ? wave.tasks.slice() : [];
  tasks.push(nextTask);
  const nextWave = { ...wave, tasks };
  const nextWaves = targetWaves.slice();
  nextWaves[targetIndex] = nextWave;
  return { plan: { ...(ensured as object), waves: nextWaves }, taskId };
}

/** 从计划里删掉一个任务；wave 变空也保留（不改 wave 序号）。 */
export function deleteWaveTask(
  plan: unknown,
  externalTaskId: string,
): { plan: unknown; removed: { taskId: string; waveId: string; title: string } } | null {
  const waves = wavesOf(plan);
  if (!waves) return null;
  const found = findWaveTask(plan, externalTaskId);
  if (!found) return null;
  const wave = waves[found.waveIndex];
  const raw = wave.tasks[found.taskIndex];
  const removed = {
    taskId: externalTaskId,
    waveId: String(wave?.id ?? ''),
    title: taskTitle(raw),
  };
  const tasks = wave.tasks.slice();
  tasks.splice(found.taskIndex, 1);
  const nextWave = { ...wave, tasks };
  const nextWaves = waves.slice();
  nextWaves[found.waveIndex] = nextWave;
  return { plan: { ...(plan as object), waves: nextWaves }, removed };
}
