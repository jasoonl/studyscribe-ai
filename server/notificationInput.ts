import { z } from "zod";

export const notificationTypes = ["info", "success", "warning", "error"] as const;

export const customNotificationInputSchema = z.object({
  title: z.string().trim().min(1, "A title is required").max(120, "Keep the title under 120 characters"),
  message: z.string().trim().min(1, "A message is required").max(1000, "Keep the message under 1,000 characters"),
  type: z.enum(notificationTypes).default("info"),
  recordingId: z.number().int().positive().optional(),
});

export const dismissNotificationInputSchema = z.object({
  id: z.number().int().positive(),
});
