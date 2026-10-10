import { ChogCard } from "./ChogCard";

const ROW_A = [7, 21, 42, 88, 3, 19, 64, 105, 12, 77, 31, 58];
const ROW_B = [55, 9, 120, 26, 71, 4, 93, 38, 14, 67, 49, 101];

/** One endless row; the list is doubled so the -50% translate loops without a jump. */
function Row({ ids, reverse }: { ids: number[]; reverse?: boolean }) {
  return (
    <div className="flex w-max gap-4 hover:[animation-play-state:paused]" style={{ animation: `${reverse ? "marquee-rev 70s" : "marquee 60s"} linear infinite` }}>
      {[...ids, ...ids].map((id, i) => (
        <ChogCard key={`${id}-${i}`} id={id} compact className="w-[148px] shrink-0 !shadow-[0_18px_40px_-20px_rgba(94,67,243,0.55)] sm:w-[172px]" />
      ))}
    </div>
  );
}

/** Two counter-scrolling rows of Chogs under the hero: the collection as a living wall. Decorative, hidden from assistive tech. */
export function ChogWall() {
  return (
    <section aria-hidden className="relative -mt-6 overflow-hidden pb-20 [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
      <div className="space-y-4 py-4">
        <Row ids={ROW_A} />
        <Row ids={ROW_B} reverse />
      </div>
    </section>
  );
}
