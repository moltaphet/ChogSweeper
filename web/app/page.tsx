import { EcosystemSection } from "@/components/landing/EcosystemSection";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { WhySection } from "@/components/landing/WhySection";
import { Footer } from "@/components/site/Footer";

/** The landing page: explains the product and sends people to /swap. The trading UI is deliberately not on this page. */
export default function Home() {
  return (
    <>
      <div className="bg-dots pointer-events-none absolute inset-x-0 top-0 -z-10 h-[780px]" aria-hidden />
      <main id="main">
        <Hero />
        <WhySection />
        <HowItWorks />
        <EcosystemSection />
      </main>
      <Footer />
    </>
  );
}
