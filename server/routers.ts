import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import { createRecording, getRecordingsByUserId, getRecordingById as getRecordingByIdDb, updateRecordingStatus, createTranscript, getTranscriptByRecordingId, createStudyNote, getStudyNotesByRecordingId, createFlashcard, getFlashcardsByRecordingId, addChatMessage, getChatHistoryByRecordingId, softDeleteRecording, getDeletedRecordingsByUserId, restoreRecording, getDb } from "./db";
import { storagePut, storageGetSignedUrl } from "./storage";
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
        const fileKeyInput = `${ctx.user.id}/recordings/${Date.now()}.${extension}`;
        const { url: audioUrl, key: actualFileKey } = await storagePut(fileKeyInput, audioBuffer, mimeType);

        // Create recording in database
        await createRecording({
          userId: ctx.user.id,
          title: input.title,
          description: input.description,
          audience: input.audience,
          audioUrl,
          audioKey: actualFileKey,
          duration: input.duration || 0,
        });

        // Get the created recording (query by audioKey since we just created it)
        const recordings = await getRecordingsByUserId(ctx.user.id);
        const recording = recordings.find(r => r.audioKey === actualFileKey);

        if (!recording) {
          throw new Error("Failed to create recording");
        }

        // Start transcription in background (fire and forget)
        // Pass the audioKey so we can get a signed URL for server-side transcription
        transcribeRecordingInBackground(recording.id, actualFileKey, input.audience);

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
        try {
          const recording = await getRecordingByIdDb(input.recordingId);
          if (!recording || recording.userId !== ctx.user.id) {
            throw new Error("Recording not found");
          }

          const transcript = await getTranscriptByRecordingId(input.recordingId);
          if (!transcript) {
            throw new Error("Transcript not available");
          }

          // Validate transcript has content
          if (!transcript.fullText || transcript.fullText.trim().length === 0) {
            throw new Error("Transcript is empty");
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

          // Validate response structure
          if (!response.choices || response.choices.length === 0) {
            throw new Error("Invalid LLM response: no choices returned");
          }

          const content = typeof response.choices[0].message.content === "string"
            ? response.choices[0].message.content
            : "";

          if (!content || content.trim().length === 0) {
            throw new Error("LLM returned empty content");
          }

          // Save study notes
          const noteType = recording.audience === "student" ? "key_concepts" : "summary";
          await createStudyNote({
            recordingId: input.recordingId,
            userId: ctx.user.id,
            type: noteType,
            content,
          });

          return { success: true, content };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "Unknown error";
          console.error("Study notes generation failed:", errorMsg, error);
          throw new Error(`Failed to generate study notes: ${errorMsg}`);
        }
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
        try {
          const recording = await getRecordingByIdDb(input.recordingId);
          if (!recording || recording.userId !== ctx.user.id) {
            throw new Error("Recording not found");
          }

          const transcript = await getTranscriptByRecordingId(input.recordingId);
          if (!transcript) {
            throw new Error("Transcript not available");
          }

          // Validate transcript has content
          if (!transcript.fullText || transcript.fullText.trim().length === 0) {
            throw new Error("Transcript is empty");
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

          // Validate response structure
          if (!response.choices || response.choices.length === 0) {
            throw new Error("Invalid LLM response: no choices returned");
          }

          const content = typeof response.choices[0].message.content === "string"
            ? response.choices[0].message.content
            : "[]";

          try {
            const flashcards = JSON.parse(content);
            
            // Validate flashcards array
            if (!Array.isArray(flashcards)) {
              throw new Error("Expected array of flashcards");
            }

            if (flashcards.length === 0) {
              throw new Error("No flashcards were generated");
            }

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
          } catch (parseError) {
            const parseMsg = parseError instanceof Error ? parseError.message : "Unknown parse error";
            console.error("Failed to parse flashcards:", parseMsg, parseError);
            throw new Error(`Failed to parse flashcards: ${parseMsg}`);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "Unknown error";
          console.error("Flashcards generation failed:", errorMsg, error);
          throw new Error(`Failed to generate flashcards: ${errorMsg}`);
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
        try {
          const recording = await getRecordingByIdDb(input.recordingId);
          if (!recording || recording.userId !== ctx.user.id) {
            throw new Error("Recording not found");
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

          // Get transcript if available
          const transcript = await getTranscriptByRecordingId(input.recordingId);

          // Build system prompt based on audience and transcript availability
          let systemPrompt = "";
          let transcriptContext = "";
          
          if (recording.audience === "student") {
            systemPrompt = `You are a Socratic tutor helping a student understand lecture material. Ask probing questions to help them think deeper, rather than giving direct answers.`;
            if (transcript?.fullText && transcript.fullText.trim().length > 0) {
              systemPrompt += ` Ground all responses in the provided lecture transcript.`;
              transcriptContext = `\n\nLecture Transcript:\n${transcript.fullText}`;
            }
          } else {
            systemPrompt = `You are a professional assistant helping with meeting insights. Provide concise, actionable answers.`;
            if (transcript?.fullText && transcript.fullText.trim().length > 0) {
              systemPrompt += ` Ground all responses in the provided meeting transcript.`;
              transcriptContext = `\n\nMeeting Transcript:\n${transcript.fullText}`;
            }
          }

          // Prepare messages for LLM
          const messages = [
            { role: "system" as const, content: `${systemPrompt}${transcriptContext}` },
            ...chatHistory.map(msg => ({
              role: msg.role as "user" | "assistant",
              content: msg.content,
            })),
          ];

          // Get AI response
          const response = await invokeLLM({ messages });

          // Validate response structure
          if (!response.choices || response.choices.length === 0) {
            throw new Error("Invalid LLM response: no choices returned");
          }

          const assistantMessage = typeof response.choices[0].message.content === "string"
            ? response.choices[0].message.content
            : "";

          if (!assistantMessage || assistantMessage.trim().length === 0) {
            throw new Error("LLM returned empty response");
          }

          // Save assistant message
          await addChatMessage({
            recordingId: input.recordingId,
            userId: ctx.user.id,
            role: "assistant",
            content: assistantMessage,
          });

          return { message: assistantMessage };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "Unknown error";
          console.error("Assistant chat failed:", errorMsg, error);
          throw new Error(`Failed to process chat: ${errorMsg}`);
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;

// Helper function to transcribe recording in background
async function transcribeRecordingInBackground(recordingId: number, audioKey: string, _audience: "student" | "professional") {
  try {
    // Get signed URL for server-side transcription
    const signedUrl = await storageGetSignedUrl(audioKey);
    
    // Transcribe audio
    const result = await transcribeAudio({
      audioUrl: signedUrl,
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


