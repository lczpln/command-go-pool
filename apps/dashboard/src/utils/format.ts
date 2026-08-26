export function formatTokens(n?: number): string {
  const v = n ?? 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

export function formatMoney(n?: number | null): string {
  if (n === undefined || n === null || !Number.isFinite(Number(n))) return "—";
  const value = Number(n);
  if (value === 0) return "~$0";
  const abs = Math.abs(value);
  let digits = abs >= 0.01 ? 2 : abs >= 0.0001 ? 4 : 6;
  let text = value.toFixed(digits);
  while (Number(text) === 0 && digits < 8) {
    digits += 1;
    text = value.toFixed(digits);
  }
  if (digits > 2) text = text.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return `~$${text}`;
}

export function formatHour(t: number): string {
  return new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
