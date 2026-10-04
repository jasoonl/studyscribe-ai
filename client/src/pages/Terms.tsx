import { Link } from "wouter";
import LegalLayout, { type LegalSection } from "@/components/LegalLayout";
import { MIN_AGE } from "@shared/legal";
import { CONTACT_EMAIL } from "@/lib/legal";

const contact = CONTACT_EMAIL ? (
  <a className="text-primary hover:underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
) : (
  <>the contact details shown on this website</>
);

const SECTIONS: LegalSection[] = [
  { heading: "Agreement", body: <p>These Terms govern your use of StudyScribe AI (the "Service"). By creating an account or using the Service you agree to them and to our <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>. If you do not agree, do not use the Service.</p> },
  { heading: "Who can use the Service", body: <p>You must be at least {MIN_AGE} years old, and old enough to form a binding contract where you live, or have a parent or guardian accept these Terms for you. Accounts are currently available by invitation.</p> },
  { heading: "Your account", body: <p>Give accurate information and keep your password secret. You are responsible for activity on your account. Tell us promptly if you think someone else has accessed it.</p> },
  { heading: "Your content", body: (<><p>You keep ownership of the recordings, files, links and text you provide, and of the transcripts and study materials generated from them ("Your Content").</p><p>You give us a limited licence to store, process and display Your Content only to run the Service for you. That includes sending it to the service providers named in the Privacy Policy to transcribe audio and generate study tools. We do not use Your Content to advertise to you or sell it.</p></>) },
  { heading: "Recording other people", body: (<><p>Laws on recording conversations differ by country and state, and some require everyone's consent. <strong className="text-foreground">You are responsible for getting every consent and permission you need</strong> before you record, upload or transcribe anyone's voice, including classmates, instructors, colleagues and clients, and for following your school's or employer's rules.</p><p>Do not use the Service to record people in secret or in places where they expect privacy.</p></>) },
  { heading: "Links, files and copyright", body: (<><p>Only provide audio, video or links that you own, that are in the public domain or openly licensed, or that you otherwise have the right to copy and process. Importing a YouTube link is limited to videos their creator published under a Creative Commons licence, and you must follow that licence, including any attribution it requires. Videos that are not Creative Commons, including videos saved with YouTube Premium, cannot be imported by link; upload a file you have the right to use instead. Other websites may forbid downloading their media in their own terms, and you are responsible for complying with those terms.</p><p>We may remove content or restrict features if we believe they infringe rights or break the law.</p></>) },
  { heading: "Acceptable use", body: (<><p>Do not use the Service to break the law, infringe or violate anyone's rights, harass or harm others, upload malware, or try to disrupt or gain unauthorised access to the Service or other accounts. Do not scrape the Service, resell it, or use it to build a competing product. Do not use it to produce or process unlawful content.</p><p>We may suspend or end accounts that break these rules.</p></>) },
  { heading: "AI-generated content", body: <p>Transcripts, notes, flashcards, quizzes, study guides, summaries, drafts and tutor answers are produced by automated systems and can be wrong or incomplete. Check them against your source material. They are not professional, legal, medical or financial advice, and you should not rely on them for decisions where errors would matter. Your coursework and your use of the output remain your responsibility, including any academic integrity rules that apply to you.</p> },
  { heading: "Plans and payments", body: <p>The Service offers a Free plan. Paid plans (Basic, Pro and Max) are planned and are not yet available for purchase. When they launch, we will show the price, the recording allowance and the billing terms before you pay, and we will give notice before changing prices for existing subscribers. Each plan includes a limit on how many recordings you can make; we may enforce these limits.</p> },
  { heading: "Copyright complaints", body: <p>If you believe content on the Service infringes your copyright, send a notice to {contact} that identifies the work, identifies the material and where it is, includes your contact details and a statement that you have a good-faith belief the use is not authorised, and states under penalty of perjury that you are the owner or authorised to act for the owner. We may remove material and terminate repeat infringers' accounts.</p> },
  { heading: "Ending your account", body: <p>You can delete your account at any time in <Link href="/settings" className="text-primary hover:underline">Settings</Link>. Deleting it permanently removes your recordings, transcripts, study materials and account details, as described in the Privacy Policy. We may suspend or end your access if you break these Terms or if needed to protect the Service or other people. Sections that by their nature should continue (such as disclaimers and limits of liability) survive.</p> },
  { heading: "Disclaimers", body: <p>The Service is provided "as is" and "as available". To the fullest extent the law allows, we make no warranties, express or implied, including about accuracy, availability, fitness for a particular purpose or non-infringement. We do not promise the Service will be uninterrupted or error-free, or that stored content will never be lost, so keep your own copies of anything important.</p> },
  { heading: "Limit of liability", body: <p>To the fullest extent the law allows, we are not liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, data or goodwill. Our total liability for any claim relating to the Service is limited to the greater of the amount you paid us in the 12 months before the claim and 50 US dollars. Nothing in these Terms limits liability that cannot be limited by law, or any rights you have as a consumer that cannot be waived.</p> },
  { heading: "Your responsibility for claims", body: <p>You agree to cover losses and reasonable costs arising from a third party's claim that Your Content, or your use of the Service, infringes their rights or breaks the law, including claims about recordings you made without required consent. This does not apply where the law does not allow it.</p> },
  { heading: "Governing law and disputes", body: <p>These Terms are governed by the laws of the place where the Service's operator is established, without regard to conflict-of-law rules, and disputes will be heard in the courts there. If you are a consumer, you also keep the protection of mandatory consumer laws where you live.</p> },
  { heading: "Changes", body: <p>We may update these Terms. If a change is material we will tell you by email or in the Service before it takes effect. Using the Service after the change means you accept it.</p> },
  { heading: "Contact", body: <p>Questions about these Terms: {contact}.</p> },
];

export default function Terms() {
  return (
    <LegalLayout
      title="Terms of Service"
      intro={<p>Please read these Terms carefully. They explain what you can expect from StudyScribe AI and what we expect from you.</p>}
      sections={SECTIONS}
    />
  );
}
