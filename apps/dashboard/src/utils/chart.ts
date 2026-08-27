export interface UsagePoint {
  t: number;
  tokens: number;
  requests?: number;
  cost?: number;
  input?: number;
  cache?: number;
  output?: number;
}

export const TOKEN_LAYERS = [
  { key: "cache" as const, label: "Cache", bar: "bg-mist/15", swatch: "bg-mist/40" },
  { key: "input" as const, label: "Input", bar: "bg-amber", swatch: "bg-amber" },
  { key: "output" as const, label: "Output", bar: "bg-info", swatch: "bg-info" },
] as const;

export function pointTotal(point: UsagePoint): number {
  const stacked = (point.cache ?? 0) + (point.input ?? 0) + (point.output ?? 0);
  return stacked > 0 ? stacked : point.tokens;
}

export function hasBreakdown(point: UsagePoint): boolean {
  return (point.cache ?? 0) + (point.input ?? 0) + (point.output ?? 0) > 0;
}

export function pointIndexFromX(clientX: number, rect: { left: number; width: number }, count: number): number | null {
  if (count <= 0 || rect.width <= 0) return null;
  const i = Math.floor(((clientX - rect.left) / rect.width) * count);
  return Math.max(0, Math.min(count - 1, i));
}
