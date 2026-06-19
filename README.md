# ScribeSync AI — Marketing Website

## Overview

This is a modern, conversion-focused marketing website for **ScribeSync AI**, an intelligent meeting and lecture transcription platform that combines real-time transcription with advanced AI to transform passive listening into active learning and actionable insights.

## Design Philosophy: Kinetic Energy

The website embodies a **Kinetic Energy** design system that emphasizes transformation, momentum, and forward motion. Every visual element suggests change—from raw input to refined insight.

### Key Design Principles

1. **Transformation as Hero**: Visuals convey the journey from confusion to clarity
2. **Purposeful Motion**: Animations guide attention and reinforce intelligence
3. **Gradient Language**: Indigo → Cyan gradient represents the spectrum of learning
4. **Organic Geometry**: Curved dividers and flowing layouts replace rigid rectangles

### Color Palette

- **Primary (Indigo)**: `oklch(0.45 0.3 260)` — Intelligence, depth, trust
- **Accent (Cyan)**: `oklch(0.65 0.2 195)` — Energy, clarity, transformation
- **Warm Amber**: `oklch(0.65 0.15 50)` — Human warmth in tech (CTAs)
- **Off-white**: `oklch(0.98 0.001 0)` — Clean backgrounds
- **Charcoal**: `oklch(0.15 0.02 265)` — Text contrast

### Typography

- **Headlines**: Geist (bold, geometric) — Modern, precise
- **Body**: Inter (clean, readable) — Legible, professional
- **Hierarchy**: H1 48-56px, H2 32-40px, H3 24-28px, Body 16px

## Project Structure

```
client/
├── src/
│   ├── pages/
│   │   ├── Home.tsx          ← Main landing page with audience toggle
│   │   └── NotFound.tsx
│   ├── components/
│   │   └── ui/               ← shadcn/ui components
│   ├── App.tsx               ← Router & theme setup
│   ├── index.css             ← Global styles, animations, brand colors
│   └── main.tsx
├── index.html                ← Meta tags, fonts, favicon
└── public/
```

## Key Features

### 1. Audience Toggle
The header includes a toggle between **For Students** and **For Professionals**, dynamically updating:
- Headline and subheading
- Hero image
- Pain points and solutions
- Pricing tier and features
- CTA messaging

### 2. Three-Phase Feature Breakdown
Each phase is visually distinct with custom illustrations:
- **Phase 1: Capture** — Record everything, perfectly
- **Phase 2: Comprehend** — Turn chaos into clarity
- **Phase 3: Apply** — Study smarter / Execute faster

### 3. Responsive Design
- Mobile-first approach
- Tailwind CSS utilities for responsive breakpoints
- Full-width sections with asymmetric layouts
- Touch-friendly buttons and CTAs

### 4. Visual Assets
All hero images and feature illustrations are custom-generated and hosted on CDN:
- `hero-student.png` — Student audience hero
- `hero-professional.png` — Professional audience hero
- `feature-capture.png` — Capture phase visualization
- `feature-comprehend.png` — Comprehend phase visualization
- `feature-apply.png` — Apply phase visualization
- `scribesyncs-logo.png` — Brand logo mark

### 5. Animations
Custom animations enhance the kinetic energy theme:
- `fadeInUp` — Content enters from below
- `fadeInScale` — Elements scale in smoothly
- `slideInRight` — Text slides in from left
- `gradientShift` — Subtle gradient animation
- Button press effects with scale transformation

## Content Structure

### Hero Section
- Compelling headline with gradient text
- Benefit-driven description
- Dual CTAs: Primary action + secondary action
- Social proof (user count)

### Pain Points Section
Three audience-specific pain points with visual cards:
- **Students**: Information overload, note-taking stress, exam anxiety
- **Professionals**: Time wasted on admin, lost context, misaligned teams

### Three-Phase Features
Alternating layout (text left/right) with:
- Phase badge
- Descriptive heading
- Benefit-driven copy
- Feature checklist
- Custom illustration

### Pricing Section
Two-tier pricing model:
- **Basic (Free)**: Limited hours, basic features
- **Pro**: Unlimited hours, AI tutor, advanced features
- Campus Plan callout for students

### Trust & Security Section
Three pillars:
- End-to-End Encryption
- Consent Management
- Hallucination Guardrails

### CTA Section
Full-width gradient background with:
- Compelling headline
- Benefit-driven copy
- Dual CTAs

### Footer
Multi-column layout with:
- Brand info
- Product links
- Company links
- Legal links

## Customization Guide

### Updating Content
Edit `/client/src/pages/Home.tsx`:
- `studentContent` object: Student-specific messaging
- `professionalContent` object: Professional-specific messaging
- Modify pain points, solutions, pricing, etc.

### Changing Colors
Edit `/client/src/index.css`:
- Update CSS variables in `:root` section
- Maintain contrast ratios for accessibility
- Test against both light and dark backgrounds

### Adding Animations
Add new keyframes to `index.css`:
```css
@keyframes customAnimation {
  from { /* start state */ }
  to { /* end state */ }
}

@layer components {
  .animate-custom {
    animation: customAnimation 0.6s cubic-bezier(0.23, 1, 0.32, 1) forwards;
  }
}
```

### Updating Images
Replace image URLs in `Home.tsx`:
- Update `heroImage` URLs for hero sections
- Update feature illustration URLs in the three-phase section
- All images should be hosted on CDN (not local)

## Responsive Breakpoints

- **Mobile**: < 640px
- **Tablet**: 640px - 1024px
- **Desktop**: > 1024px

Key responsive changes:
- Hero section: Single column on mobile, two columns on desktop
- Feature sections: Stacked on mobile, alternating on desktop
- Pricing cards: Full width on mobile, side-by-side on desktop

## Performance Considerations

1. **Image Optimization**: All images are compressed WebP format
2. **Font Loading**: Google Fonts with preconnect for faster loading
3. **CSS**: Tailwind 4 with minimal custom CSS
4. **React**: Functional components with hooks, no unnecessary re-renders

## Accessibility

- Semantic HTML structure
- Color contrast ratios meet WCAG AA standards
- Focus rings visible on interactive elements
- Alt text on all images
- Keyboard navigation support

## Go-to-Market Integration

The website supports the go-to-market strategy outlined in the brief:

1. **Campus Ambassadors**: Dedicated callout for campus plan
2. **TikTok/Shorts Marketing**: Hero images showcase the transformation moment
3. **High-Volume Majors**: Student-specific features highlight pre-med, law, history value
4. **Academic Integrity**: Trust & Security section emphasizes accessibility positioning

## Future Enhancements

- [ ] Blog section with case studies
- [ ] Testimonials carousel with real user quotes
- [ ] Interactive product demo
- [ ] Waitlist form integration
- [ ] Analytics tracking (Umami)
- [ ] Dark mode toggle
- [ ] Multi-language support
- [ ] Integration showcase (Notion, Quizlet, Slack, etc.)

## Development Workflow

1. **Install dependencies**: `pnpm install`
2. **Start dev server**: `pnpm dev`
3. **Build for production**: `pnpm build`
4. **Preview production build**: `pnpm preview`

## Deployment

The website is deployed on Manus with automatic hosting. No additional configuration needed.

## Support & Feedback

For questions about the design or implementation, refer to the `ideas.md` file for the complete design philosophy and reasoning.
