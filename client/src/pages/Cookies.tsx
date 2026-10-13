import { Link } from "wouter";
import LegalLayout, { ContactEmail, type LegalSection } from "@/components/LegalLayout";
import { Button } from "@/components/ui/button";
import { CONSENT_KEY, UMAMI_CONFIGURED, openCookieSettings } from "@/lib/cookieConsent";

type Row = { name: string; purpose: string; lasts: string };

function StorageTable({ caption, rows }: { caption: string; rows: Row[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-brand-mist/60 text-foreground">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-semibold">Name</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">What it does</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">How long it lasts</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.name} className="align-top">
              <td className="px-4 py-2.5 font-mono text-xs text-foreground">{row.name}</td>
              <td className="px-4 py-2.5">{row.purpose}</td>
              <td className="px-4 py-2.5">{row.lasts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const COOKIES: Row[] = [
  { name: "studyscribe_session", purpose: "Keeps you signed in. Essential: the app cannot work without it.", lasts: "30 days, or until you sign out" },
  { name: "studyscribe_integration_state", purpose: "Checks that a Notion or Google (Docs or Calendar) sign-in that comes back to StudyScribe is the one you started. Essential, and only set when you connect an app.", lasts: "10 minutes" },
];

const BROWSER_STORAGE: Row[] = [
  { name: CONSENT_KEY, purpose: "Remembers whether you accepted or declined analytics.", lasts: "Until you change it or clear site data" },
  { name: "studyscribe-recorder", purpose: "Keeps a copy of a recording in progress on your device, so a crash or closed tab does not lose it (IndexedDB).", lasts: "Until the recording is uploaded or discarded" },
  { name: "studyscribe_onboarding_done", purpose: "Remembers that you have seen the welcome tour.", lasts: "Until you clear site data" },
  { name: "studyscribe_setup_checklist_hidden:*", purpose: "Remembers that you hid the Get set up list on your library.", lasts: "Until you clear site data" },
  { name: "studyscribe_calendar_prompt_hidden", purpose: "Remembers that you chose Not now for connecting Google Calendar on your library.", lasts: "Until you clear site data" },
  { name: "studyscribe_auto_notes", purpose: "Remembers whether study notes are written automatically (Settings).", lasts: "Until you change it or clear site data" },
  { name: "studyscribe_auto_notes_tried_*", purpose: "Stops the same notes being generated twice in one tab (session storage).", lasts: "Until you close the tab" },
  { name: "studyscribe_live_transcript", purpose: "Remembers whether you turned on live transcript while recording.", lasts: "Until you change it or clear site data" },
  { name: "studyscribe_caption_size", purpose: "Remembers the text size you chose for live captions.", lasts: "Until you change it or clear site data" },
  { name: "studyscribe_skip_silence", purpose: "Remembers whether the player skips silent stretches.", lasts: "Until you change it or clear site data" },
  { name: "studyscribe_kb_mode", purpose: "Remembers whether the Knowledge Base uses keyword or smart search.", lasts: "Until you change it or clear site data" },
  { name: "studyscribe_capture_slides", purpose: "Remembers whether you chose Capture slides when recording a shared tab or screen.", lasts: "Until you change it or clear site data" },
  { name: "sidebar-width", purpose: "Remembers how wide you made the app sidebar.", lasts: "Until you clear site data" },
];

const SECTIONS: LegalSection[] = [
  { heading: "Cookies", body: (<>
    <p>We set a single cookie, and only to keep you signed in. We do not use advertising, social media or cross-site tracking cookies, and no third party sets cookies through our site.</p>
    <StorageTable caption="Cookies" rows={COOKIES} />
  </>) },
  { heading: "Storage on your device", body: (<>
    <p>The app also keeps a few items in your browser's own storage. They never leave your device, except that a backed-up recording is uploaded when you save it.</p>
    <StorageTable caption="Browser storage" rows={BROWSER_STORAGE} />
    <p>If you turn on notifications, your browser also registers a small background script that shows them.</p>
  </>) },
  { heading: "Analytics", body: (<>
    <p>
      If you choose "Accept", we load Vercel Web Analytics{UMAMI_CONFIGURED ? " and Umami" : ""}. They count page visits, referring sites, and the browser, device type and country, without cookies, without storing anything on your device and without identifying you. If you choose "Decline", or your browser sends a Global Privacy Control signal, they are never loaded.
    </p>
  </>) },
  { heading: "Changing your choice", body: (<>
    <p>You can change your answer at any time. Your browser's settings also let you block or delete cookies and site data, but blocking the session cookie will stop you signing in.</p>
    <Button type="button" variant="outline" onClick={openCookieSettings}>Cookie settings</Button>
  </>) },
  { heading: "More information", body: <p>The <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link> explains how we handle personal data. Questions: <ContactEmail />.</p> },
];

export default function Cookies() {
  return (
    <LegalLayout
      title="Cookie Policy"
      intro={<p>This page lists every cookie and storage item StudyScribe AI uses, what each one is for and how long it lasts.</p>}
      sections={SECTIONS}
    />
  );
}
