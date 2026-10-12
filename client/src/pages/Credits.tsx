import LegalLayout, { ContactEmail, type LegalSection } from "@/components/LegalLayout";

const LIBRARIES: Array<[string, string, string]> = [
  ["Geist", "Typeface by Vercel, served from our own site", "SIL Open Font License 1.1"],
  ["Lucide", "Interface icons", "ISC License"],
  ["Hugeicons (free set)", "Interface icons", "MIT License"],
  ["Radix UI and shadcn/ui", "Accessible interface components", "MIT License"],
  ["React, Tailwind CSS and Vite", "The framework the website is built with", "MIT License"],
];

const SECTIONS: LegalSection[] = [
  { heading: "Fonts and icons", body: (
    <ul className="list-disc space-y-1.5 pl-6">
      {LIBRARIES.map(([name, what, licence]) => (<li key={name}><strong className="text-foreground">{name}:</strong> {what}. {licence}.</li>))}
    </ul>
  ) },
  { heading: "Images", body: <p>The screenshots on this website are taken from StudyScribe AI itself, using sample lectures and meetings written for the demo. The people and courses in them are fictional. The StudyScribe AI name, logo and app icons are our own.</p> },
  { heading: "Demo video", body: <p>The narration in the demo video is generated with ElevenLabs text-to-speech. The background music and sound effects were synthesised for the video, and every screen in it is a live screenshot of the app.</p> },
  { heading: "Open-source software", body: <p>StudyScribe AI is built with many open-source packages. Each one is used under its own licence, and their copyright and licence notices ship with the software. If you think we have used your work without the right credit or permission, email <ContactEmail subject="Credit or licence question" /> and we will put it right.</p> },
];

export default function Credits() {
  return (
    <LegalLayout
      title="Credits and licences"
      intro={<p>The fonts, icons, images, audio and software that StudyScribe AI uses, and the licences that allow it.</p>}
      sections={SECTIONS}
    />
  );
}
