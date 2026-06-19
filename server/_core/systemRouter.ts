import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { invokeLLM } from "./llm";
import { ENV } from "./env";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  checkLLMConfig: publicProcedure
    .query(async () => {
      const checks = {
        forgeApiUrl: !!ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0,
        forgeApiKey: !!ENV.forgeApiKey && ENV.forgeApiKey.trim().length > 0,
        llmHealthy: false,
        error: null as string | null,
      };

      if (!checks.forgeApiUrl) {
        checks.error = "BUILT_IN_FORGE_API_URL is not configured";
        return checks;
      }

      if (!checks.forgeApiKey) {
        checks.error = "BUILT_IN_FORGE_API_KEY is not configured";
        return checks;
      }

      try {
        // Test LLM with a simple request
        await invokeLLM({
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "Say OK if you can hear me." },
          ],
        });
        checks.llmHealthy = true;
      } catch (error) {
        checks.error = error instanceof Error ? error.message : "Unknown LLM error";
      }

      return checks;
    }),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),
});
