import { useState } from "react";
import { Link } from "wouter";
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import { BookOpen, Brain, FileText, GraduationCap, Briefcase, Menu, MessageSquare, Mic, X } from "lucide-react";

const LOGO = "https://d2xsxph8kpxj0f.cloudfront.net/310519663693064768/ASvCfiALmBkqdhfm8YoYdn/studyscribe-logo-YqjarSv2s9a5LtpKjX9CE5.webp";

type Item = { icon: typeof Mic; title: string; text: string; href: string };
const MENUS: Record<string, { label: string; items: Item[] }> = {
  product: {
    label: "Product",
    items: [
      { icon: Mic, title: "Record or upload", text: "Live, from a file, or a link.", href: "/#how" },
      { icon: FileText, title: "Transcripts", text: "Speaker labels and timestamps.", href: "/#features" },
      { icon: Brain, title: "Study tools", text: "Flashcards, quizzes and guides.", href: "/#features" },
      { icon: MessageSquare, title: "AI tutor", text: "Ask about your own lecture.", href: "/#features" },
    ],
  },
  who: {
    label: "Use cases",
    items: [
      { icon: GraduationCap, title: "Students", text: "From lecture to exam prep.", href: "/#use-cases" },
      { icon: Briefcase, title: "Professionals", text: "Meetings to action items.", href: "/#use-cases" },
      { icon: BookOpen, title: "Languages", text: "Transcribe in many languages.", href: "/#languages" },
    ],
  },
};

export default function SiteNav() {
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const [stuck, setStuck] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  useMotionValueEvent(scrollY, "change", (v) => setStuck(v > 24));

  return (
    <header className="fixed inset-x-0 top-3 z-50 flex justify-center px-3 sm:top-4" onMouseLeave={() => setOpen(null)}>
      <motion.nav
        aria-label="Main"
        initial={reduce ? false : { y: -24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 120, damping: 20 }}
        className={`relative w-full max-w-4xl rounded-[1.75rem] border border-white/50 bg-background/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] backdrop-blur-xl transition-shadow dark:border-white/10 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] ${
          stuck ? "shadow-lg shadow-primary/10" : ""
        }`}
      >
        <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
          <Link href="/" className="flex shrink-0 items-center gap-2 rounded-full pr-2">
            <img src={LOGO} alt="" className="h-7 w-7" />
            <span className="bg-gradient-to-r from-primary to-brand-sky bg-clip-text text-base font-semibold text-transparent">StudyScribe AI</span>
          </Link>

          <div className="ml-4 hidden items-center gap-1 md:flex">
            {Object.entries(MENUS).map(([key, menu]) => (
              <button
                key={key}
                type="button"
                aria-expanded={open === key}
                onMouseEnter={() => setOpen(key)}
                onFocus={() => setOpen(key)}
                onClick={() => setOpen(open === key ? null : key)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${open === key ? "bg-secondary text-primary" : "text-foreground/80 hover:text-foreground"}`}
              >
                {menu.label}
              </button>
            ))}
            <Link href="/pricing" onMouseEnter={() => setOpen(null)} className="rounded-full px-3 py-1.5 text-sm font-medium text-foreground/80 transition-colors hover:text-foreground">
              Pricing
            </Link>
            <Link href="/demo" onMouseEnter={() => setOpen(null)} className="rounded-full px-3 py-1.5 text-sm font-medium text-foreground/80 transition-colors hover:text-foreground">
              Demo
            </Link>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <Link href="/login" className="hidden rounded-full px-3 py-1.5 text-sm font-medium text-foreground/80 transition-colors hover:text-foreground sm:block">
              Sign in
            </Link>
            <Link
              href="/request-access"
              className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-transform hover:-translate-y-px active:scale-[0.98]"
            >
              Get started
            </Link>
            <button
              type="button"
              aria-label={mobile ? "Close menu" : "Open menu"}
              aria-expanded={mobile}
              onClick={() => setMobile((v) => !v)}
              className="grid h-9 w-9 place-items-center rounded-full text-foreground md:hidden"
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
              className="absolute left-0 right-0 top-[calc(100%+0.5rem)] hidden rounded-3xl border border-white/50 bg-background/85 p-3 shadow-xl shadow-primary/10 backdrop-blur-xl dark:border-white/10 md:block"
            >
              <ul className="grid grid-cols-2 gap-1">
                {MENUS[open].items.map(({ icon: Icon, title, text, href }) => (
                  <li key={title}>
                    <a href={href} onClick={() => setOpen(null)} className="flex items-start gap-3 rounded-2xl p-3 transition-colors hover:bg-secondary">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                        <Icon className="h-4.5 w-4.5" />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold">{title}</span>
                        <span className="block text-sm text-muted-foreground">{text}</span>
                      </span>
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
                {[["Product", "/#features"], ["Use cases", "/#use-cases"], ["Pricing", "/pricing"], ["Demo", "/demo"], ["Sign in", "/login"]].map(([label, href]) => (
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
