/** "2h 14m", "3d 4h", "45s". Used for expiry countdowns. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** "Expires in 2h 14m" while live, "Expired 3h ago" afterwards. */
export function expiryLabel(expirySeconds: number, nowSeconds: number): string {
  const delta = expirySeconds - nowSeconds;
  return delta >= 0 ? `Expires in ${formatDuration(delta)}` : `Expired ${formatDuration(-delta)} ago`;
}

/** "just now", "5m ago", "3h ago", "2d ago". */
export function timeAgo(iso: string, nowMs: number = Date.now()): string {
  const s = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  return `${formatDuration(s)} ago`;
}
