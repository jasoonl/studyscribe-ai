import { router, publicProcedure, protectedProcedure } from './_core/trpc';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createInvite } from './authService';
import { getDb, createInviteRequest, getAllInviteRequests, getInviteRequestById, updateInviteRequestStatus, createInviteCode, getAllInviteCodes, getInviteCodeById, updateInviteCodeExpiry, revokeInviteCode, deleteInviteCode } from './db';
import { eq } from 'drizzle-orm';
import { users, inviteCodes } from '../drizzle/schema';
import { notifyOwner } from './_core/notification';
import { nanoid } from 'nanoid';
import { checkTrpcRateLimit } from './_core/rateLimit';

export const customAuthRouter = router({
  /**
   * Create invite code (admin only)
   */
  createInviteCode: protectedProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input, ctx }) => {
      // Check if user is admin
      if (ctx.user.role !== 'admin') {
        throw new Error('Only admins can create invite codes');
      }

      const result = await createInvite(input.email, ctx.user.id);

      if (result.error) {
        throw new Error(result.error);
      }

      return {
        code: result.code,
        email: input.email,
        expiresIn: '7 days',
      };
    }),

  /**
   * Get all invite codes (admin only)
   */
  getInviteCodes: protectedProcedure.query(async ({ ctx }) => {
    // Check if user is admin
    if (ctx.user.role !== 'admin') {
      throw new Error('Only admins can view invite codes');
    }

    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    const codes = await db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.createdBy, ctx.user.id));

    return codes.map((code) => ({
      id: code.id,
      code: code.code,
      email: code.email,
      isUsed: code.isUsed === 1,
      usedAt: code.usedAt,
      expiresAt: code.expiresAt,
      createdAt: code.createdAt,
    }));
  }),

  /**
   * Get all users (admin only)
   */
  getAllUsers: protectedProcedure.query(async ({ ctx }) => {
    // Check if user is admin
    if (ctx.user.role !== 'admin') {
      throw new Error('Only admins can view all users');
    }

    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    const allUsers = await db.select().from(users);

    return allUsers.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      loginMethod: user.loginMethod,
      emailVerified: user.emailVerified === 1,
      createdAt: user.createdAt,
      lastSignedIn: user.lastSignedIn,
    }));
  }),

  /**
   * Update user role (admin only)
   */
  updateUserRole: protectedProcedure
    .input(
      z.object({
        userId: z.number(),
        role: z.enum(['user', 'admin']),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Check if user is admin
      if (ctx.user.role !== 'admin') {
        throw new Error('Only admins can update user roles');
      }

      const db = await getDb();
      if (!db) {
        throw new Error('Database not available');
      }

      await db.update(users).set({ role: input.role }).where(eq(users.id, input.userId));

      return { success: true };
    }),

  // ─── Invite Request Procedures ───────────────────────────────────────────

  /**
   * Public: Submit a request for an invite code
   */
  requestInvite: publicProcedure
    .input(z.object({
      email: z.string().email('Please enter a valid email address'),
      name: z.string().min(1, 'Name is required').max(255),
      reason: z.string().max(1000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const ip = ctx.req.ip ?? "unknown";
      if (!checkTrpcRateLimit(`requestInvite:${ip}`, 60 * 60 * 1000, 10)) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many requests. Please try again later.' });
      }

      await createInviteRequest({
        email: input.email,
        name: input.name,
        reason: input.reason,
      });

      // Notify owner about the new request
      try {
        await notifyOwner({
          title: `New Invite Request from ${input.name}`,
          content: `${input.name} (${input.email}) has requested access to StudyScribe AI.${input.reason ? `\n\nReason: ${input.reason}` : ''}\n\nReview and approve/deny in the Admin panel.`,
        });
      } catch (e) {
        // Non-fatal: request was saved even if notification fails
        console.warn('[InviteRequest] Owner notification failed:', e);
      }

      return { success: true };
    }),

  /**
   * Admin: List all invite requests
   */
  listInviteRequests: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== 'admin') {
      throw new Error('Forbidden');
    }
    return getAllInviteRequests();
  }),

  /**
   * Admin: Approve an invite request — generates a unique invite code and
   * sends it to the requester via owner notification (email TBD)
   */
  approveInviteRequest: protectedProcedure
    .input(z.object({
      requestId: z.number(),
      reviewNote: z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== 'admin') throw new Error('Forbidden');

      const request = await getInviteRequestById(input.requestId);
      if (!request) throw new Error('Request not found');
      if (request.status !== 'pending') throw new Error('Request already reviewed');

      // Generate a unique invite code for this requester
      const code = `SS-${nanoid(12).toUpperCase()}`;
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      await createInviteCode({
        code,
        email: request.email,
        createdBy: ctx.user.id,
        expiresAt,
      });

      // Get the invite code ID
      const db = await getDb();
      if (!db) throw new Error('Database not available');
      const inviteRow = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code)).limit(1);
      const inviteCodeId = inviteRow[0]?.id;

      await updateInviteRequestStatus(input.requestId, 'approved', ctx.user.id, input.reviewNote, inviteCodeId);

      // Notify owner with the code to forward to the user
      try {
        await notifyOwner({
          title: `Invite Code Generated for ${request.name}`,
          content: `You approved ${request.name} (${request.email}).\n\nTheir invite code is:\n\n${code}\n\nPlease forward this code to them. It expires in 30 days.`,
        });
      } catch (e) {
        console.warn('[InviteRequest] Approval notification failed:', e);
      }

      return { success: true, code };
    }),

  /**
   * Admin: Deny an invite request
   */
  denyInviteRequest: protectedProcedure
    .input(z.object({
      requestId: z.number(),
      reviewNote: z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== 'admin') throw new Error('Forbidden');

      const request = await getInviteRequestById(input.requestId);
      if (!request) throw new Error('Request not found');
      if (request.status !== 'pending') throw new Error('Request already reviewed');

      await updateInviteRequestStatus(input.requestId, 'denied', ctx.user.id, input.reviewNote);

      return { success: true };
    }),

  // ─── Invite Code Management Procedures ──────────────────────────────────────

  /**
   * Admin: List all invite codes with status
   */
  listInviteCodes: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== 'admin') throw new Error('Forbidden');
    const codes = await getAllInviteCodes();
    // Enrich with user info for usedBy
    const db = await getDb();
    if (!db) throw new Error('Database not available');
    const enriched = await Promise.all(codes.map(async (c) => {
      let usedByEmail: string | null = null;
      if (c.usedBy) {
        const userRows = await db.select({ email: users.email }).from(users).where(eq(users.id, c.usedBy)).limit(1);
        usedByEmail = userRows[0]?.email ?? null;
      }
      return { ...c, usedByEmail };
    }));
    return enriched;
  }),

  /**
   * Admin: Create a new invite code manually
   */
  createInviteCodeManual: protectedProcedure
    .input(z.object({
      email: z.string().email(),
      expiresInDays: z.number().int().min(1).max(365).default(30),
    }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== 'admin') throw new Error('Forbidden');
      const code = `SS-${nanoid(12).toUpperCase()}`;
      const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
      await createInviteCode({ code, email: input.email, createdBy: ctx.user.id, expiresAt });
      return { success: true, code, expiresAt };
    }),

  /**
   * Admin: Update expiration date of an invite code
   */
  updateInviteCodeExpiry: protectedProcedure
    .input(z.object({
      id: z.number(),
      expiresAt: z.union([z.date(), z.string()]).transform((val) => val instanceof Date ? val : new Date(val)),
    }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== 'admin') throw new Error('Forbidden');
      const code = await getInviteCodeById(input.id);
      if (!code) throw new Error('Invite code not found');
      await updateInviteCodeExpiry(input.id, input.expiresAt);
      return { success: true };
    }),

  /**
   * Admin: Revoke an invite code (marks as used without a real user)
   */
  revokeInviteCode: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== 'admin') throw new Error('Forbidden');
      const code = await getInviteCodeById(input.id);
      if (!code) throw new Error('Invite code not found');
      if (code.isUsed) throw new Error('Code is already used or revoked');
      await revokeInviteCode(input.id);
      return { success: true };
    }),

  /**
   * Admin: Permanently delete an invite code
   */
  deleteInviteCode: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== 'admin') throw new Error('Forbidden');
      await deleteInviteCode(input.id);
      return { success: true };
    }),
});
