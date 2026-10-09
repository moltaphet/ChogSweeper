import { ExternalLink } from "lucide-react";
import Link from "next/link";
import type { NavItem, NavKey } from "@/lib/site";

interface Props {
  items: readonly NavItem[];
  /** The item that matches the current page/section. */
  active: NavKey | null;
  /** Unread incoming requests, shown on the item flagged `badge`. */
  unread: number;
  onNavigate?: () => void;
  /** Stacked large rows for the mobile menu. */
  variant?: "bar" | "stack";
}

/** Presentational nav (no data hooks) so it can be rendered and previewed anywhere. Internal links are real <Link>s. */
export function NavLinks({ items, active, unread, onNavigate, variant = "bar" }: Props) {
  return (
    <ul className={variant === "bar" ? "flex items-center gap-1" : "space-y-1"}>
      {items.map((item) => {
        const isActive = active === item.key;
        const badge = item.badge && unread > 0;
        const cls = `flex items-center gap-2 whitespace-nowrap font-semibold transition duration-200 ${
          variant === "bar" ? "rounded-full px-3.5 py-2 text-sm" : "rounded-xl px-3 py-3 text-base"
        } ${isActive ? "bg-monad-tint text-monad-deep shadow-[inset_0_0_0_1px_rgba(131,110,249,0.25)]" : "text-monad-muted hover:bg-monad-tint/80 hover:text-monad-deep"}`;
        const content = (
          <>
            {item.label}
            {item.external && <ExternalLink className="h-3.5 w-3.5 opacity-60" aria-hidden />}
            {badge && (
              <span className="min-w-[1.25rem] rounded-full bg-violet px-1.5 py-0.5 text-center text-[11px] font-bold leading-none text-white shadow-[0_4px_10px_-4px_rgba(94,67,243,0.8)]" aria-label={`${unread} unread incoming requests`}>
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </>
        );
        return (
          <li key={item.key}>
            {item.external ? (
              <a href={item.href} target="_blank" rel="noreferrer" title={item.title} className={cls} onClick={onNavigate}>{content}</a>
            ) : (
              <Link href={item.href} aria-current={isActive ? "page" : undefined} title={item.title} className={cls} onClick={onNavigate}>{content}</Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
