import { Link } from "wouter";
import LegalLayout, { ContactEmail, type LegalSection } from "@/components/LegalLayout";
import { MIN_AGE, OPERATOR_NAME, REQUEST_RESPONSE_DAYS } from "@shared/legal";

const PROVIDERS: Array<[string, string]> = [
  ["Vercel", "Hosts the website and stores uploaded audio files."],
  ["TiDB Cloud (PingCAP)", "Hosts the database that holds your account, transcripts and study materials."],
  ["AssemblyAI", "Receives your audio to transcribe it and identify speakers. If you turn on live transcript, it also receives your audio as you record, for as long as the recording runs."],
  ["An AI language-model provider", "Receives transcript text to generate notes, flashcards, quizzes, guides, drafts, follow-ups and tutor answers, and the last few minutes of live transcript when you ask Study help."],
  ["Resend", "Sends account emails such as password resets."],
  ["Google", "Lets you sign in with your Google account, if you choose to."],
  ["Your browser's push service", "Delivers notifications, only if you turn them on."],
  ["Vercel Web Analytics", "Counts page visits without cookies, only if you accept analytics."],
];

const SECTIONS: LegalSection[] = [
  { heading: "Who we are", body: <p>{OPERATOR_NAME} ("we", "us") runs this website and the StudyScribe AI service, and is responsible for the personal data described here. You can reach us at <ContactEmail />.</p> },
  { heading: "What we collect", body: (<>
    <p><strong className="text-foreground">Account details:</strong> your email address, name, how you sign in, a securely hashed password (if you use one), and when you accepted our Terms and confirmed you meet the minimum age.</p>
    <p><strong className="text-foreground">Your content:</strong> audio you record, upload or import by link, plus the transcripts, notes, flashcards, quizzes, study guides, follow-up suggestions, email drafts and tutor chats created from it, and any tags, marked moments or sharing choices. Live transcript text and Study help answers shown while you record are not stored on our servers; the transcript of a saved recording is made again from the file.</p>
    <p><strong className="text-foreground">Technical data:</strong> a session cookie that keeps you signed in, and basic server logs (such as IP address and request details) that our hosting provider keeps for security and operations. If you enable notifications, your browser's push subscription.</p>
    <p><strong className="text-foreground">Access requests:</strong> if you request an invite, the email address you give, plus your name and reason if you choose to add them.</p>
    <p><strong className="text-foreground">Analytics, only with your consent:</strong> which pages are visited, the referring site, and the browser, device type and country, counted without cookies and without identifying you.</p>
    <p>We only ask for what we need to run the Service. You never have to give a phone number, address, school or date of birth.</p>
  </>) },
  { heading: "How we use it", body: <p>To provide the Service: authenticate you, transcribe your audio, generate study materials, let you share recordings you choose to share, answer access requests, send account emails, keep the Service secure and fix problems. If you accept analytics, we use visit counts to see which pages help people. We do not sell or share your personal data for advertising, and we do not use your recordings or transcripts to advertise to you.</p> },
  { heading: "Who we share it with", body: (<>
    <p>We use these providers to run the Service. They process data on our behalf:</p>
    <ul className="list-disc space-y-1.5 pl-6">
      {PROVIDERS.map(([name, what]) => (<li key={name}><strong className="text-foreground">{name}:</strong> {what}</li>))}
    </ul>
    <p>We may also disclose information if the law requires it, or to protect people's safety or the Service. If you share a recording with someone, they can see it.</p>
  </>) },
  { heading: "Cookies, browser storage and analytics", body: (<>
    <p>We use one essential cookie that keeps you signed in. We do not use advertising or cross-site tracking cookies. Analytics run only after you choose "Accept" in the cookie banner, and they do not set cookies. If your browser sends a Global Privacy Control signal, we treat it as a "Decline". You can change your choice at any time with "Cookie settings" at the bottom of every public page.</p>
    <p>While you record, the audio is also saved in your browser's own storage on your device, so a crash or closed tab does not lose it. That copy is deleted when the recording is uploaded or you discard it. The app also keeps a few preferences there, such as whether you have seen the welcome tour. The <Link href="/cookies" className="text-primary hover:underline">Cookie Policy</Link> lists every cookie and storage item.</p>
  </>) },
  { heading: "How long we keep it", body: <p>We keep your data until you delete it or delete your account. Recordings you move to Trash keep their audio until you delete them permanently. Access requests are kept until you ask us to delete them, or until you delete the account you created from the invite. When you delete your account, we permanently delete your recordings, audio files, transcripts, study materials, access requests and account details, and ask our transcription provider to delete its copies. Encrypted backups kept by our database provider can hold residual copies until they expire in the ordinary course. We may keep limited records where the law requires.</p> },
  { heading: "Deleting your data", body: (<>
    <p><strong className="text-foreground">If you can sign in:</strong> open <Link href="/settings" className="text-primary hover:underline">Settings</Link> and choose "Delete my account". It takes effect immediately and cannot be undone. You can download your data first with "Export my data".</p>
    <p><strong className="text-foreground">If you can't sign in, only requested an invite, or are a parent or guardian asking about a child's account:</strong> email <ContactEmail subject="Data deletion request" /> with the subject "Data deletion request", from the email address the data is tied to if you can. We may ask you to confirm you control that address before we act. We delete the data and confirm by email within {REQUEST_RESPONSE_DAYS} days.</p>
  </>) },
  { heading: "Your choices and rights", body: (<>
    <p>You can see, correct and download your data, and delete your account, yourself in <Link href="/settings" className="text-primary hover:underline">Settings</Link>. "Export my data" gives you a file of everything we hold about you.</p>
    <p>Depending on where you live (for example the EU, UK or California), you may also have rights to access, correct, delete, restrict or object to processing of your data, to data portability, to withdraw consent, and to complain to your data protection authority. We will not treat you differently for using these rights. To use a right that Settings does not cover, contact <ContactEmail />. We answer within {REQUEST_RESPONSE_DAYS} days.</p>
  </>) },
  { heading: "Security", body: <p>We use encrypted connections, hashed passwords, access controls and signed, expiring links. No system is perfectly secure, so we cannot promise absolute security. Use a strong, unique password.</p> },
  { heading: "Children", body: <p>The Service is not for children under {MIN_AGE}, and we do not knowingly collect personal data from them. Everyone who signs up confirms they are at least {MIN_AGE}. If you are under 18, or under the age of majority where you live, you need a parent's or guardian's permission to use the Service. If you believe a child under {MIN_AGE} has given us personal data, contact <ContactEmail subject="Child account" /> and we will delete it.</p> },
  { heading: "International transfers", body: <p>Our providers may process data in the United States and other countries. Where required, we rely on appropriate safeguards for those transfers.</p> },
  { heading: "Changes", body: <p>We may update this policy. If a change is material we will tell you by email or in the Service before it takes effect.</p> },
  { heading: "Contact", body: <p>Privacy questions or requests: <ContactEmail />.</p> },
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
