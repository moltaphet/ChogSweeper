"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { LAUNCHPAD_PATH } from "@/lib/routes";
import { ActivitySection } from "../site/ActivitySection";
import { CollectionList } from "../site/CollectionList";

export function EcosystemSection() {
  return (
    <section id="ecosystem" aria-labelledby="ecosystem-title" className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-24">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="eyebrow">Ecosystem</p>
          <h2 id="ecosystem-title" className="h-section mt-1">Ecosystem &amp; verified collections</h2>
          <p className="mt-3 text-monad-muted">
            Collections in the verified registry carry a badge everywhere in the app. Chog holders trade with no platform fee. Anything not on the list is clearly marked as unverified, but can still be traded.
          </p>
        </div>
        <Link href={LAUNCHPAD_PATH} className="btn-primary">
          Open Launchpad <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>

      <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <h3 className="mb-3 text-sm font-bold">Verified collections</h3>
          <CollectionList />
        </div>

        <ActivitySection />
      </div>
    </section>
  );
}
