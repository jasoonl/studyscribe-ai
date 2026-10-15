import PublicLayout from "@/components/landing/PublicLayout";
import PricingSection from "@/components/landing/PricingSection";
import { Faq } from "@/components/landing/FaqAndCta";
import { useI18n } from "@/i18n";

export default function Pricing() {
  const { t } = useI18n();
  return (
    <PublicLayout>
      <PricingSection id="plans" heading={t("pricing.pageHeading")} headingLevel="h1" />
      <Faq />
    </PublicLayout>
  );
}
