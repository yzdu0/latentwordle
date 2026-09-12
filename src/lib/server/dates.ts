export function todayUtc(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function dayIndexOf(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 86_400_000);
}

export function dateOfDayIndex(dayIndex: number): string {
  return new Date(dayIndex * 86_400_000).toISOString().slice(0, 10);
}
