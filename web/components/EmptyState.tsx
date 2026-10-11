import type { LucideIcon } from "lucide-react";

interface Action {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
}

interface Props {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: Action;
  secondary?: Action;
  /** Smaller illustration for tight spaces. */
  compact?: boolean;
}

/**
 * An empty box is an invitation: an icon tile, one sentence saying what belongs here,
 * and the next step as a button.
 */
export function EmptyState({ icon: Icon, title, body, action, secondary, compact }: Props) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-2xl border border-monad-border bg-gradient-to-b from-monad-tint/50 to-white px-6 text-center ${compact ? "py-7" : "py-10"}`}>
      <div className={`relative mb-4 ${compact ? "h-16 w-20" : "h-20 w-24"}`} aria-hidden>
        <span className="absolute inset-x-3 inset-y-0 flex items-center justify-center rounded-2xl border border-monad-border bg-white shadow-card">
          <Icon className="h-7 w-7 text-monad-primary" strokeWidth={1.75} />
        </span>
      </div>
      <h3 className="font-display text-base font-bold text-monad-ink">{title}</h3>
      <p className="mt-1 max-w-[17rem] text-sm text-monad-muted">{body}</p>
      {(action || secondary) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action && (
            <button type="button" onClick={action.onClick} className="btn-primary !px-4 !py-2">
              {action.icon && <action.icon className="h-4 w-4" aria-hidden />} {action.label}
            </button>
          )}
          {secondary && (
            <button type="button" onClick={secondary.onClick} className="btn-ghost">
              {secondary.icon && <secondary.icon className="h-4 w-4" aria-hidden />} {secondary.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
