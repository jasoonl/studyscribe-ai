import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { getRecordingById, setAppSetting } from "./db";
import { requireRecordingAccess } from "./recordingAccess";
import { contentTypeFromStorageKey } from "./storage";
import { PLAYBACK_TTL_MS, createPlaybackToken, playbackPath } from "./playbackLink";
import { registerDeviceToken, unregisterDeviceToken } from "./nativePush";
import { getMobileConfig } from "./mobileAuth";
import { MIN_MOBILE_VERSION_SETTING, isValidVersion } from "@shared/mobile";

/**
 * tRPC procedures for the mobile app (F1): push device registration, signed
 * playback links, and the minimum supported app version.
 */
export const mobileRouter = router({
  config: publicProcedure.query(() => getMobileConfig()),

  /** Admin: the oldest app version allowed to keep working ("" clears it). */
  setMinVersion: adminProcedure
    .input(z.object({ version: z.string().max(16) }))
    .mutation(async ({ input }) => {
      const version = input.version.trim();
      if (version && !isValidVersion(version)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Use a version like 1.2.0." });
      }
      await setAppSetting(MIN_MOBILE_VERSION_SETTING, version);
      return { minVersion: version || null };
    }),

  registerDevice: protectedProcedure
    .input(z.object({
      token: z.string().min(10).max(255),
      platform: z.enum(["ios", "android"]),
      appVersion: z.string().max(32).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await registerDeviceToken({ userId: ctx.user.id, token: input.token, platform: input.platform, appVersion: input.appVersion });
      } catch (error) {
        if (error instanceof Error && /Expo push token/.test(error.message)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }
    }),

  unregisterDevice: protectedProcedure
    .input(z.object({ token: z.string().min(10).max(255) }))
    .mutation(async ({ ctx, input }) => {
      await unregisterDeviceToken(ctx.user.id, input.token);
      return { success: true };
    }),

  /**
   * A signed, few-hours link to a recording's audio for the app's player,
   * which cannot send the session token with every range request. Same
   * access rule as the storage proxy: owner or anyone it is shared with.
   */
  playbackUrl: protectedProcedure
    .input(z.object({ recordingId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await requireRecordingAccess(input.recordingId, ctx.user.id, "view");
      const recording = await getRecordingById(input.recordingId);
      if (!recording?.audioKey) throw new TRPCError({ code: "NOT_FOUND", message: "This recording has no audio." });
      const token = createPlaybackToken({ key: recording.audioKey, userId: ctx.user.id, recordingId: recording.id });
      return {
        path: playbackPath(token, contentTypeFromStorageKey(recording.audioKey)),
        expiresAt: new Date(Date.now() + PLAYBACK_TTL_MS).toISOString(),
      };
    }),
});
