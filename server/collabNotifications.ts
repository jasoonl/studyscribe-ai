import { userNotifications } from "../drizzle/schema";
import { getDb } from "./db";
import { sendBrowserPush } from "./pushNotifications";

/**
 * In-app notification (plus browser push, if the person turned it on) for
 * collaboration events: a share, a group invite, a comment. A failure here is
 * logged and swallowed; the action that triggered it has already succeeded.
 */
export async function notifyUser(userId: number, note: { title: string; message: string; url: string; recordingId?: number; tag?: string }) {
  try {
    const db = await getDb();
    if (db) {
      await db.insert(userNotifications).values({
        userId,
        type: "info",
        title: note.title.slice(0, 255),
        message: note.message,
        recordingId: note.recordingId ?? null,
        isRead: 0,
      });
    }
    await sendBrowserPush(userId, { title: note.title, body: note.message, url: note.url, tag: note.tag ?? "collaboration" });
  } catch (error) {
    console.error("[collaboration] notification failed:", error instanceof Error ? error.message : error);
  }
}
