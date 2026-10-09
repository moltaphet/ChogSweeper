import type { SwapStatus } from "@/lib/types";

const STYLES: Record<SwapStatus, { label: string; cls: string; dot: string }> = {
  pending: { label: "Pending", cls: "bg-monad-tint text-monad-deep", dot: "bg-monad-primary" },
  completed: { label: "Completed", cls: "bg-status-activeBg text-status-activeInk", dot: "bg-status-active" },
  cancelled: { label: "Cancelled", cls: "bg-status-dangerBg text-status-dangerInk", dot: "bg-status-danger" },
  declined: { label: "Declined", cls: "bg-status-dangerBg text-status-dangerInk", dot: "bg-status-danger" },
  expired: { label: "Expired", cls: "bg-status-dangerBg text-status-dangerInk", dot: "bg-status-danger" },
};

export function StatusBadge({ status }: { status: SwapStatus }) {
  const s = STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />
      {s.label}
    </span>
  );
}
