import { userNotifications, InsertUserNotification, UserNotification } from "../drizzle/schema";
import { getDb } from "./db";
import { eq, desc, and } from "drizzle-orm";

/**
 * Create a new user notification
 */
export async function createUserNotification(
  data: InsertUserNotification
): Promise<UserNotification> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(userNotifications).values(data);
  // Get the last inserted notification
  const result = await db
    .select()
    .from(userNotifications)
    .where(eq(userNotifications.userId, data.userId))
    .orderBy(desc(userNotifications.createdAt))
    .limit(1);
  return result[0]!;
}

/**
 * Get all notifications for a user
 */
export async function getUserNotifications(
  userId: number,
  limit = 50
): Promise<UserNotification[]> {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(userNotifications)
    .where(eq(userNotifications.userId, userId))
    .orderBy(desc(userNotifications.createdAt))
    .limit(limit);
}

/**
 * Get unread notifications for a user
 */
export async function getUnreadNotifications(userId: number): Promise<UserNotification[]> {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(userNotifications)
    .where(
      and(
        eq(userNotifications.userId, userId),
        eq(userNotifications.isRead, 0)
      )
    )
    .orderBy(desc(userNotifications.createdAt));
}

/**
 * Mark a notification as read
 */
export async function markNotificationAsRead(notificationId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(userNotifications)
    .set({ isRead: 1, readAt: new Date() })
    .where(eq(userNotifications.id, notificationId));
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllNotificationsAsRead(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(userNotifications)
    .set({ isRead: 1, readAt: new Date() })
    .where(eq(userNotifications.userId, userId));
}

/**
 * Delete a notification
 */
export async function deleteNotification(notificationId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(userNotifications).where(eq(userNotifications.id, notificationId));
}

/**
 * Get notification count for a user
 */
export async function getUnreadNotificationCount(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db
    .select()
    .from(userNotifications)
    .where(
      and(
        eq(userNotifications.userId, userId),
        eq(userNotifications.isRead, 0)
      )
    );
  return result.length;
}
