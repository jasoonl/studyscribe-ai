import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { NOTE_TEMPLATES } from "@shared/noteTemplates";
import { Check, Copy } from "lucide-react";
import PublicLayout from "@/components/landing/PublicLayout";
import { Button } from "@/components/ui/button";
import { ContactEmail } from "@/components/LegalLayout";

const BASE = typeof window !== "undefined" ? `${window.location.origin}/api/v1` : "https://studyscribe.example/api/v1";

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre tabIndex={0} aria-label={label} className="overflow-x-auto rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring border border-border bg-muted/60 p-4 pr-12 text-[13px] leading-relaxed text-foreground">
        <code>{code}</code>
      </pre>
      <Button
        size="icon"
        variant="ghost"
        className="absolute right-2 top-2 h-8 w-8"
        aria-label={`Copy ${label}`}
        onClick={() => {
          void navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

function Endpoint({ method, path, scope, children }: { method: "GET" | "POST"; path: string; scope: "read" | "write"; children: ReactNode }) {
  return (
    <div className="space-y-3 border-t border-border pt-6 first:border-t-0 first:pt-0">
      <h3 className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[15px] text-foreground">
        <span className="font-semibold">{method}</span>
        <span>{path}</span>
        <span className="font-sans text-xs font-normal text-muted-foreground">{scope === "write" ? "Needs a read and write key" : "Any key"}</span>
      </h3>
      {children}
    </div>
  );
}

const C = ({ children }: { children: ReactNode }) => <code className="rounded bg-muted px-1.5 py-0.5 text-[13px] text-foreground">{children}</code>;

const SECTIONS: Array<{ id: string; heading: string; body: ReactNode }> = [
  {
    id: "keys",
    heading: "Keys and authentication",
    body: (
      <>
        <p>
          Create a key in <Link href="/settings#api-keys" className="text-primary underline underline-offset-2 hover:decoration-2">Settings</Link>. It is shown once, so copy it then; StudyScribe keeps only a hash of it. Send it on every request in the <C>Authorization</C> header.
        </p>
        <CodeBlock label="authentication example" code={`curl ${BASE}/me \\\n  -H "Authorization: Bearer $STUDYSCRIBE_KEY"`} />
        <p>
          Keys belong to you and act as you. Keep them on a server or in a password manager, never in a web page or an app other people download. If one leaks, revoke it in Settings; requests with it fail straight away. A key can never manage keys, change billing or delete your account.
        </p>
      </>
    ),
  },
  {
    id: "scopes",
    heading: "Scopes",
    body: (
      <ul className="list-disc space-y-1.5 pl-6">
        <li><strong className="text-foreground">Read only:</strong> list recordings and read transcripts, notes and flashcards.</li>
        <li><strong className="text-foreground">Read and write:</strong> everything a read key can do, plus importing a recording from a link and writing notes.</li>
      </ul>
    ),
  },
  {
    id: "limits",
    heading: "Rate limits and your plan",
    body: (
      <>
        <p>
          Each key can make 60 requests a minute, of which 10 may import recordings or write notes. Every response carries <C>X-RateLimit-Limit</C>, <C>X-RateLimit-Remaining</C> and <C>X-RateLimit-Reset</C> (seconds); a refused request gets status 429 and a <C>Retry-After</C> header.
        </p>
        <p>
          What a key does counts toward your plan exactly as if you did it in the app: an imported recording uses transcription minutes once it is transcribed, and each set of notes is one AI generation. When the month's allowance is used up, those requests return 402 with the code <C>usage_limit</C> until it resets or you change plan on the <Link href="/pricing" className="text-primary underline underline-offset-2 hover:decoration-2">Pricing</Link> page.
        </p>
      </>
    ),
  },
  {
    id: "errors",
    heading: "Errors",
    body: (
      <>
        <p>Errors are JSON with a stable code and a sentence you can show to a person:</p>
        <CodeBlock label="error example" code={`{\n  "error": {\n    "code": "not_found",\n    "message": "Recording not found."\n  }\n}`} />
        <ul className="list-disc space-y-1.5 pl-6">
          <li><C>400 invalid_request</C>: a parameter is missing or wrong.</li>
          <li><C>401 unauthorized</C>: no key, or the key was revoked.</li>
          <li><C>402 usage_limit</C>: this month's allowance is used up.</li>
          <li><C>403 insufficient_scope</C>: the key is read only.</li>
          <li><C>404 not_found</C>: no such recording on your account, or no such endpoint.</li>
          <li><C>409 not_ready</C>: the transcript is not finished yet.</li>
          <li><C>422 request_failed</C>: the request was understood but could not be done, for example a link that cannot be downloaded. The message says why.</li>
          <li><C>429 rate_limited</C>: slow down and retry after <C>Retry-After</C> seconds.</li>
          <li><C>5xx</C>: something failed on our side or at a provider; retry later.</li>
        </ul>
      </>
    ),
  },
  {
    id: "endpoints",
    heading: "Endpoints",
    body: (
      <div className="space-y-8">
        <Endpoint method="GET" path="/v1/me" scope="read">
          <p>Your account, plan and this month's usage.</p>
          <CodeBlock label="request" code={`curl ${BASE}/me -H "Authorization: Bearer $STUDYSCRIBE_KEY"`} />
        </Endpoint>
        <Endpoint method="GET" path="/v1/recordings" scope="read">
          <p>Your recordings, newest first. Optional query parameters: <C>courseId</C>, <C>status</C> (<C>processing</C>, <C>completed</C> or <C>failed</C>), <C>limit</C> (1 to 100, default 50) and <C>offset</C>. The response has <C>data</C>, <C>total</C> and <C>nextOffset</C> (null on the last page).</p>
          <CodeBlock label="request" code={`curl "${BASE}/recordings?status=completed&limit=20" \\\n  -H "Authorization: Bearer $STUDYSCRIBE_KEY"`} />
          <CodeBlock label="response" code={`{\n  "data": [\n    {\n      "id": 128,\n      "title": "Cell biology, week 3",\n      "description": null,\n      "status": "completed",\n      "durationSeconds": 3120,\n      "audience": "student",\n      "courseId": 4,\n      "tagIds": [],\n      "createdAt": "2026-10-12T14:03:11.000Z",\n      "updatedAt": "2026-10-12T14:09:40.000Z"\n    }\n  ],\n  "total": 1,\n  "limit": 20,\n  "offset": 0,\n  "nextOffset": null\n}`} />
        </Endpoint>
        <Endpoint method="GET" path="/v1/recordings/:id" scope="read">
          <p>One recording. While it is <C>processing</C>, call this every few seconds to follow the transcription; it moves to <C>completed</C> or <C>failed</C>.</p>
          <CodeBlock label="request" code={`curl ${BASE}/recordings/128 -H "Authorization: Bearer $STUDYSCRIBE_KEY"`} />
        </Endpoint>
        <Endpoint method="GET" path="/v1/recordings/:id/transcript" scope="read">
          <p>The transcript text and its timed lines, with speaker labels. Times are in seconds. If you edited the transcript in the app, <C>text</C> has your edits.</p>
          <CodeBlock label="request" code={`curl ${BASE}/recordings/128/transcript -H "Authorization: Bearer $STUDYSCRIBE_KEY"`} />
          <CodeBlock label="response" code={`{\n  "data": {\n    "recordingId": 128,\n    "language": "en",\n    "text": "Today we look at the cell membrane...",\n    "segments": [\n      { "start": 0.4, "end": 6.2, "speaker": "Speaker A", "text": "Today we look at the cell membrane." }\n    ],\n    "updatedAt": "2026-10-12T14:09:40.000Z"\n  }\n}`} />
        </Endpoint>
        <Endpoint method="GET" path="/v1/recordings/:id/notes" scope="read">
          <p>Study notes written for the recording, in Markdown.</p>
          <CodeBlock label="request" code={`curl ${BASE}/recordings/128/notes -H "Authorization: Bearer $STUDYSCRIBE_KEY"`} />
        </Endpoint>
        <Endpoint method="GET" path="/v1/recordings/:id/flashcards" scope="read">
          <p>Flashcards with question, answer and difficulty.</p>
          <CodeBlock label="request" code={`curl ${BASE}/recordings/128/flashcards -H "Authorization: Bearer $STUDYSCRIBE_KEY"`} />
        </Endpoint>
        <Endpoint method="POST" path="/v1/recordings" scope="write">
          <p>
            Imports audio or video from a public link and starts transcribing it, the same as Import from link in the app. Body: <C>url</C> (required), and optionally <C>title</C>, <C>language</C> (for example <C>en</C> or <C>es</C>; detected when left out) and <C>audience</C> (<C>student</C> or <C>professional</C>). Answers 202 with the new recording; poll it until it is <C>completed</C>. Only send links you have the right to use (see the <Link href="/terms" className="text-primary underline underline-offset-2 hover:decoration-2">Terms</Link>).
          </p>
          <CodeBlock label="request" code={`curl -X POST ${BASE}/recordings \\\n  -H "Authorization: Bearer $STUDYSCRIBE_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"url": "https://example.edu/lectures/week3.mp3", "title": "Week 3"}'`} />
        </Endpoint>
        <Endpoint method="POST" path="/v1/recordings/:id/notes" scope="write">
          <p>
            Writes a new set of notes for a finished recording and returns it. Optional body: <C>template</C>, one of {NOTE_TEMPLATES.map((template, index) => (<span key={template.id}>{index > 0 && (index === NOTE_TEMPLATES.length - 1 ? " or " : ", ")}<C>{template.id}</C></span>))}; without it the template follows the recording's audience. Counts as one AI generation.
          </p>
          <CodeBlock label="request" code={`curl -X POST ${BASE}/recordings/128/notes \\\n  -H "Authorization: Bearer $STUDYSCRIBE_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"template": "lecture"}'`} />
        </Endpoint>
      </div>
    ),
  },
  {
    id: "versioning",
    heading: "Versions and changes",
    body: (
      <>
        <p>
          Everything here is under <C>/api/v1</C>. Within v1 we only add things: new endpoints, new fields and new error codes, so ignore fields you do not know. A change that would break a working script gets a new version, announced at least 90 days before the old one stops.
        </p>
        <p>To be told about each finished transcript instead of polling, add a webhook in Settings. Questions: <ContactEmail subject="StudyScribe API" />.</p>
      </>
    ),
  },
];

export default function Developers() {
  return (
    <PublicLayout>
      <article className="mx-auto max-w-3xl px-4 pb-24 pt-10 sm:px-6">
        <h1 className="text-4xl font-bold tracking-tight">StudyScribe API</h1>
        <p className="mt-2 text-sm text-muted-foreground">Version 1</p>
        <div className="mt-6 space-y-4 text-muted-foreground">
          <p>
            Read your recordings, transcripts, notes and flashcards from your own scripts, and import new recordings from links. The API is a plain JSON REST interface over HTTPS that uses personal keys; it is for your own account, not for apps that sign other people in.
          </p>
        </div>
        <nav aria-label="On this page" className="mt-8 rounded-2xl border border-border bg-brand-mist/60 p-5">
          <ol className="grid gap-1.5 text-sm sm:grid-cols-2">
            {SECTIONS.map((section, i) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="text-primary underline underline-offset-2 hover:decoration-2">{i + 1}. {section.heading}</a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="mt-10 space-y-12">
          {SECTIONS.map((section, i) => (
            <section key={section.id} id={section.id} className="scroll-mt-28">
              <h2 className="text-xl font-semibold tracking-tight">{i + 1}. {section.heading}</h2>
              <div className="mt-3 space-y-4 leading-relaxed text-muted-foreground">{section.body}</div>
            </section>
          ))}
        </div>
      </article>
    </PublicLayout>
  );
}
