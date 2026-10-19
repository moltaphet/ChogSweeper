export type Progress = Record<string, { cursor: string; head: string; at: number }>;

export function workerHealth(progress: Progress, now = Date.now()) {
  const streams = [progress.sweeper, progress.transfers];
  const maxLagBlocks = Math.max(0, ...streams.map((p) => p ? Number(BigInt(p.head) - BigInt(p.cursor)) : 0));
  const ok = streams.every((p) => p && now - p.at <= 60_000) && maxLagBlocks <= 120;
  return { ok, progress, maxLagBlocks };
}
