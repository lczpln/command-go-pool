export interface UsagePoint {
  t: number;
  tokens: number;
  requests?: number;
  cost?: number;
}

export function pointIndexFromX(clientX: number, rect: { left: number; width: number }, count: number): number | null {
  if (count <= 0 || rect.width <= 0) return null;
  const i = Math.floor(((clientX - rect.left) / rect.width) * count);
  return Math.max(0, Math.min(count - 1, i));
}
