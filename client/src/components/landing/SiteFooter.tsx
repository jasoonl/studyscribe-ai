import { Link } from "wouter";
import { CONTACT_EMAIL, OPERATOR_NAME } from "@shared/legal";
import { openCookieSettings } from "@/lib/cookieConsent";
import { useSignupMode } from "@/lib/signupMode";
import { LanguagePicker } from "@/components/LanguagePicker";
import { Trans, t, useI18n } from "@/i18n";

function buildColumns() {
  return [
    { id: "product", title: t("nav.product"), links: [[t("footer.features"), "/#features"], [t("nav.how.title"), "/#how"], [t("nav.pricing"), "/pricing"], [t("nav.demo"), "/demo"], ["API", "/developers"]] },
    { id: "account", title: t("footer.account"), links: [[t("common.signIn"), "/login"], ["__signup__", "/request-access"], [t("common.settings"), "/settings"]] },
    // The legal pages themselves stay in English; only their link labels are translated.
    { id: "legal", title: t("footer.legal"), links: [[t("footer.terms"), "/terms"], [t("common.privacyPolicy"), "/privacy"], [t("cookies.policy"), "/cookies"], [t("footer.refunds"), "/refunds"], [t("footer.credits"), "/credits"]] },
  ];
}

export default function SiteFooter() {
  const signup = useSignupMode();
  useI18n();
  const columns = buildColumns().map((column) => ({
    ...column,
    links: column.links.map(([label, href]) => (label === "__signup__" ? [signup.label, signup.href] : [label, href])),
  }));
  return (
    <footer className="border-t border-border bg-brand-mist/60">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="max-w-xs space-y-3">
          <p className="text-xl font-bold text-primary">StudyScribe AI</p>
          <p className="text-sm text-muted-foreground">{t("footer.tagline")}</p>
          <p className="text-sm text-muted-foreground">{t("footer.data")}</p>
        </div>
        {columns.map((column) => (
          <nav key={column.id} aria-label={column.title} className="space-y-3">
            <p className="text-sm font-semibold">{column.title}</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {column.links.map(([label, href]) => (
                <li key={label}>
                  {href.includes("#") ? (
                    <a href={href} className="inline-block py-1 transition-colors hover:text-primary">{label}</a>
                  ) : (
                    <Link href={href} className="inline-block py-1 transition-colors hover:text-primary">{label}</Link>
                  )}
                </li>
              ))}
              {column.id === "legal" && (
                <li>
                  <button type="button" onClick={openCookieSettings} className="py-1 transition-colors hover:text-primary">{t("footer.cookieSettings")}</button>
                </li>
              )}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-5 text-sm text-muted-foreground sm:flex-row sm:justify-between sm:px-6">
          <p>{t("footer.rights", { operator: OPERATOR_NAME })}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
            <p>
              <Trans k="footer.contact" vars={{ email: CONTACT_EMAIL }} parts={{ mail: (text) => <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-primary">{text}</a> }} />
            </p>
            <LanguagePicker id="footer-language" />
          </div>
        </div>
      </div>
    </footer>
  );
}
