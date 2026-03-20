export interface FormatOptions {
  kThreshold?: number;
  mThreshold?: number;
  costPrecisionThreshold?: number;
  timeAgoJustNow?: number;
  timeAgoMinutes?: number;
  timeAgoHours?: number;
}

export function formatTokens(n: number | null | undefined, opts?: FormatOptions): string {
  if (n == null) return "—";
  const mThreshold = opts?.mThreshold ?? 1_000_000;
  const kThreshold = opts?.kThreshold ?? 1_000;
  if (n >= mThreshold) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= kThreshold) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export function formatCost(usd: number | null | undefined, opts?: FormatOptions): string {
  if (usd == null) return "—";
  const threshold = opts?.costPrecisionThreshold ?? 0.01;
  if (usd < threshold) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

export function timeAgo(dateStr: string, opts?: FormatOptions): string {
  const justNowSec = opts?.timeAgoJustNow ?? 60;
  const minutesThreshold = opts?.timeAgoMinutes ?? 60;
  const hoursThreshold = opts?.timeAgoHours ?? 24;

  // Normalize SQLite datetime('now') format "2026-03-18 21:23:31" → ISO with Z
  const normalized = dateStr.includes("T") ? dateStr : dateStr.replace(" ", "T") + "Z";
  const diff = Date.now() - new Date(normalized).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < justNowSec) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < minutesThreshold) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < hoursThreshold) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
