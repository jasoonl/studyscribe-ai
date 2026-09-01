import { z } from "zod";
import { notifyOwner } from "./notification";
import { getLLMProvider, invokeLLM } from "./llm";
import { adminProcedure, publicProcedure, router } from "./trpc";

export const systemRouter = router({
  health: publicProcedure
    .input(z.object({ timestamp: z.number().min(0, "timestamp cannot be negative") }))
    .query(() => ({ ok: true })),

  checkLLMConfig: publicProcedure.query(async () => {
    const checks = {
      provider: null as "openai" | "manus-forge" | null,
      configured: false,
      llmHealthy: false,
      error: null as string | null,
    };
    try {
      const provider = getLLMProvider();
      checks.provider = provider.name;
      checks.configured = true;
    } catch (error) {
      checks.error = error instanceof Error ? error.message : "AI provider is not configured";
      return checks;
    }

    try {
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
    .input(z.object({ title: z.string().min(1, "title is required"), content: z.string().min(1, "content is required") }))
    .mutation(async ({ input }) => ({ success: await notifyOwner(input) } as const)),
});
