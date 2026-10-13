import { Link } from "wouter";
import LegalLayout, { ContactEmail, type LegalSection } from "@/components/LegalLayout";
import { MIN_AGE, OPERATOR_NAME, REQUEST_RESPONSE_DAYS } from "@shared/legal";

const PROVIDERS: Array<[string, string]> = [
  ["Vercel", "Hosts the website and stores uploaded audio files."],
  ["TiDB Cloud (PingCAP)", "Hosts the database that holds your account, transcripts and study materials."],
  ["AssemblyAI", "Receives your audio to transcribe it and identify speakers. If you turn on live transcript, it also receives your audio as you record, for as long as the recording runs."],
  ["An AI language-model provider", "Receives transcript text to generate notes, flashcards, quizzes, guides, drafts, follow-ups and tutor answers, and the last few minutes of live transcript when you ask Study help."],
  ["An AI embeddings provider", "Receives passages of your transcripts, and the questions you ask in Ask StudyScribe, to turn them into numeric representations used for search by meaning. Only when the site has search by meaning turned on."],
  ["Resend", "Sends account emails such as password resets and, if you sign up without an invite, the link to confirm your email address. If you email meeting notes to attendees or invite people to a team, it also delivers those emails, with the recipient's address."],
  ["Recall.ai", "Only if you send a meeting note-taker: receives the meeting link, joins the call under a name that says it is recording, posts a message in the chat saying so, and records the call's audio (everyone who speaks). StudyScribe copies the audio, then asks Recall.ai to delete its copy."],
  ["WorkOS", "Only if your team uses SAML single sign-on: passes your sign-in to your school's or company's identity provider and returns your name, email and an identifier to us."],
  ["Stripe", "Processes payments for paid plans. You enter your card or other payment details on Stripe's own checkout and billing pages; they never reach our servers. Stripe tells us your plan, its status and renewal date, and a customer reference, and keeps its own payment records as the law requires. Stripe acts as an independent controller for some of that data, such as fraud prevention, under its own privacy policy."],
  ["Google", "Lets you sign in with your Google account, if you choose to. If you connect Google Docs, receives the notes or study guides you send there, and StudyScribe keeps an encrypted access token that only lets it create and see the files it made. If you connect Google Calendar, StudyScribe reads your primary calendar's events (read-only access) to show the next seven days and name recordings; events are read when needed and not stored, except the title and time of an event you ask to be reminded about."],
  ["Notion", "If you connect Notion, receives the notes or study guides you send there. StudyScribe keeps an encrypted access token for your workspace until you disconnect."],
  ["Your browser's push service", "Delivers notifications, only if you turn them on."],
  ["Vercel Web Analytics", "Counts page visits without cookies, only if you accept analytics."],
];

const SECTIONS: LegalSection[] = [
  { heading: "Who we are", body: <p>{OPERATOR_NAME} ("we", "us") runs this website and the StudyScribe AI service, and is responsible for the personal data described here. You can reach us at <ContactEmail />.</p> },
  { heading: "What we collect", body: (<>
    <p><strong className="text-foreground">Account details:</strong> your email address, name, how you sign in, a securely hashed password (if you use one), and when you accepted our Terms and confirmed you meet the minimum age.</p>
    <p><strong className="text-foreground">Your content:</strong> audio you record, upload or import by link, plus the transcripts, notes, flashcards, quizzes, study guides, follow-up suggestions, email drafts and tutor chats created from it, and any tags, marked moments or sharing choices. If you collaborate, also the comments and highlights you add, the study groups you start or join, webhook addresses you add with a log of recent deliveries, and which apps you connected. Live transcript text and Study help answers shown while you record are not stored on our servers; the transcript of a saved recording is made again from the file. Translations you ask for are stored with the item they translate, so they open again instantly.</p>
    <p><strong className="text-foreground">More of your content, if you use these features:</strong> pictures of a shared tab or screen when you choose Capture slides; for a meeting note-taker, the meeting link, its status and the call's audio; for a recording made during a calendar event or by the note-taker, the event's title, time and the names and addresses of the people invited (from your calendar), so you can offer them the notes, and a record of whom you emailed them to; API keys you create (we keep only a scrambled hash of each key, its name and when it was last used).</p>
    <p><strong className="text-foreground">Teams:</strong> the team's name, who is in it and with what role, invitations (the invited address and a scrambled code), the courses members put in its library, a verified domain, and for a paid team its Stripe subscription and number of seats.</p>
    <p><strong className="text-foreground">People who are not users:</strong> if someone emails you meeting notes or a team invitation through StudyScribe, we process your address to deliver it. If you use the link in such an email to stop StudyScribe email, we keep only a scrambled hash of your address so that no one can email you through us again.</p>
    <p><strong className="text-foreground">Plan and usage:</strong> which plan you are on, its status and renewal date as Stripe reports them, a Stripe customer reference, and a monthly count of the minutes of audio transcribed and AI generations used, which we need to apply your plan's allowance. We never receive or store card numbers.</p>
    <p><strong className="text-foreground">Technical data:</strong> a session cookie that keeps you signed in, and basic server logs (such as IP address and request details) that our hosting provider keeps for security and operations. If you enable notifications, your browser's push subscription.</p>
    <p><strong className="text-foreground">Access requests:</strong> if you request an invite, the email address you give, plus your name and reason if you choose to add them.</p>
    <p><strong className="text-foreground">Analytics, only with your consent:</strong> which pages are visited, the referring site, and the browser, device type and country, counted without cookies and without identifying you.</p>
    <p>We only ask for what we need to run the Service. You never have to give a phone number, address, school or date of birth.</p>
  </>) },
  { heading: "How we use it", body: <p>To provide the Service: authenticate you, transcribe your audio, generate study materials, apply your plan's allowance and take payment for paid plans, let you share recordings you choose to share, answer access requests, send account emails, keep the Service secure and fix problems. If you accept analytics, we use visit counts to see which pages help people. We do not sell or share your personal data for advertising, and we do not use your recordings or transcripts to advertise to you.</p> },
  { heading: "Who we share it with", body: (<>
    <p>We use these providers to run the Service. They process data on our behalf:</p>
    <ul className="list-disc space-y-1.5 pl-6">
      {PROVIDERS.map(([name, what]) => (<li key={name}><strong className="text-foreground">{name}:</strong> {what}</li>))}
    </ul>
    <p>We may also disclose information if the law requires it, or to protect people's safety or the Service. If you share a recording with someone, or with a study group, they can see it, and if you give them comment or edit access they can see the comments on it and add their own. Your name appears next to comments you write and in groups you join.</p>
    <p><strong className="text-foreground">Teams:</strong> if you join a team, its members can open the courses you put in its library, and its owner and admins see your name, email, role, when you were last active and how many minutes and AI generations you used this month. They do not see recordings you keep out of the library.</p>
    <p><strong className="text-foreground">Meeting notes you email:</strong> the people you choose receive the notes you picked, your name and your email address (for replies).</p>
    <p><strong className="text-foreground">Your API keys:</strong> anything you connect with a key can read what the key allows. Keep keys private and revoke one in Settings if it leaks.</p>
    <p><strong className="text-foreground">Webhooks you set up:</strong> if you add a webhook in Settings, we send the events you pick (including transcript text for "transcript ready" and note text for "notes written") to the address you entered. That address belongs to you or a service you chose, not to us, and its own terms apply.</p>
  </>) },
  { heading: "Cookies, browser storage and analytics", body: (<>
    <p>We use one essential cookie that keeps you signed in, plus a second essential cookie that lasts ten minutes while you connect Notion, Google Docs or Google Calendar. We do not use advertising or cross-site tracking cookies. Analytics run only after you choose "Accept" in the cookie banner, and they do not set cookies. If your browser sends a Global Privacy Control signal, we treat it as a "Decline". You can change your choice at any time with "Cookie settings" at the bottom of every public page.</p>
    <p>While you record, the audio is also saved in your browser's own storage on your device, so a crash or closed tab does not lose it. That copy is deleted when the recording is uploaded or you discard it. The app also keeps a few preferences there, such as whether you have seen the welcome tour. The <Link href="/cookies" className="text-primary hover:underline">Cookie Policy</Link> lists every cookie and storage item.</p>
  </>) },
  { heading: "How long we keep it", body: <p>We keep your data until you delete it or delete your account. Recordings you move to Trash keep their audio until you delete them permanently. Access requests are kept until you ask us to delete them, or until you delete the account you created from the invite. Webhook delivery logs are kept for 30 days. Disconnecting Notion or Google deletes the stored access token straight away. Calendar reminders are deleted a week after the event. The list of addresses that asked not to get StudyScribe email is kept as hashes for as long as we send email, since forgetting it would let email reach them again. When you delete your account, we first cancel any paid plan so you are not charged again, then permanently delete your recordings, audio files, captured slides, transcripts, translations, study materials, comments you wrote, groups you run, teams you own (after cancelling their subscription) and your membership of other teams, meeting note-takers (calling off any still on their way and deleting Recall.ai's copies), attendee lists and the record of notes you emailed, API keys, webhooks, connected apps, calendar reminders, usage records, plan details, access requests and account details, ask Stripe to delete your customer record, and ask our transcription provider to delete its copies. Stripe keeps records of past payments for as long as tax and financial law requires. Encrypted backups kept by our database provider can hold residual copies until they expire in the ordinary course. We may keep limited records where the law requires.</p> },
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
