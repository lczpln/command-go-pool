export function formatTokens(n?: number): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "0";
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs < 1000) return `${sign}${Math.round(abs)}`;

  const suffixes = ["", "k", "M", "B"] as const;
  let exp = Math.min(3, Math.floor(Math.log10(abs) / 3));
  let scaled = abs / 1000 ** exp;
  let text = scaled.toFixed(2);
  if (Number(text) >= 1000 && exp < 3) {
    exp += 1;
    text = (Number(text) / 1000).toFixed(2);
  }
  text = text.replace(/\.?0+$/, "");
  return `${sign}${text}${suffixes[exp]}`;
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
