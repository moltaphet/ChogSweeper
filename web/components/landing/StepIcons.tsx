/**
 * Custom duotone icons for the three steps. A violet stroke carries the shape, a soft lavender fill gives it weight, and a single
 * gold accent marks MON wherever it appears.
 */
const base = { viewBox: "0 0 56 56", fill: "none", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

/** Assemble your bundle: a fan of three NFT cards with a gold MON coin tucked in front. */
export function BundleIcon({ className = "h-14 w-14" }: { className?: string }) {
  return (
    <svg {...base} className={className}>
      <rect x="9" y="12" width="22" height="30" rx="5" transform="rotate(-12 20 27)" fill="#E9E4FE" stroke="#836EF9" strokeWidth="2" />
      <rect x="17" y="10" width="22" height="30" rx="5" fill="#F4F1FF" stroke="#5E43F3" strokeWidth="2" />
      <circle cx="28" cy="21" r="4.2" fill="#836EF9" />
      <path d="M22 33c2.2-2.6 9.8-2.6 12 0" stroke="#5E43F3" strokeWidth="2" />
      <rect x="27" y="14" width="22" height="30" rx="5" transform="rotate(10 38 29)" fill="#fff" stroke="#836EF9" strokeWidth="2" />
      <circle cx="40" cy="42" r="8.5" fill="#F5B544" stroke="#fff" strokeWidth="2" />
      <path d="M36.6 45.2v-6.4l3.4 4 3.4-4v6.4" stroke="#8A5A00" strokeWidth="1.8" />
    </svg>
  );
}

/** Define your wants: a crosshair locked onto a wallet/person, with a small token tag. */
export function TargetIcon({ className = "h-14 w-14" }: { className?: string }) {
  return (
    <svg {...base} className={className}>
      <circle cx="28" cy="28" r="19" fill="#F4F1FF" stroke="#836EF9" strokeWidth="2" />
      <circle cx="28" cy="28" r="11" stroke="#C4B8FD" strokeWidth="2" strokeDasharray="3 4" />
      <path d="M28 5v9M28 42v9M5 28h9M42 28h9" stroke="#5E43F3" strokeWidth="2.4" />
      <circle cx="28" cy="25" r="4.2" fill="#836EF9" />
      <path d="M20.5 36c1.6-4.4 13.4-4.4 15 0" stroke="#5E43F3" strokeWidth="2.4" />
      <rect x="36" y="9" width="14" height="10" rx="3" fill="#fff" stroke="#836EF9" strokeWidth="1.8" />
      <path d="M39 14h8" stroke="#836EF9" strokeWidth="1.8" />
    </svg>
  );
}

/** Atomic execution: two arrows crossing inside one ring, sealed with a check. */
export function AtomicIcon({ className = "h-14 w-14" }: { className?: string }) {
  return (
    <svg {...base} className={className}>
      <circle cx="28" cy="28" r="21" fill="#F4F1FF" stroke="#836EF9" strokeWidth="2" />
      <path d="M14 22h22m0 0-5-5m5 5-5 5" stroke="#5E43F3" strokeWidth="2.6" />
      <path d="M42 34H20m0 0 5-5m-5 5 5 5" stroke="#836EF9" strokeWidth="2.6" />
      <circle cx="43" cy="43" r="9" fill="#10B981" stroke="#fff" strokeWidth="2" />
      <path d="m39 43 3 3 5.4-5.8" stroke="#fff" strokeWidth="2.2" />
    </svg>
  );
}
