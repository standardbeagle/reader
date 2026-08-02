const MIN = 15;
const MAX = 24 * 60;

export function adaptInterval(current: number, hadNewItems: boolean): number {
  const next = hadNewItems ? Math.floor(current / 2) : current * 2;
  return Math.min(MAX, Math.max(MIN, next));
}

export function backoffMinutes(errorCount: number): number {
  return Math.min(MAX, 2 ** errorCount);
}
