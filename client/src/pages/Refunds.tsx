import { Link } from "wouter";
import LegalLayout, { ContactEmail, type LegalSection } from "@/components/LegalLayout";

const SECTIONS: LegalSection[] = [
  { heading: "The Free plan", body: <p>The Free plan costs nothing and never asks for payment details, so there is nothing to refund. This policy covers paid plans, and we will not change it for a charge after it has been made.</p> },
  { heading: "Subscriptions and cancelling", body: <p>Paid plans renew every month until you cancel. You can cancel at any time: open Billing in the app and choose "Cancel plan", which is one step, or email <ContactEmail subject="Cancel my subscription" />. Cancelling stops the next renewal, and you keep your plan until the end of the period you have already paid for. You will not be charged after you cancel. Deleting your account cancels the plan straight away.</p> },
  { heading: "When we refund in full", body: (<>
    <p>Ask within 14 days of the charge and we will refund it in full if:</p>
    <ul className="list-disc space-y-1.5 pl-6">
      <li>you were charged by mistake or more than once for the same period;</li>
      <li>you were charged for a renewal you had already tried to cancel; or</li>
      <li>a fault on our side stopped you using the Service for most of the period and we could not fix it.</li>
    </ul>
    <p>Otherwise we do not refund partial months, but cancelling always stops future charges.</p>
  </>) },
  { heading: "EU and UK customers", body: <p>If you live in the EU or UK, you can withdraw from a new subscription within 14 days of buying it, without giving a reason, and get your money back. If you ask us to start the Service during those 14 days and then withdraw, we may keep an amount in proportion to what you used before you told us.</p> },
  { heading: "How to ask for a refund", body: <p>Email <ContactEmail subject="Refund request" /> with the subject "Refund request", from the email address on your account, with the date and amount of the charge. We reply within 5 business days. Approved refunds go back to the original payment method; your bank may take 5 to 10 business days to show them.</p> },
  { heading: "Your legal rights", body: <p>This policy does not limit any rights you have under consumer law where you live. The <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link> cover plans and payments in general.</p> },
];

export default function Refunds() {
  return (
    <LegalLayout
      title="Refund Policy"
      intro={<p>How cancelling and refunds work for StudyScribe AI plans.</p>}
      sections={SECTIONS}
    />
  );
}
