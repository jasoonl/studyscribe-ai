import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import { createRecording, getRecordingsByUserId, getRecordingById as getRecordingByIdDb, updateRecordingStatus, createTranscript, getTranscriptByRecordingId, createStudyNote, getStudyNotesByRecordingId, createFlashcard, getFlashcardsByRecordingId, addChatMessage, getChatHistoryByRecordingId, softDeleteRecording, getDeletedRecordingsByUserId, restoreRecording, getDb } from "./db";
import { storagePut } from "./storage";
import { transcribeAudio } from "./_core/voiceTranscription";
import { invokeLLM } from "./_core/llm";
import { eq } from "drizzle-orm";
import { recordings } from "../drizzle/schema";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  recordings: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getRecordingsByUserId(ctx.user.id);
    }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const recording = await getRecordingByIdDb(input.id);
        if (!recording || recording.userId !== ctx.user.id) {
          throw new Error("Recording not found");
        }
        return recording;
      }),

    create: protectedProcedure
      .input(z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        audience: z.enum(["student", "professional"]),
        audioBase64: z.string(),
        duration: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Convert base64 to buffer
        const base64Data = input.audioBase64.split(',')[1] || input.audioBase64;
        const audioBuffer = Buffer.from(base64Data, 'base64');
        
        // Determine correct MIME type and extension based on browser encoding
        const mimeType = input.audioBase64.includes('audio/webm') ? 'audio/webm' : 'audio/wav';
        const extension = mimeType === 'audio/webm' ? 'webm' : 'wav';
        
        // Upload audio to S3 with correct format
        const fileKey = `${ctx.user.id}/recordings/${Date.now()}.${extension}`;
        const { url: audioUrl } = await storagePut(fileKey, audioBuffer, mimeType);

        // Create recording in database
        await createRecording({
          userId: ctx.user.id,
          title: input.title,
          description: input.description,
          audience: input.audience,
          audioUrl,
          audioKey: fileKey,
          duration: input.duration || 0,
        });

        // Get the created recording (query by audioKey since we just created it)
        const recordings = await getRecordingsByUserId(ctx.user.id);
        const recording = recordings.find(r => r.audioKey === fileKey);

        if (!recording) {
          throw new Error("Failed to create recording");
        }

        // Start transcription in background (fire and forget)
        transcribeRecordingInBackground(recording.id, audioUrl, input.audience);

        return recording;
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const recording = await getRecordingByIdDb(input.id);
        if (!recording || recording.userId !== ctx.user.id) {
          throw new Error("Recording not found");
        }
        await softDeleteRecording(input.id);
        return { success: true };
      }),

    listDeleted: protectedProcedure.query(async ({ ctx }) => {
      return getDeletedRecordingsByUserId(ctx.user.id);
    }),

    restore: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const recording = await getRecordingByIdDb(input.id);
        if (!recording || recording.userId !== ctx.user.id) {
          throw new Error("Recording not found");
        }
        await restoreRecording(input.id);
        return { success: true };
      }),

    permanentDelete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const recording = await getRecordingByIdDb(input.id);
        if (!recording || recording.userId !== ctx.user.id) {
          throw new Error("Recording not found");
        }
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        await db.delete(recordings).where(eq(recordings.id, input.id));
        return { success: true };
      }),
  }),

  transcription: router({
    get: protectedProcedure
      .input(z.object({ recordingId: z.number() }))
      .query(async ({ input, ctx }) => {
        const recording = await getRecordingByIdDb(input.recordingId);
        if (!recording || recording.userId !== ctx.user.id) {
          throw new Error("Recording not found");
        }
        return getTranscriptByRecordingId(input.recordingId);
      }),
  }),

  ai: router({
    getStudyNotes: protectedProcedure
      .input(z.object({ recordingId: z.number() }))
      .query(async ({ input, ctx }) => {
        const recording = await getRecordingByIdDb(input.recordingId);
        if (!recording || recording.userId !== ctx.user.id) {
          throw new Error("Recording not found");
        }
        return getStudyNotesByRecordingId(input.recordingId);
      }),

    generateStudyNotes: protectedProcedure
      .input(z.object({ recordingId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const recording = await getRecordingByIdDb(input.recordingId);
        if (!recording || recording.userId !== ctx.user.id) {
          throw new Error("Recording not found");
        }

        const transcript = await getTranscriptByRecordingId(input.recordingId);
        if (!transcript) {
          throw new Error("Transcript not available");
        }

        // Generate study notes using LLM
        const prompt = recording.audience === "student"
          ? `Analyze this lecture transcript and create comprehensive study notes. Include: 1) Key Concepts (main ideas), 2) Important Formulas (if any), 3) Reading Assignments (topics to explore further). Format as clear, organized notes.\n\nTranscript:\n${transcript.fullText}`
          : `Analyze this meeting transcript and create executive summary. Include: 1) Key Decisions (what was decided), 2) Action Items (tasks with owners), 3) Deadlines (important dates). Format as clear, actionable items.\n\nTranscript:\n${transcript.fullText}`;

        const response = await invokeLLM({
          messages: [
            { role: "system", content: "You are an expert at creating concise, well-organized study notes and meeting summaries." },
            { role: "user", content: prompt },
          ],
        });

        const content = typeof response.choices[0].message.content === "string"
          ? response.choices[0].message.content
          : "";

        // Save study notes
        const noteType = recording.audience === "student" ? "key_concepts" : "summary";
        await createStudyNote({
          recordingId: input.recordingId,
          userId: ctx.user.id,
          type: noteType,
          content,
        });

        return { success: true, content };
      }),

    getFlashcards: protectedProcedure
      .input(z.object({ recordingId: z.number() }))
      .query(async ({ input, ctx }) => {
        const recording = await getRecordingByIdDb(input.recordingId);
        if (!recording || recording.userId !== ctx.user.id) {
          throw new Error("Recording not found");
        }
        return getFlashcardsByRecordingId(input.recordingId);
      }),

    generateFlashcards: protectedProcedure
      .input(z.object({ recordingId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const recording = await getRecordingByIdDb(input.recordingId);
        if (!recording || recording.userId !== ctx.user.id) {
          throw new Error("Recording not found");
        }

        const transcript = await getTranscriptByRecordingId(input.recordingId);
        if (!transcript) {
          throw new Error("Transcript not available");
        }

        // Generate flashcards using LLM
        const response = await invokeLLM({
          messages: [
            { role: "system", content: "You are an expert at creating effective flashcard questions and answers. Return valid JSON only." },
            { role: "user", content: `Create 10 flashcards from this transcript. Return as JSON array with objects: {question: string, answer: string, difficulty: "easy" | "medium" | "hard"}.\n\nTranscript:\n${transcript.fullText}` },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "flashcards",
              strict: true,
              schema: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    question: { type: "string" },
                    answer: { type: "string" },
                    difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
                  },
                  required: ["question", "answer", "difficulty"],
                },
              },
            },
          },
        });

        const content = typeof response.choices[0].message.content === "string"
          ? response.choices[0].message.content
          : "[]";

        try {
          const flashcards = JSON.parse(content);
          for (const card of flashcards) {
            await createFlashcard({
              recordingId: input.recordingId,
              userId: ctx.user.id,
              question: card.question,
              answer: card.answer,
              difficulty: card.difficulty || "medium",
            });
          }
          return { success: true, count: flashcards.length };
        } catch (error) {
          console.error("Failed to parse flashcards:", error);
          throw new Error("Failed to generate flashcards");
        }
      }),

    getChatHistory: protectedProcedure
      .input(z.object({ recordingId: z.number() }))
      .query(async ({ input, ctx }) => {
        const recording = await getRecordingByIdDb(input.recordingId);
        if (!recording || recording.userId !== ctx.user.id) {
          throw new Error("Recording not found");
        }
        return getChatHistoryByRecordingId(input.recordingId);
      }),

    assistantChat: protectedProcedure
      .input(z.object({
        recordingId: z.number(),
        message: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        const recording = await getRecordingByIdDb(input.recordingId);
        if (!recording || recording.userId !== ctx.user.id) {
          throw new Error("Recording not found");
        }

        const transcript = await getTranscriptByRecordingId(input.recordingId);
        if (!transcript) {
          throw new Error("Transcript not available");
        }

        // Save user message
        await addChatMessage({
          recordingId: input.recordingId,
          userId: ctx.user.id,
          role: "user",
          content: input.message,
        });

        // Get chat history for context
        const chatHistory = await getChatHistoryByRecordingId(input.recordingId);

        // Build system prompt based on audience
        const systemPrompt = recording.audience === "student"
          ? `You are a Socratic tutor helping a student understand lecture material. Ask probing questions to help them think deeper, rather than giving direct answers. Ground all responses in the provided lecture transcript.`
          : `You are a professional assistant helping with meeting insights. Provide concise, actionable answers based on the meeting transcript.`;

        // Prepare messages for LLM
        const messages = [
          { role: "system" as const, content: `${systemPrompt}\n\nLecture/Meeting Transcript:\n${transcript.fullText}` },
          ...chatHistory.map(msg => ({
            role: msg.role as "user" | "assistant",
            content: msg.content,
          })),
        ];

        // Get AI response
        const response = await invokeLLM({ messages });

        const assistantMessage = typeof response.choices[0].message.content === "string"
          ? response.choices[0].message.content
          : "";

        // Save assistant message
        await addChatMessage({
          recordingId: input.recordingId,
          userId: ctx.user.id,
          role: "assistant",
          content: assistantMessage,
        });

        return { message: assistantMessage };
      }),
  }),
});

export type AppRouter = typeof appRouter;

// Helper function to transcribe recording in background
async function transcribeRecordingInBackground(recordingId: number, audioUrl: string, _audience: "student" | "professional") {
  try {
    // Transcribe audio
    const result = await transcribeAudio({
      audioUrl,
      language: "en",
      prompt: _audience === "student" ? "This is a lecture recording" : "This is a meeting recording",
    });

    // Check for errors
    if ("error" in result) {
      console.error("Transcription error:", result);
      await updateRecordingStatus(recordingId, "failed");
      return;
    }

    // Validate result has required fields
    if (!result.text || typeof result.text !== 'string') {
      console.error("Invalid transcription response:", result);
      await updateRecordingStatus(recordingId, "failed");
      return;
    }

    // Get recording to get userId
    const recording = await getRecordingByIdDb(recordingId);
    if (!recording) {
      console.error("Recording not found:", recordingId);
      await updateRecordingStatus(recordingId, "failed");
      return;
    }

    // Save transcript
    await createTranscript({
      recordingId,
      userId: recording.userId,
      fullText: result.text,
      language: result.language || "en",
    });

    // Update recording status
    await updateRecordingStatus(recordingId, "completed");
  } catch (error) {
    console.error("Transcription failed:", error);
    await updateRecordingStatus(recordingId, "failed");
  }
}
