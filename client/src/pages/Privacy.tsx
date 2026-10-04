import { Link } from "wouter";
import LegalLayout, { type LegalSection } from "@/components/LegalLayout";
import { MIN_AGE } from "@shared/legal";
import { CONTACT_EMAIL } from "@/lib/legal";

const contact = CONTACT_EMAIL ? (
  <a className="text-primary hover:underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
) : (
  <>the contact details shown on this website</>
);

const PROVIDERS: Array<[string, string]> = [
  ["Vercel", "Hosts the website and stores uploaded audio files."],
  ["TiDB Cloud (PingCAP)", "Hosts the database that holds your account, transcripts and study materials."],
  ["AssemblyAI", "Receives your audio to transcribe it and identify speakers."],
  ["An AI language-model provider", "Receives transcript text to generate notes, flashcards, quizzes, guides, drafts and tutor answers."],
  ["Resend", "Sends account emails such as password resets and invitations."],
  ["Google", "Lets you sign in with your Google account, if you choose to."],
  ["Your browser's push service", "Delivers notifications, only if you turn them on."],
];

const SECTIONS: LegalSection[] = [
  { heading: "What we collect", body: (<>
    <p><strong className="text-foreground">Account details:</strong> your email address, name, how you sign in, a securely hashed password (if you use one), and when you accepted our Terms.</p>
    <p><strong className="text-foreground">Your content:</strong> audio you record, upload or import by link, plus the transcripts, notes, flashcards, quizzes, study guides, email drafts and tutor chats created from it, and any tags or sharing choices.</p>
    <p><strong className="text-foreground">Technical data:</strong> a session cookie that keeps you signed in, and basic server logs (such as IP address and request details) that our hosting provider keeps for security and operations. If you enable notifications, your browser's push subscription.</p>
    <p>If you request access, we keep the email address you submit.</p>
  </>) },
  { heading: "How we use it", body: <p>To provide the Service: authenticate you, transcribe your audio, generate study materials, let you share recordings you choose to share, send account emails, keep the Service secure and fix problems. We do not sell your personal data, and we do not use your recordings or transcripts for advertising.</p> },
  { heading: "Who we share it with", body: (<>
    <p>We use these providers to run the Service. They process data on our behalf:</p>
    <ul className="list-disc space-y-1.5 pl-6">
      {PROVIDERS.map(([name, what]) => (<li key={name}><strong className="text-foreground">{name}:</strong> {what}</li>))}
    </ul>
    <p>We may also disclose information if the law requires it, or to protect people's safety or the Service. If you share a recording with someone, they can see it.</p>
  </>) },
  { heading: "Cookies and analytics", body: <p>We use only an essential cookie that keeps you signed in. We do not use advertising or cross-site tracking cookies. If privacy-friendly, cookie-free analytics are enabled, they count page visits without identifying you across sites. Fonts are served from our own site, not from a third party.</p> },
  { heading: "How long we keep it", body: <p>We keep your data until you delete it or delete your account. Recordings you move to Trash keep their audio until you delete them permanently. When you delete your account, we permanently delete your recordings, audio files, transcripts, study materials and account details, and ask our transcription provider to delete its copies. Encrypted backups kept by our database provider can hold residual copies until they expire in the ordinary course. We may keep limited records where the law requires.</p> },
  { heading: "Your choices and rights", body: (<>
    <p>You can see, correct and download your data, and delete your account, yourself in <Link href="/settings" className="text-primary hover:underline">Settings</Link>. "Export my data" gives you a file of everything we hold about you; "Delete my account" removes it permanently.</p>
    <p>Depending on where you live (for example the EU, UK or California), you may also have rights to access, correct, delete, restrict or object to processing of your data, to data portability, and to complain to your data protection authority. To use a right that Settings does not cover, contact {contact}.</p>
  </>) },
  { heading: "Security", body: <p>We use encrypted connections, hashed passwords, access controls and signed, expiring links. No system is perfectly secure, so we cannot promise absolute security. Use a strong, unique password.</p> },
  { heading: "Children", body: <p>The Service is not for children under {MIN_AGE}. If you believe a child under {MIN_AGE} has an account, contact us and we will delete it.</p> },
  { heading: "International transfers", body: <p>Our providers may process data in the United States and other countries. Where required, we rely on appropriate safeguards for those transfers.</p> },
  { heading: "Changes", body: <p>We may update this policy. If a change is material we will tell you by email or in the Service before it takes effect.</p> },
  { heading: "Contact", body: <p>Privacy questions or requests: {contact}.</p> },
];

export default function Privacy() {
  return (
    <LegalLayout
      title="Privacy Policy"
      intro={<p>This policy explains what StudyScribe AI collects, why, who helps us process it, and how you can control or delete it.</p>}
      sections={SECTIONS}
    />
  );
}
