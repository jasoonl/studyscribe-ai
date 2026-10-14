---
name: studyscribe-ui
description: "StudyScribe AI house rules for any UI work in this repository: pages, components, landing and legal pages, the extension, desktop and mobile apps, and the demo video. Use together with ui-ux-pro-max whenever a change affects how something looks, reads, moves or is interacted with. These rules win over generic design-system recommendations."
---

# StudyScribe UI house rules

Use `ui-ux-pro-max` for UX, accessibility, layout and stack guidance (run its search for React, shadcn and html-tailwind). StudyScribe already has a design system, so **do not adopt the palette, fonts or style the generic `--design-system` command recommends**. Apply its checklists and guidelines to the system below.

## The existing system (keep it)

- **Colour:** semantic tokens in `client/src/index.css` (`--primary`, `--accent`, `--brand-sky`, `--brand-deep`, `--brand-mist`, `--course-*`), with light and dark values. Use Tailwind token classes (`bg-primary`, `text-muted-foreground`, `bg-brand-mist`), never raw hex in components. The palette is StudyScribe blues.
- **Type:** the system font stack with Geist Variable as the fallback (SF Pro Text for body, SF Pro Display for headings). No new web fonts.
- **Components:** shadcn/ui in `client/src/components/ui`, Lucide icons. Reuse an existing component before writing a new one.
- **Routing and pages:** wouter, `React.lazy` pages in `client/src/App.tsx`. Public pages use `PublicLayout` and `SiteNav`, and policies use `LegalLayout`.

## Things that make a site look AI-generated (never ship these)

- Purple-to-blue gradients, gradient text, glassmorphism or frosted cards, glowing blobs.
- Emoji in headings, buttons or as icons. One icon per idea at most, and none as decoration.
- Buttons that fade with opacity on hover. `ui/button.tsx` uses brightness; keep it.
- Buzzwords ("revolutionize", "seamless", "unlock", "supercharge", "AI-powered" as filler) and em dashes in UI copy. Write plain, specific sentences.
- Three identical feature cards with an icon, a title and one line each, as the default layout.

## Always

- Keyboard first: visible focus, a label on every icon-only button, and `pressable()` (`client/src/lib/pressable.ts`) for click-only containers.
- Works at 375px with a 16px gutter and no horizontal scroll, and in dark mode.
- Respect `prefers-reduced-motion`.
- Show duration with `formatRecordingDuration`. Never inject analytics or tracking scripts (consent goes through `CookieBanner`). Add any new cookie or storage key to the Cookie Policy table.
- Before you finish, run the ui-ux-pro-max pre-delivery checklist against the changed screens.
