import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { UsageLimitError } from "../usageRules";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // A used-up monthly allowance: lets the client offer a link to Billing.
    const usageLimit = error.cause instanceof UsageLimitError ? { kind: error.cause.kind, upgradeAvailable: error.cause.upgradeAvailable } : null;
    return { ...shape, data: { ...shape.data, usageLimit } };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

/**
 * Signed-in in the browser, not through a personal API key: for managing API
 * keys, billing, team billing and deleting the account. A leaked key must
 * never be able to do any of these.
 */
export const sessionProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.apiKey) {
    throw new TRPCError({ code: "FORBIDDEN", message: "API keys cannot do this. Sign in to StudyScribe instead." });
  }
  return next();
});

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
