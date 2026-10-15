import { useState } from "react";
import { Link } from "wouter";
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import { Menu, X } from "lucide-react";
import { PLANS } from "@shared/plans";
import { useSignupMode } from "@/lib/signupMode";
import { formatNumber, t, useI18n } from "@/i18n";

const LOGO = "/logo.webp";

const LOWEST_PAID_PRICE = Math.min(...PLANS.filter((plan) => plan.priceMonthlyUsd > 0).map((plan) => plan.priceMonthlyUsd));

type Item = { title: string; text: string; href: string };
type Menu = { label: string; href?: string; items: Item[] };
const money = (amount: number) => formatNumber(amount, { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** A menu with `href` is also a link: hovering or focusing opens its panel, clicking goes to the page. */
function buildMenus(signupOpen: boolean, signupHref: string): Record<string, Menu> {
  return {
    product: {
      label: t("nav.product"),
      items: [
        { title: t("nav.record.title"), text: t("nav.record.text"), href: "/#how" },
        { title: t("nav.transcripts.title"), text: t("nav.transcripts.text"), href: "/#features" },
        { title: t("nav.tools.title"), text: t("nav.tools.text"), href: "/#features" },
        { title: t("nav.tutor.title"), text: t("nav.tutor.text"), href: "/#features" },
      ],
    },
    who: {
      label: t("nav.useCases"),
      items: [
        { title: t("nav.students.title"), text: t("nav.students.text"), href: "/#use-cases" },
        { title: t("nav.professionals.title"), text: t("nav.professionals.text"), href: "/#use-cases" },
        { title: t("nav.languages.title"), text: t("nav.languages.text"), href: "/#languages" },
      ],
    },
    pricing: {
      label: t("nav.pricing"),
      href: "/pricing",
      items: [
        { title: t("nav.free.title"), text: t("nav.free.text", { price: money(0) }), href: "/pricing#plans" },
        { title: t("nav.paid.title"), text: t("nav.paid.text", { price: money(LOWEST_PAID_PRICE) }), href: "/pricing#plans" },
        { title: t("nav.questions.title"), text: t("nav.questions.text"), href: "/pricing#faq" },
        { title: t("footer.refunds"), text: t("nav.refunds.text"), href: "/refunds" },
      ],
    },
    demo: {
      label: t("nav.demo"),
      href: "/demo",
      items: [
        { title: t("landing.watchDemo"), text: t("nav.watch.text"), href: "/demo" },
        { title: t("nav.covers.title"), text: t("nav.covers.text"), href: "/demo#tour" },
        { title: t("nav.how.title"), text: t("nav.how.text"), href: "/#how" },
        { title: t("nav.try.title"), text: signupOpen ? t("nav.try.open") : t("nav.try.closed"), href: signupHref },
      ],
    },
  };
}

export default function SiteNav() {
  const signup = useSignupMode();
  useI18n();
  const menus = buildMenus(signup.open, signup.href);
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const [stuck, setStuck] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  useMotionValueEvent(scrollY, "change", (v) => setStuck(v > 24));

  return (
    <header className="fixed inset-x-0 top-3 z-50 flex justify-center px-3 sm:top-4" onMouseLeave={() => setOpen(null)}>
      <motion.nav
        aria-label={t("nav.main")}
        initial={reduce ? false : { y: -24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 120, damping: 20 }}
        className={`relative w-full max-w-4xl rounded-2xl border border-border bg-background transition-shadow ${
          stuck ? "shadow-md" : "shadow-sm"
        }`}
      >
        <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
          <Link href="/" className="flex shrink-0 items-center gap-2 rounded-md pr-2">
            <img src={LOGO} alt="" className="h-7 w-7" />
            <span className="text-base font-semibold text-foreground">StudyScribe AI</span>
          </Link>

          <div className="ml-4 hidden items-center gap-1 md:flex">
            {Object.entries(menus).map(([key, menu]) => {
              const className = `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${open === key ? "bg-secondary text-primary" : "text-foreground/80 hover:text-foreground"}`;
              return menu.href ? (
                <Link
                  key={key}
                  href={menu.href}
                  aria-expanded={open === key}
                  onMouseEnter={() => setOpen(key)}
                  onFocus={() => setOpen(key)}
                  onClick={() => setOpen(null)}
                  className={className}
                >
                  {menu.label}
                </Link>
              ) : (
                <button
                  key={key}
                  type="button"
                  aria-expanded={open === key}
                  onMouseEnter={() => setOpen(key)}
                  onFocus={() => setOpen(key)}
                  onClick={() => setOpen(open === key ? null : key)}
                  className={className}
                >
                  {menu.label}
                </button>
              );
            })}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <Link href="/login" className="hidden rounded-md px-3 py-1.5 text-sm font-medium text-foreground/80 transition-colors hover:text-foreground sm:block">
              {t("common.signIn")}
            </Link>
            <Link
              href={signup.href}
              className="whitespace-nowrap rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm sm:px-4 transition-transform hover:brightness-110 active:scale-[0.98]"
            >
              {signup.label}
            </Link>
            <button
              type="button"
              aria-label={mobile ? t("nav.closeMenu") : t("nav.openMenu")}
              aria-expanded={mobile}
              onClick={() => setMobile((v) => !v)}
              className="grid h-9 w-9 place-items-center rounded-md text-foreground md:hidden"
            >
              {mobile ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {open && (
            <motion.div
              key={open}
              initial={reduce ? false : { opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 260, damping: 26 }}
              className="absolute left-0 right-0 top-[calc(100%+0.5rem)] hidden rounded-2xl border border-border bg-card p-2 shadow-lg md:block"
            >
              <ul className="grid grid-cols-2 gap-1">
                {menus[open].items.map(({ title, text, href }) => (
                  <li key={title}>
                    <a href={href} onClick={() => setOpen(null)} className="block rounded-xl px-4 py-3 transition-colors hover:bg-secondary">
                      <span className="block text-sm font-semibold text-foreground">{title}</span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">{text}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {mobile && (
            <motion.div
              initial={reduce ? false : { height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden md:hidden"
            >
              <ul className="space-y-1 px-3 pb-4 pt-1 text-sm font-medium">
                {[[t("nav.product"), "/#features"], [t("nav.useCases"), "/#use-cases"], [t("nav.pricing"), "/pricing"], [t("nav.demo"), "/demo"], [t("common.signIn"), "/login"]].map(([label, href]) => (
                  <li key={label}>
                    <a href={href} onClick={() => setMobile(false)} className="block rounded-xl px-3 py-2.5 hover:bg-secondary">
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.nav>
    </header>
  );
}
