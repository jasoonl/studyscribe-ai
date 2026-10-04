import SiteNav from "@/components/landing/SiteNav";
import SiteFooter from "@/components/landing/SiteFooter";
import Hero from "@/components/landing/Hero";
import HowItWorks from "@/components/landing/HowItWorks";
import FeatureBento from "@/components/landing/FeatureBento";
import UseCases from "@/components/landing/UseCases";
import Languages from "@/components/landing/Languages";
import PricingSection from "@/components/landing/PricingSection";
import { Faq, FinalCta } from "@/components/landing/FaqAndCta";

/** Public marketing page for signed-out visitors. */
export default function Landing() {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <SiteNav />
      <main>
        <Hero />
        <HowItWorks />
        <FeatureBento />
        <UseCases />
        <Languages />
        <PricingSection />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}
