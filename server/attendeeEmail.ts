import type { Express, Request, Response } from "express";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { attendeeEmails, emailOptOuts, studyNotes, type AttendeeEmail } from "../drizzle/schema";
import { CONTACT_EMAIL, OPERATOR_NAME } from "@shared/legal";
import { getDb, getRecordingById } from "./db";
import { getApplicationOrigin, getSafeApplicationOrigin, isTransactionalEmailConfigured } from "./email";
import { escapeHtml, markdownToHtml } from "./markdownExport";
import { getRecordingEvent, parseStoredAttendees, type Attendee } from "./recordingEvents";
import { explainMissingSchema, tolerateMissingSchema } from "./schemaTolerance";
import { checkTrpcRateLimit } from "./_core/rateLimit";
import { protectedProcedure, router } from "./_core/trpc";

/**
 * Sharing notes with a meeting's attendees (D4).
 *
 * For a recording made from a calendar event or by the meeting note-taker,
 * the owner can email a set of notes to the people invited. Nothing is sent
 * automatically: the owner sees a preview, ticks recipients, and presses Send.
 *
 * This is not transactional mail, so (legal checklist item 18) every message
 * carries a one-click "don't email me from StudyScribe" link (also as
 * List-Unsubscribe headers, RFC 8058) and the operator's postal address. An
 * address that opted out is never emailed again by anyone; only a hash of it
 * is kept. The feature is on only when Resend and EMAIL_POSTAL_ADDRESS are
 * configured.
 */

export const MAX_RECIPIENTS_PER_SEND = 50;
const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function postalAddress(env: NodeJS.ProcessEnv = process.env) {
  return env.EMAIL_POSTAL_ADDRESS?.trim() || null;
}

export function isAttendeeEmailConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL && postalAddress(env));
}

export function emailHash(email: string) {
  return createHash("sha256").update(email.trim().toLowerCase(), "utf8").digest("hex");
}

function unsubscribeSecret() {
  return `${process.env.JWT_SECRET || "default-dev-secret-change-in-production"}:email-opt-out`;
}

/** A token that names one address and cannot be forged; it does not expire, as unsubscribe links must keep working. */
export function unsubscribeToken(email: string, secret = unsubscribeSecret()) {
  const address = Buffer.from(email.trim().toLowerCase(), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(address).digest("base64url").slice(0, 32);
  return `${address}.${signature}`;
}

export function readUnsubscribeToken(token: string, secret = unsubscribeSecret()): string | null {
  if (typeof token !== "string" || token.length > 700) return null;
  const [address, signature] = token.split(".");
  if (!address || !signature) return null;
  const expected = Buffer.from(createHmac("sha256", secret).update(address).digest("base64url").slice(0, 32));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const email = Buffer.from(address, "base64url").toString("utf8");
  return /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
}

export function unsubscribeUrl(email: string, origin = getApplicationOrigin()) {
  return `${origin.replace(/\/$/, "")}/unsubscribe?token=${encodeURIComponent(unsubscribeToken(email))}`;
}

/** The one-click endpoint mail clients POST to (List-Unsubscribe-Post). */
export function oneClickUnsubscribeUrl(email: string, origin = getApplicationOrigin()) {
  return `${origin.replace(/\/$/, "")}/api/email/unsubscribe?token=${encodeURIComponent(unsubscribeToken(email))}`;
}

/** Hashes of the given addresses that opted out. */
export async function optedOutHashes(emails: string[]): Promise<Set<string>> {
  if (!emails.length) return new Set();
  const db = await getDb();
  if (!db) return new Set();
  const hashes = emails.map(emailHash);
  const rows = await tolerateMissingSchema("email opt-outs", () => db.select({ emailHash: emailOptOuts.emailHash }).from(emailOptOuts).where(inArray(emailOptOuts.emailHash, hashes)), [] as Array<{ emailHash: string }>);
  return new Set(rows.map((row) => row.emailHash));
}

export async function isOptedOut(email: string) {
  return (await optedOutHashes([email])).has(emailHash(email));
}

export async function setOptOut(email: string, optedOut: boolean) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const hash = emailHash(email);
  if (optedOut) await db.insert(emailOptOuts).values({ emailHash: hash }).onDuplicateKeyUpdate({ set: { emailHash: sql`emailHash` } });
  else await db.delete(emailOptOuts).where(eq(emailOptOuts.emailHash, hash));
}

/**
 * Who a send goes to: only addresses invited to the event (never one typed
 * in), each once, minus everyone who opted out. Pure, so the rule is tested.
 */
export function planAttendeeSend(input: { invited: Attendee[]; requested: string[]; optedOut: Set<string> }) {
  const invited = new Set(input.invited.map((attendee) => attendee.email.toLowerCase()));
  const wanted = Array.from(new Set(input.requested.map((email) => email.trim().toLowerCase())));
  const outsiders = wanted.filter((email) => !invited.has(email));
  const allowed = wanted.filter((email) => invited.has(email));
  return {
    outsiders,
    send: allowed.filter((email) => !input.optedOut.has(emailHash(email))),
    skipped: allowed.filter((email) => input.optedOut.has(emailHash(email))),
  };
}

/** Only web and mail links survive in the email; anything else (javascript:, data:) loses its link. */
export function safeNotesHtml(markdown: string) {
  const document = markdownToHtml(markdown, "Notes");
  const body = document.slice(document.indexOf("<body>") + 6, document.lastIndexOf("</body>"));
  return body.replace(/<a href="([^"]*)">/g, (match, href: string) => (/^(https?:|mailto:)/i.test(href.replace(/&amp;/g, "&")) ? match : "<a>"));
}

export function buildAttendeeEmail(input: {
  ownerName: string;
  ownerEmail: string;
  title: string;
  notesMarkdown: string;
  message?: string | null;
  recipient: string;
  postal: string;
  origin?: string;
}) {
  const owner = input.ownerName.trim() || input.ownerEmail;
  const subject = `Notes from ${input.title}`.slice(0, 200);
  const stop = unsubscribeUrl(input.recipient, input.origin);
  const message = input.message?.trim();
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px 16px;background:#f5f7fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
    <main style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e3e7ef;border-radius:14px;padding:32px;">
      <p style="margin:0 0 6px;font-size:13px;color:#596579;">${escapeHtml(owner)} shared notes with you</p>
      <h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;">${escapeHtml(input.title)}</h1>
      ${message ? `<p style="margin:0 0 20px;padding:12px 14px;background:#f5f7fb;border-radius:10px;line-height:1.6;white-space:pre-line;">${escapeHtml(message)}</p>` : ""}
      <div style="line-height:1.6;font-size:15px;">${safeNotesHtml(input.notesMarkdown)}</div>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#596579;">These notes were written with StudyScribe from a recording of the meeting and can contain mistakes. Reply to this email to reach ${escapeHtml(owner)}.</p>
      <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e3e7ef;font-size:12px;line-height:1.6;color:#596579;">
        You received this because you were invited to ${escapeHtml(input.title)} and ${escapeHtml(owner)} chose to send you the notes.
        <a href="${escapeHtml(stop)}" style="color:#1d4ed8;">Don't email me from StudyScribe</a>.
        ${escapeHtml(OPERATOR_NAME)}, ${escapeHtml(input.postal)}. Questions: <a href="mailto:${CONTACT_EMAIL}" style="color:#1d4ed8;">${CONTACT_EMAIL}</a>
      </p>
    </main>
  </body>
</html>`;
  const text = [
    `${owner} shared notes with you: ${input.title}`,
    message ? `\n${message}\n` : "",
    input.notesMarkdown,
    "",
    `Reply to this email to reach ${owner}.`,
    "",
    `You received this because you were invited to ${input.title}. Don't email me from StudyScribe: ${stop}`,
    `${OPERATOR_NAME}, ${input.postal}`,
  ].join("\n");
  return { subject, html, text, unsubscribe: stop };
}

/** Display name for the From header: the owner's name, without characters that would break the header. */
export function fromHeader(ownerName: string, fromEmail: string) {
  const name = ownerName.replace(/["<>\r\n]/g, "").trim().slice(0, 60);
  const address = fromEmail.includes("<") ? fromEmail.slice(fromEmail.indexOf("<") + 1, fromEmail.indexOf(">")) : fromEmail;
  return name ? `"${name} via StudyScribe" <${address}>` : `StudyScribe <${address}>`;
}

function resendEndpoint() {
  const override = process.env.NODE_ENV !== "production" ? process.env.RESEND_TEST_ENDPOINT?.trim() : undefined;
  return override || RESEND_ENDPOINT;
}

async function sendOne(input: { from: string; to: string; replyTo: string; subject: string; html: string; text: string; unsubscribe: string; oneClick: string }) {
  const response = await fetch(resendEndpoint(), {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      reply_to: input.replyTo,
      subject: input.subject,
      html: input.html,
      text: input.text,
      headers: { "List-Unsubscribe": `<${input.oneClick}>, <${input.unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
  const body = (await response.json().catch(() => null)) as { id?: string } | null;
  return body?.id ?? null;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  return db;
}

async function ownRecording(recordingId: number, userId: number) {
  const recording = await getRecordingById(recordingId);
  if (!recording || recording.userId !== userId || recording.isDeleted) throw new TRPCError({ code: "NOT_FOUND", message: "Recording not found" });
  return recording;
}

async function notesFor(recordingId: number, userId: number) {
  const db = await requireDb();
  const rows = await db.select().from(studyNotes).where(and(eq(studyNotes.recordingId, recordingId), eq(studyNotes.userId, userId))).orderBy(desc(studyNotes.createdAt));
  // Key terms and chapters are stored as notes but are not notes (server/recordingInsights.ts).
  return rows.filter((row) => !(row.metadata as any)?.insight);
}

async function sentTo(recordingId: number) {
  const db = await requireDb();
  return tolerateMissingSchema("attendee emails", () => db.select().from(attendeeEmails).where(eq(attendeeEmails.recordingId, recordingId)), [] as AttendeeEmail[]);
}

const noteLabel = (note: { type: string; metadata: unknown }) => {
  const template = (note.metadata as any)?.template;
  return typeof template === "string" ? `${template[0].toUpperCase()}${template.slice(1)} notes` : note.type === "summary" ? "Summary" : note.type.replace(/_/g, " ");
};

export const attendeeShareRouter = router({
  /** What the share dialog needs: the event, its attendees (with who opted out or already got it) and the notes to send. */
  get: protectedProcedure.input(z.object({ recordingId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await ownRecording(input.recordingId, ctx.user.id);
    const event = await getRecordingEvent(input.recordingId);
    const configured = isAttendeeEmailConfigured();
    if (!event) return { configured, event: null, attendees: [], notes: [] };
    const attendees = parseStoredAttendees(event.attendees).filter((attendee) => attendee.email !== ctx.user.email.toLowerCase());
    const [optedOut, sent, notes] = await Promise.all([optedOutHashes(attendees.map((attendee) => attendee.email)), sentTo(input.recordingId), notesFor(input.recordingId, ctx.user.id)]);
    const lastSent = new Map<string, Date>();
    for (const row of sent) if (!lastSent.has(row.recipient) || lastSent.get(row.recipient)! < row.createdAt) lastSent.set(row.recipient, row.createdAt);
    return {
      configured,
      event: { title: event.title, source: event.source, startsAt: event.startsAt },
      attendees: attendees.map((attendee) => ({ ...attendee, optedOut: optedOut.has(emailHash(attendee.email)), sentAt: lastSent.get(attendee.email) ?? null })),
      notes: notes.map((note) => ({ id: note.id, label: noteLabel(note), createdAt: note.createdAt, preview: note.content.slice(0, 160) })),
    };
  }),

  /** The exact email a recipient would get (shown in a preview before sending). */
  preview: protectedProcedure
    .input(z.object({ recordingId: z.number().int().positive(), noteId: z.number().int().positive(), message: z.string().max(1000).optional() }))
    .query(async ({ ctx, input }) => {
      await ownRecording(input.recordingId, ctx.user.id);
      const event = await getRecordingEvent(input.recordingId);
      const note = (await notesFor(input.recordingId, ctx.user.id)).find((row) => row.id === input.noteId);
      if (!event || !note) throw new TRPCError({ code: "NOT_FOUND", message: "Those notes are not available." });
      const built = buildAttendeeEmail({ ownerName: ctx.user.name ?? "", ownerEmail: ctx.user.email, title: event.title, notesMarkdown: note.content, message: input.message, recipient: "attendee@example.com", postal: postalAddress() ?? "(postal address)" });
      return { subject: built.subject, html: built.html, from: fromHeader(ctx.user.name ?? "", process.env.RESEND_FROM_EMAIL || "notes@studyscribe.example"), replyTo: ctx.user.email };
    }),

  send: protectedProcedure
    .input(z.object({
      recordingId: z.number().int().positive(),
      noteId: z.number().int().positive(),
      recipients: z.array(z.string().email().max(254)).min(1).max(MAX_RECIPIENTS_PER_SEND),
      message: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!isAttendeeEmailConfigured()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Emailing notes is not set up on this server yet." });
      await ownRecording(input.recordingId, ctx.user.id);
      if (!checkTrpcRateLimit(`attendee-email:${ctx.user.id}`, 60 * 60 * 1000, 5)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "You can send notes 5 times an hour. Try again later." });
      }
      const db = await requireDb();
      // A daily ceiling per person, kept in the database so it holds across server instances.
      const [{ count }] = await explainMissingSchema("Emailing notes", () =>
        db.select({ count: sql<string>`COUNT(*)` }).from(attendeeEmails).where(and(eq(attendeeEmails.userId, ctx.user.id), gte(attendeeEmails.createdAt, new Date(Date.now() - 24 * 60 * 60_000)))),
      );
      if (Number(count) + input.recipients.length > 200) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "That would pass today's limit of 200 emails. Try again tomorrow." });

      const event = await getRecordingEvent(input.recordingId);
      if (!event) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This recording is not linked to a calendar event or meeting." });
      const note = (await notesFor(input.recordingId, ctx.user.id)).find((row) => row.id === input.noteId);
      if (!note) throw new TRPCError({ code: "NOT_FOUND", message: "Those notes are not available." });

      // Only the event's own attendees can be emailed, never an address typed in.
      const invited = parseStoredAttendees(event.attendees);
      const plan = planAttendeeSend({ invited, requested: input.recipients, optedOut: await optedOutHashes(input.recipients.map((email) => email.trim().toLowerCase())) });
      if (plan.outsiders.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Notes can only be sent to people invited to the event." });

      const from = fromHeader(ctx.user.name ?? "", process.env.RESEND_FROM_EMAIL!);
      const origin = getSafeApplicationOrigin(typeof ctx.req.headers.origin === "string" ? ctx.req.headers.origin : undefined);
      const result = { sent: [] as string[], skipped: plan.skipped, failed: [] as string[] };
      for (const email of plan.send) {
        const built = buildAttendeeEmail({ ownerName: ctx.user.name ?? "", ownerEmail: ctx.user.email, title: event.title, notesMarkdown: note.content, message: input.message, recipient: email, postal: postalAddress()!, origin });
        try {
          const providerId = await sendOne({ from, to: email, replyTo: ctx.user.email, subject: built.subject, html: built.html, text: built.text, unsubscribe: built.unsubscribe, oneClick: oneClickUnsubscribeUrl(email, origin) });
          await db.insert(attendeeEmails).values({ recordingId: input.recordingId, userId: ctx.user.id, noteId: note.id, recipient: email, providerId });
          result.sent.push(email);
        } catch (error) {
          console.error("[attendeeEmail] send failed:", error instanceof Error ? error.message : error);
          result.failed.push(email);
        }
      }
      return result;
    }),
});

/** The public opt-out: POST from the /unsubscribe page or a mail client's one-click button. */
export function registerEmailOptOutRoutes(app: Express) {
  app.post("/api/email/unsubscribe", async (req: Request, res: Response) => {
    const token = typeof req.query.token === "string" ? req.query.token : typeof req.body?.token === "string" ? req.body.token : "";
    const email = readUnsubscribeToken(token);
    if (!email) {
      res.status(400).json({ error: "This link is not valid." });
      return;
    }
    const resubscribe = req.body?.action === "resubscribe";
    try {
      await setOptOut(email, !resubscribe);
      res.json({ optedOut: !resubscribe, email: maskForPage(email) });
    } catch (error) {
      console.error("[attendeeEmail] opt-out failed:", error instanceof Error ? error.message : error);
      res.status(503).json({ error: "We could not save that right now. Try again in a moment." });
    }
  });

  /** Lets the page show whose preference it is changing and its current state. */
  app.get("/api/email/unsubscribe", async (req: Request, res: Response) => {
    const email = readUnsubscribeToken(typeof req.query.token === "string" ? req.query.token : "");
    if (!email) {
      res.status(400).json({ error: "This link is not valid." });
      return;
    }
    res.json({ email: maskForPage(email), optedOut: await isOptedOut(email).catch(() => false) });
  });
}

function maskForPage(email: string) {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}${local.length > 2 ? "***" : ""}@${domain}`;
}

export async function deleteAttendeeEmailsForRecordings(recordingIds: number[]) {
  if (!recordingIds.length) return;
  const db = await getDb();
  if (!db) return;
  await tolerateMissingSchema("attendee emails", () => db.delete(attendeeEmails).where(inArray(attendeeEmails.recordingId, recordingIds)), undefined);
}

export async function deleteAttendeeEmailsForUser(userId: number) {
  const db = await getDb();
  if (!db) return;
  await tolerateMissingSchema("attendee emails", () => db.delete(attendeeEmails).where(eq(attendeeEmails.userId, userId)), undefined);
}

export async function exportAttendeeEmailsForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await tolerateMissingSchema("attendee emails", () => db.select().from(attendeeEmails).where(eq(attendeeEmails.userId, userId)), [] as AttendeeEmail[]);
  return rows.map((row) => ({ recordingId: row.recordingId, noteId: row.noteId, recipient: row.recipient, sentAt: row.createdAt }));
}
