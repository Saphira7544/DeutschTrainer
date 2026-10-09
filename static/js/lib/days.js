// Local-calendar day keys ("2026-10-10") and the streak calculation.

export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * Streak = consecutive days on which the XP goal was reached.
 * Today only counts once it's reached; until then the streak runs through yesterday
 * (so it doesn't look broken first thing in the morning).
 * @param {Record<string, number>} xpByDay  day key -> XP earned
 */
export function computeStreak(xpByDay, goal, today = new Date()) {
  const met = (d) => (xpByDay[dayKey(d)] ?? 0) >= goal;
  const todayDone = met(today);
  let streak = 0;
  let d = todayDone ? today : addDays(today, -1);
  while (met(d)) {
    streak++;
    d = addDays(d, -1);
  }
  return { streak, todayDone };
}
