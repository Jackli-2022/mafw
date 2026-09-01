// P3a: explicit time anchoring.
//
// Energy decay (0.005/day) is NOT time reasoning — "what did I do last week"
// needs the query's time expression matched against entry dates. Official
// LongMemEval ablation: time-aware query handling gives temporal-type recall
// +6.8~11.3%. We deliberately SOFT-BOOST (×1.5) instead of hard-filtering:
// the paper's E.4 shows wrong hard pruning by a weak extractor *reduces*
// recall, and a boost keeps the failure mode benign.
//
// Rules cover the zh/en patterns that actually appear in user queries:
// relative days/weeks/months/years and explicit month-year references.

export interface TimeWindow {
  start: Date;
  end: Date;
}

const DAY = 86_400_000;

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function monthWindow(year: number, month0: number): TimeWindow {
  return {
    start: new Date(Date.UTC(year, month0, 1)),
    end: new Date(Date.UTC(year, month0 + 1, 1) - 1),
  };
}

const MONTHS_EN: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10,
  december: 11, dec: 11,
};

const MONTHS_ZH = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

/**
 * Detect a time window from the query (relative to `now`).
 * Returns null when no recognizable time expression is present.
 */
export function detectTimeWindow(query: string, now: Date = new Date()): TimeWindow | null {
  const q = query.toLowerCase();

  // Relative days: 昨天/昨日/yesterday
  if (/昨天|昨日|yesterday/.test(q)) {
    const start = startOfDay(new Date(now.getTime() - DAY));
    return { start, end: new Date(start.getTime() + DAY - 1) };
  }
  // 今天/今日/today
  if (/今天|今日|today/.test(q)) {
    const start = startOfDay(now);
    return { start, end: now };
  }

  // N days: 最近N天 / 过去N天 / past|last N days / N days ago
  const nDays = q.match(/(?:最近|过去|近)\s*(\d{1,3})\s*天/)
    || q.match(/(?:past|last|previous)\s+(\d{1,3})\s+days?/)
    || q.match(/(\d{1,3})\s+days?\s+ago/);
  if (nDays) {
    const n = parseInt(nDays[1], 10);
    // Anchor to start-of-day so "3 days ago" covers the whole target day.
    return { start: startOfDay(new Date(now.getTime() - n * DAY)), end: now };
  }
  //bare 上几天? skip.

  // Weeks
  if (/上周|上礼拜|last week|previous week/.test(q)) {
    const dow = (now.getUTCDay() + 6) % 7; // Monday=0
    const monday = startOfDay(new Date(startOfDay(now).getTime() - dow * DAY));
    return { start: new Date(monday.getTime() - 7 * DAY), end: new Date(monday.getTime() - 1) };
  }
  if (/本周|这一周|this week/.test(q)) {
    const dow = (now.getUTCDay() + 6) % 7; // Monday=0
    return { start: new Date(startOfDay(now).getTime() - dow * DAY), end: now };
  }
  if (/(?:最近|过去|近)\s*(\d{1,2})\s*(?:个)?(?:星期|周|礼拜)/.test(q)
    || /(?:past|last)\s+(\d{1,2})\s+weeks?/.test(q)) {
    const m = q.match(/(\d{1,2})/)!;
    const n = parseInt(m[1], 10);
    return { start: new Date(now.getTime() - n * 7 * DAY), end: now };
  }

  // Months
  if (/上个月|上月|last month|previous month/.test(q)) {
    return monthWindow(now.getUTCFullYear(), now.getUTCMonth() - 1);
  }
  if (/这个月|本月|this month/.test(q)) {
    return { start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end: now };
  }
  if (/(?:最近|过去|近)\s*(\d{1,2})\s*(?:个)?月/.test(q)
    || /(?:past|last)\s+(\d{1,2})\s+months?/.test(q)) {
    const m = q.match(/(\d{1,2})/)!;
    const n = parseInt(m[1], 10);
    return { start: new Date(now.getTime() - n * 30 * DAY), end: now };
  }

  // Bare recency: 最近 / recent — last 7 days (runs after specific N-day/week/month rules).
  if (/最近|recent/.test(q)) {
    return { start: new Date(now.getTime() - 7 * DAY), end: now };
  }

  // Years
  if (/去年|last year/.test(q)) {
    const y = now.getUTCFullYear() - 1;
    return { start: new Date(Date.UTC(y, 0, 1)), end: new Date(Date.UTC(y, 11, 31, 23, 59, 59)) };
  }
  if (/今年|this year/.test(q)) {
    return { start: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), end: now };
  }

  // Explicit month + year: "July 2023", "in July", "2023年7月", "7月", "2023-07"
  const enMy = q.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s*,?\s*(\d{4})\b/);
  if (enMy) {
    return monthWindow(parseInt(enMy[2], 10), MONTHS_EN[enMy[1]]);
  }
  const zhYm = q.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  if (zhYm) {
    return monthWindow(parseInt(zhYm[1], 10), parseInt(zhYm[2], 10) - 1);
  }
  const isoYm = q.match(/\b(\d{4})-(\d{2})\b/);
  if (isoYm) {
    const m0 = parseInt(isoYm[2], 10) - 1;
    if (m0 >= 0 && m0 <= 11) return monthWindow(parseInt(isoYm[1], 10), m0);
  }
  // Month without year ("7月的旅行", "in July") — current year; not future → previous year.
  const enM = q.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/);
  const zhM = q.match(/([一二三四五六七八九十]{1,2}|\d{1,2})\s*月/);
  if (enM || zhM) {
    let month0 = enM ? MONTHS_EN[enM[1]] : (/^\d+$/.test(zhM![1]) ? parseInt(zhM![1], 10) - 1 : MONTHS_ZH.indexOf(zhM![1]));
    if (month0 >= 0 && month0 <= 11) {
      let year = now.getUTCFullYear();
      if (new Date(Date.UTC(year, month0 + 1, 1)) > now) year -= 1;
      return monthWindow(year, month0);
    }
  }

  return null;
}

/**
 * Soft-boost entries whose created_at falls inside the window. Entries without
 * a parseable date are untouched. Mutates nothing — returns a new array.
 */
export function applyTimeBoost(
  scored: Array<{ entry: { created_at?: string }; score: number }>,
  win: TimeWindow,
  boost = 1.5,
): Array<{ entry: any; score: number }> {
  const start = win.start.getTime();
  const end = win.end.getTime();
  return scored.map(s => {
    const t = s.entry?.created_at ? new Date(s.entry.created_at).getTime() : NaN;
    if (!Number.isNaN(t) && t >= start && t <= end) {
      return { ...s, score: s.score * boost };
    }
    return s;
  });
}
