import PublicLayout from "@/components/landing/PublicLayout";
import PricingSection from "@/components/landing/PricingSection";
import { Faq } from "@/components/landing/FaqAndCta";

export default function Pricing() {
  return (
    <PublicLayout>
      <PricingSection id="plans" heading="Pick the plan that fits your recording habit" />
      <Faq />
    </PublicLayout>
  );
}
