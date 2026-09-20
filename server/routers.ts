import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import { createRecording, getRecordingsByUserId, getRecordingById as getRecordingByIdDb, updateRecordingStatus, createTranscript, getTranscriptByRecordingId, updateTranscriptText, createStudyNote, getStudyNotesByRecordingId, createFlashcard, getFlashcardsByRecordingId, getFlashcardReviewsByRecordingId, recordFlashcardReview, addChatMessage, getChatHistoryByRecordingId, softDeleteRecording, getDeletedRecordingsByUserId, restoreRecording, getDb, createStudyGuide, getStudyGuidesByRecordingId, getStudyGuideById, createQuiz, getQuizzesByRecordingId, getQuizById, createQuizAttempt, getQuizAttemptsByQuizId, createEmailDraft, getEmailDraftsByRecordingId, getEmailDraftById, searchTranscripts, deletePushSubscription, upsertPushSubscription, getProcessingRecordings, setRecordingTranscriptionProviderId } from "./db";
import { storageGet, storagePut, storageGetSignedUrl, verifyUploadedAudio, assertSignedAudioUrlIsFetchable } from "./storage";
import { isAssemblyAiWebhookConfigured, submitSpeakerDiarization, transcribeWithSpeakerDiarization } from "./speakerDiarization";
import { getBrowserPushConfiguration, sendBrowserPush } from "./pushNotifications";
import { invokeLLM } from "./_core/llm";
import { eq } from "drizzle-orm";
import { recordings, userNotifications } from "../drizzle/schema";
import { notificationsRouter } from "./notificationsRouter";
import { customAuthRouter } from "./customAuthRouter";
import { sharingRouter } from "./sharingRouter";
import { customNotificationInputSchema, dismissNotificationInputSchema } from "./notificationInput";
import { transcriptUpdateInputSchema } from "./transcriptInput";
import { desc, and } from "drizzle-orm";
import { createHash } from "crypto";

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
  customAuth: customAuthRouter,

  browserPush: router({
    configuration: protectedProcedure.query(() => getBrowserPushConfiguration()),
    subscribe: protectedProcedure
      .input(z.object({
        endpoint: z.string().url().max(768),
        expirationTime: z.number().nullable(),
        keys: z.object({
          p256dh: z.string().min(20).max(255),
          auth: z.string().min(16).max(255),
        }),
      }))
      .mutation(async ({ ctx, input }) => {
        const endpointHash = createHash("sha256").update(input.endpoint).digest("hex");
        await upsertPushSubscription({
          userId: ctx.user.id,
          endpoint: input.endpoint,
          endpointHash,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          expirationTime: input.expirationTime ? new Date(input.expirationTime) : null,
        });
        return { success: true };
      }),
    unsubscribe: protectedProcedure
      .input(z.object({ endpoint: z.string().url().max(768) }))
      .mutation(async ({ ctx, input }) => {
        const endpointHash = createHash("sha256").update(input.endpoint).digest("hex");
        await deletePushSubscription(ctx.user.id, endpointHash);
        return { success: true };
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
        audioBase64: z.string().optional(),
        audioUpload: z.object({
          key: z.string().min(1).max(512),
          mimeType: z.string().min(1).max(100),
        }).optional(),
        duration: z.number().optional(),
      }).refine((value) => Boolean(value.audioBase64 || value.audioUpload), {
        message: "Audio data is required",
      }))
      .mutation(async ({ input, ctx }) => {
        // Map MIME types to file extensions
        const mimeToExt: Record<string, string> = {
          'audio/mpeg': 'mp3',
          'audio/mp3': 'mp3',
          'audio/wav': 'wav',
          'audio/wave': 'wav',
          'audio/x-wav': 'wav',
          'audio/ogg': 'ogg',
          'audio/webm': 'webm',
          'audio/mp4': 'mp4',
          'audio/m4a': 'm4a',
          'audio/x-m4a': 'm4a',
          'video/mp4': 'mp4',
          'video/webm': 'webm',
        };
        
        let mimeType: string;
        let audioUrl: string;
        let actualFileKey: string;

        if (input.audioUpload) {
          if (!input.audioUpload.key.startsWith(`${ctx.user.id}/recordings/`)) {
            throw new Error("Invalid recording upload reference");
          }
          if (!mimeToExt[input.audioUpload.mimeType]) {
            throw new Error("Unsupported recording format");
          }
          mimeType = input.audioUpload.mimeType;
          actualFileKey = input.audioUpload.key;
          const uploaded = await verifyUploadedAudio(actualFileKey);
          console.log(`[Upload] Verified blob ${actualFileKey}: ${uploaded.size} bytes, stored as ${uploaded.contentType}`);
          ({ url: audioUrl } = await storageGet(actualFileKey));
        } else {
          const audioBase64 = input.audioBase64!;
          const mimeMatch = audioBase64.match(/^data:([^;]+);/);
          mimeType = mimeMatch ? mimeMatch[1] : "audio/wav";
          const extension = mimeToExt[mimeType] || "mp3";
          const base64Data = audioBase64.split(",")[1] || audioBase64;
          const audioBuffer = Buffer.from(base64Data, "base64");
          const fileKeyInput = `${ctx.user.id}/recordings/${Date.now()}.${extension}`;
          ({ url: audioUrl, key: actualFileKey } = await storagePut(fileKeyInput, audioBuffer, mimeType));
        }

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

        // Vercel uses an authenticated provider webhook; Manus retains the tested
        // in-process fallback while external provider settings are being completed.
        if (isAssemblyAiWebhookConfigured()) {
          try {
            const signedUrl = await storageGetSignedUrl(actualFileKey);
            await assertSignedAudioUrlIsFetchable(signedUrl);
            const webhookUrl = new URL("/api/webhooks/assemblyai", process.env.PUBLIC_APP_URL).toString();
            const { providerId } = await submitSpeakerDiarization({ audioUrl: signedUrl, webhookUrl });
            await setRecordingTranscriptionProviderId(recording.id, providerId);
          } catch (error) {
            await updateRecordingStatus(recording.id, "failed");
            throw error;
          }
        } else {
          console.log(`[Upload] Starting background transcription for recording ${recording.id}, mimeType: ${mimeType}`);
          transcribeRecordingInBackground(recording.id, actualFileKey, input.audience, mimeType).catch(err => {
            console.error(`[Upload] Unhandled error in background transcription for recording ${recording.id}:`, err);
          });
        }

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

    // Lightweight status poll — used by Upload/Record pages to detect transcription completion
    getStatus: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const recording = await getRecordingByIdDb(input.id);
        if (!recording || recording.userId !== ctx.user.id) {
          throw new Error("Recording not found");
        }
        return { id: recording.id, status: recording.status };
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

    update: protectedProcedure
      .input(transcriptUpdateInputSchema)
      .mutation(async ({ input, ctx }) => {
        const recording = await getRecordingByIdDb(input.recordingId);
        if (!recording || recording.userId !== ctx.user.id) {
          throw new Error("Recording not found");
        }

        const transcript = await getTranscriptByRecordingId(input.recordingId);
        if (!transcript || transcript.userId !== ctx.user.id) {
          throw new Error("Transcript not found");
        }

        const updated = await updateTranscriptText({ ...input, userId: ctx.user.id });
        if (!updated) throw new Error("Failed to save transcript");
        return updated;
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

    getFlashcardReviews: protectedProcedure
      .input(z.object({ recordingId: z.number() }))
      .query(async ({ input, ctx }) => {
        const recording = await getRecordingByIdDb(input.recordingId);
        if (!recording || recording.userId !== ctx.user.id) {
          throw new Error("Recording not found");
        }
        return getFlashcardReviewsByRecordingId(ctx.user.id, input.recordingId);
      }),

    reviewFlashcard: protectedProcedure
      .input(z.object({
        recordingId: z.number(),
        flashcardId: z.number(),
        status: z.enum(["new", "learning", "mastered"]),
      }))
      .mutation(async ({ input, ctx }) => {
        const recording = await getRecordingByIdDb(input.recordingId);
        if (!recording || recording.userId !== ctx.user.id) {
          throw new Error("Recording not found");
        }

        const cards = await getFlashcardsByRecordingId(input.recordingId);
        const flashcard = cards.find((card) => card.id === input.flashcardId && card.userId === ctx.user.id);
        if (!flashcard) {
          throw new Error("Flashcard not found");
        }

        return recordFlashcardReview({ ...input, userId: ctx.user.id });
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
  notifications: notificationsRouter,
  sharing: sharingRouter,

  studyGuides: router({
    list: protectedProcedure
      .input(z.object({ recordingId: z.number() }))
      .query(async ({ input, ctx }) => {
        const recording = await getRecordingByIdDb(input.recordingId);
        if (!recording || recording.userId !== ctx.user.id) throw new Error("Recording not found");
        return getStudyGuidesByRecordingId(input.recordingId);
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const guide = await getStudyGuideById(input.id);
        if (!guide) throw new Error("Study guide not found");
        const recording = await getRecordingByIdDb(guide.recordingId);
        if (!recording || recording.userId !== ctx.user.id) throw new Error("Access denied");
        return guide;
      }),

    generate: protectedProcedure
      .input(z.object({ recordingId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const recording = await getRecordingByIdDb(input.recordingId);
        if (!recording || recording.userId !== ctx.user.id) throw new Error("Recording not found");

        const transcript = await getTranscriptByRecordingId(input.recordingId);
        if (!transcript?.fullText?.trim()) throw new Error("Transcript not available yet. Please wait for transcription to complete.");

        const isStudent = recording.audience === "student";
        const systemPrompt = isStudent
          ? "You are an expert educator. Create a comprehensive, well-structured study guide from this lecture transcript. Use markdown formatting with headers, bullet points, and emphasis."
          : "You are a professional analyst. Create a comprehensive meeting summary and action guide from this transcript. Use markdown formatting with headers, bullet points, and emphasis.";

        const userPrompt = isStudent
          ? `Create a detailed study guide from this lecture transcript. Include:\n- ## Overview (2-3 sentence summary)\n- ## Key Concepts (main ideas with explanations)\n- ## Important Details (supporting facts, examples)\n- ## Key Takeaways (what to remember)\n- ## Review Questions (3-5 self-test questions)\n\nTranscript:\n${transcript.fullText}`
          : `Create a comprehensive meeting guide from this transcript. Include:\n- ## Executive Summary (2-3 sentences)\n- ## Key Decisions (what was decided)\n- ## Action Items (tasks, owners, deadlines)\n- ## Discussion Points (main topics covered)\n- ## Next Steps (follow-up actions)\n\nTranscript:\n${transcript.fullText}`;

        const response = await invokeLLM({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        });

        const content = typeof response.choices[0].message.content === "string"
          ? response.choices[0].message.content : "";
        if (!content.trim()) throw new Error("LLM returned empty content");

        // Extract key points from content (first-level bullet points)
        const keyPoints = content
          .split("\n")
          .filter(line => line.match(/^[-*•]\s+/) || line.match(/^\d+\.\s+/))
          .slice(0, 8)
          .map(line => line.replace(/^[-*•\d.]+\s+/, "").trim())
          .filter(Boolean);

        const title = isStudent ? `Study Guide: ${recording.title}` : `Meeting Guide: ${recording.title}`;
        await createStudyGuide({ recordingId: input.recordingId, userId: ctx.user.id, title, content, keyPoints });
        return { success: true, title, content };
      }),
  }),

  quizzes: router({
    list: protectedProcedure
      .input(z.object({ recordingId: z.number() }))
      .query(async ({ input, ctx }) => {
        const recording = await getRecordingByIdDb(input.recordingId);
        if (!recording || recording.userId !== ctx.user.id) throw new Error("Recording not found");
        return getQuizzesByRecordingId(input.recordingId);
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const quiz = await getQuizById(input.id);
        if (!quiz) throw new Error("Quiz not found");
        const recording = await getRecordingByIdDb(quiz.recordingId);
        if (!recording || recording.userId !== ctx.user.id) throw new Error("Access denied");
        return quiz;
      }),

    generate: protectedProcedure
      .input(z.object({ recordingId: z.number(), questionCount: z.number().min(3).max(20).default(10) }))
      .mutation(async ({ input, ctx }) => {
        const recording = await getRecordingByIdDb(input.recordingId);
        if (!recording || recording.userId !== ctx.user.id) throw new Error("Recording not found");

        const transcript = await getTranscriptByRecordingId(input.recordingId);
        if (!transcript?.fullText?.trim()) throw new Error("Transcript not available yet.");

        const response = await invokeLLM({
          messages: [
            { role: "system", content: "You are an expert at creating educational quizzes. Return valid JSON only with no markdown code blocks." },
            { role: "user", content: `Create ${input.questionCount} quiz questions from this transcript. Mix multiple-choice (80%) and short-answer (20%) questions. Return a JSON object: {\"title\": string, \"description\": string, \"questions\": [{\"id\": string, \"question\": string, \"type\": \"multiple-choice\" | \"short-answer\", \"options\": string[] (for MC only), \"correctAnswer\": string, \"explanation\": string}]}\n\nTranscript:\n${transcript.fullText}` },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "quiz",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                  questions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        question: { type: "string" },
                        type: { type: "string", enum: ["multiple-choice", "short-answer"] },
                        options: { type: "array", items: { type: "string" } },
                        correctAnswer: { type: "string" },
                        explanation: { type: "string" },
                      },
                      required: ["id", "question", "type", "correctAnswer", "explanation"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["title", "description", "questions"],
                additionalProperties: false,
              },
            },
          },
        });

        const raw = typeof response.choices[0].message.content === "string" ? response.choices[0].message.content : "{}";
        const parsed = JSON.parse(raw);
        if (!parsed.questions?.length) throw new Error("No questions generated");

        await createQuiz({
          recordingId: input.recordingId,
          userId: ctx.user.id,
          title: parsed.title || `Quiz: ${recording.title}`,
          description: parsed.description,
          questions: parsed.questions,
        });
        return { success: true, title: parsed.title, questionCount: parsed.questions.length };
      }),

    submitAttempt: protectedProcedure
      .input(z.object({
        quizId: z.number(),
        answers: z.record(z.string(), z.string()),
      }))
      .mutation(async ({ input, ctx }) => {
        const quiz = await getQuizById(input.quizId);
        if (!quiz) throw new Error("Quiz not found");
        const recording = await getRecordingByIdDb(quiz.recordingId);
        if (!recording || recording.userId !== ctx.user.id) throw new Error("Access denied");

        const questions = (quiz.questions as any[]) || [];
        let correct = 0;
        for (const q of questions) {
          const userAnswer = input.answers[q.id]?.trim().toLowerCase();
          const correctAnswer = q.correctAnswer?.trim().toLowerCase();
          if (userAnswer && correctAnswer && (userAnswer === correctAnswer || (q.type === "multiple-choice" && userAnswer === correctAnswer))) {
            correct++;
          }
        }
        const score = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 0;
        await createQuizAttempt({ quizId: input.quizId, userId: ctx.user.id, answers: input.answers, score });
        return { score, correct, total: questions.length };
      }),

    getAttempts: protectedProcedure
      .input(z.object({ quizId: z.number() }))
      .query(async ({ input, ctx }) => {
        const quiz = await getQuizById(input.quizId);
        if (!quiz) throw new Error("Quiz not found");
        const recording = await getRecordingByIdDb(quiz.recordingId);
        if (!recording || recording.userId !== ctx.user.id) throw new Error("Access denied");
        return getQuizAttemptsByQuizId(input.quizId, ctx.user.id);
      }),
  }),

  emailDrafts: router({
    list: protectedProcedure
      .input(z.object({ recordingId: z.number() }))
      .query(async ({ input, ctx }) => {
        const recording = await getRecordingByIdDb(input.recordingId);
        if (!recording || recording.userId !== ctx.user.id) throw new Error("Recording not found");
        return getEmailDraftsByRecordingId(input.recordingId);
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const draft = await getEmailDraftById(input.id);
        if (!draft) throw new Error("Email draft not found");
        const recording = await getRecordingByIdDb(draft.recordingId);
        if (!recording || recording.userId !== ctx.user.id) throw new Error("Access denied");
        return draft;
      }),

    generate: protectedProcedure
      .input(z.object({
        recordingId: z.number(),
        draftType: z.enum(["email-summary", "document", "report"]).default("email-summary"),
        tone: z.enum(["formal", "casual", "technical", "persuasive"]).default("formal"),
      }))
      .mutation(async ({ input, ctx }) => {
        const recording = await getRecordingByIdDb(input.recordingId);
        if (!recording || recording.userId !== ctx.user.id) throw new Error("Recording not found");

        const transcript = await getTranscriptByRecordingId(input.recordingId);
        if (!transcript?.fullText?.trim()) throw new Error("Transcript not available yet.");

        const typeLabels = { "email-summary": "Email Summary", document: "Document", report: "Report" };
        const typeLabel = typeLabels[input.draftType];

        const toneInstructions: Record<string, string> = {
          formal: "Use formal, professional language with proper grammar and structure.",
          casual: "Use conversational, friendly language that's easy to read and relatable.",
          technical: "Use technical terminology and detailed explanations suitable for experts.",
          persuasive: "Use persuasive language that convinces and motivates the reader to take action.",
        };
        const toneInstruction = toneInstructions[input.tone];

        const prompts: Record<string, { system: string; user: string }> = {
          "email-summary": {
            system: `You are a professional writer who creates clear, concise email summaries. ${toneInstruction} Return JSON with fields: subject, body.`,
            user: `Write a professional email summary of this ${recording.audience === "student" ? "lecture" : "meeting"}. The email should be suitable to send to colleagues or classmates who missed it.\n\nTranscript:\n${transcript.fullText}`,
          },
          document: {
            system: `You are a professional technical writer. ${toneInstruction} Return JSON with fields: subject, body (markdown formatted document).`,
            user: `Create a well-structured document summarizing this ${recording.audience === "student" ? "lecture" : "meeting"}. Include all key information in a professional format.\n\nTranscript:\n${transcript.fullText}`,
          },
          report: {
            system: `You are a professional report writer. ${toneInstruction} Return JSON with fields: subject, body (markdown formatted report with sections).`,
            user: `Write a formal report based on this ${recording.audience === "student" ? "lecture" : "meeting"} transcript. Include executive summary, key findings, and recommendations.\n\nTranscript:\n${transcript.fullText}`,
          },
        };

        const { system, user } = prompts[input.draftType];
        const response = await invokeLLM({
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "email_draft",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  subject: { type: "string" },
                  body: { type: "string" },
                },
                required: ["subject", "body"],
                additionalProperties: false,
              },
            },
          },
        });

        const raw = typeof response.choices[0].message.content === "string" ? response.choices[0].message.content : "{}";
        const parsed = JSON.parse(raw);
        if (!parsed.body?.trim()) throw new Error("LLM returned empty content");

        const title = `${typeLabel}: ${recording.title}`;
        await createEmailDraft({
          recordingId: input.recordingId,
          userId: ctx.user.id,
          title,
          subject: parsed.subject || title,
          content: parsed.body,
          draftType: input.draftType,
          tone: input.tone,
        });
        return { success: true, title, subject: parsed.subject, content: parsed.body };
      }),
  }),

  knowledgeBase: router({
    search: protectedProcedure
      .input(z.object({ query: z.string().min(1).max(200) }))
      .query(async ({ ctx, input }) => {
        if (input.query.trim().length < 2) return [];
        const results = await searchTranscripts(ctx.user.id, input.query.trim());
        return results.map((r) => {
          let snippet = "";
          if (r.transcriptContent) {
            const lower = r.transcriptContent.toLowerCase();
            const idx = lower.indexOf(input.query.toLowerCase());
            if (idx !== -1) {
              const start = Math.max(0, idx - 80);
              const end = Math.min(r.transcriptContent.length, idx + input.query.length + 80);
              snippet = (start > 0 ? "..." : "") + r.transcriptContent.slice(start, end) + (end < r.transcriptContent.length ? "..." : "");
            } else {
              snippet = r.transcriptContent.slice(0, 160) + (r.transcriptContent.length > 160 ? "..." : "");
            }
          }
          return {
            recordingId: r.recordingId,
            recordingTitle: r.recordingTitle,
            recordingCreatedAt: r.recordingCreatedAt,
            recordingDuration: r.recordingDuration,
            transcriptStatus: r.transcriptStatus,
            snippet,
          };
        });
      }),
  }),

  userNotifications: router({
    list: protectedProcedure
      .query(async ({ ctx }) => {
        const db = await getDb();
        if (!db) return [];
        const notifs = await db
          .select()
          .from(userNotifications)
          .where(eq(userNotifications.userId, ctx.user.id))
          .orderBy(desc(userNotifications.createdAt))
          .limit(20);
        return notifs;
      }),
    create: protectedProcedure
      .input(customNotificationInputSchema)
      .mutation(async ({ ctx, input }) => {
        if (input.recordingId) {
          const recording = await getRecordingByIdDb(input.recordingId);
          if (!recording || recording.userId !== ctx.user.id) {
            throw new Error("Recording not found");
          }
        }

        const db = await getDb();
        if (!db) throw new Error("Database not available");
        await db.insert(userNotifications).values({
          userId: ctx.user.id,
          type: input.type,
          title: input.title,
          message: input.message,
          recordingId: input.recordingId,
          isRead: 0,
        });
        try {
          await sendBrowserPush(ctx.user.id, {
            title: input.title,
            body: input.message,
            url: input.recordingId ? `/recording/${input.recordingId}` : "/dashboard",
            tag: `reminder-${ctx.user.id}-${Date.now()}`,
          });
        } catch (error) {
          // Persisted notifications remain available even when a browser endpoint has expired.
          console.error("[Notifications] Browser push delivery failed", error);
        }
        return { success: true };
      }),
    markRead: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) return { success: false };
        await db
          .update(userNotifications)
          .set({ isRead: 1, readAt: new Date() })
          .where(and(eq(userNotifications.id, input.id), eq(userNotifications.userId, ctx.user.id)));
        return { success: true };
      }),
    markAllRead: protectedProcedure
      .mutation(async ({ ctx }) => {
        const db = await getDb();
        if (!db) return { success: false };
        await db
          .update(userNotifications)
          .set({ isRead: 1, readAt: new Date() })
          .where(and(eq(userNotifications.userId, ctx.user.id), eq(userNotifications.isRead, 0)));
        return { success: true };
      }),
    dismiss: protectedProcedure
      .input(dismissNotificationInputSchema)
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        await db
          .delete(userNotifications)
          .where(and(eq(userNotifications.id, input.id), eq(userNotifications.userId, ctx.user.id)));
        return { success: true };
      }),
    unreadCount: protectedProcedure
      .query(async ({ ctx }) => {
        const db = await getDb();
        if (!db) return { count: 0 };
        const all = await db
          .select()
          .from(userNotifications)
          .where(and(eq(userNotifications.userId, ctx.user.id), eq(userNotifications.isRead, 0)));
        return { count: all.length };
      }),
  }),

  analytics: router({
    overview: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new Error('Database not available');
      const { recordings: rec, transcripts, flashcards, chatHistory: chat, studyGuides, quizzes, emailDrafts } = await import('../drizzle/schema');
      const { count, eq, and, gte, sql } = await import('drizzle-orm');

      const userId = ctx.user.id;
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const [totalRecordings] = await db.select({ count: count() }).from(rec).where(and(eq(rec.userId, userId), eq(rec.isDeleted, 0)));
      const [totalTranscripts] = await db.select({ count: count() }).from(transcripts).where(eq(transcripts.userId, userId));
      const [totalFlashcards] = await db.select({ count: count() }).from(flashcards).where(eq(flashcards.userId, userId));
      const [totalStudyGuides] = await db.select({ count: count() }).from(studyGuides).where(eq(studyGuides.userId, userId));
      const [totalQuizzes] = await db.select({ count: count() }).from(quizzes).where(eq(quizzes.userId, userId));
      const [totalEmailDrafts] = await db.select({ count: count() }).from(emailDrafts).where(eq(emailDrafts.userId, userId));
      const [totalChatMessages] = await db.select({ count: count() }).from(chat).where(and(eq(chat.userId, userId), eq(chat.role, 'user')));
      const [recentRecordings] = await db.select({ count: count() }).from(rec).where(and(eq(rec.userId, userId), eq(rec.isDeleted, 0), gte(rec.createdAt, thirtyDaysAgo)));

      // Get recent recordings for activity feed
      const recent = await db.select({
        id: rec.id,
        title: rec.title,
        status: rec.status,
        audience: rec.audience,
        duration: rec.duration,
        createdAt: rec.createdAt,
      }).from(rec).where(and(eq(rec.userId, userId), eq(rec.isDeleted, 0))).orderBy(sql`${rec.createdAt} DESC`).limit(5);

      return {
        totalRecordings: totalRecordings.count,
        totalTranscripts: totalTranscripts.count,
        totalFlashcards: totalFlashcards.count,
        totalStudyGuides: totalStudyGuides.count,
        totalQuizzes: totalQuizzes.count,
        totalEmailDrafts: totalEmailDrafts.count,
        totalChatMessages: totalChatMessages.count,
        recentRecordings: recentRecordings.count,
        recentActivity: recent,
      };
    }),
  }),
});

export type AppRouter = typeof appRouter;

// Helper function to transcribe recording in background
export async function resumeProcessingRecordings(): Promise<void> {
  const processing = await getProcessingRecordings();
  for (const recording of processing) {
    if (!recording.audioKey) continue;
    if (recording.transcriptionProviderId) continue;
    transcribeRecordingInBackground(recording.id, recording.audioKey, recording.audience ?? "student").catch((error) => {
      console.error(`[Transcription] Recovery failed for recording ${recording.id}:`, error);
    });
  }
  if (processing.length > 0) {
    console.log(`[Transcription] Recovery queued ${processing.length} processing recording(s)`);
  }
}

async function transcribeRecordingInBackground(recordingId: number, audioKey: string, _audience: "student" | "professional", mimeType?: string): Promise<void> {
  try {
    console.log(`[Transcription] Starting for recording ${recordingId}, audioKey: ${audioKey}`);
    
    // Get a short-lived signed URL for the asynchronous transcription provider.
    const signedUrl = await storageGetSignedUrl(audioKey);
    await assertSignedAudioUrlIsFetchable(signedUrl);
    console.log(`[Transcription] Requesting speaker-labeled transcript for recording ${recordingId}`);
    const result = await transcribeWithSpeakerDiarization({ audioUrl: signedUrl });

    // Get recording to get userId
    const recording = await getRecordingByIdDb(recordingId);
    if (!recording) {
      console.error("Recording not found:", recordingId);
      await updateRecordingStatus(recordingId, "failed");
      return;
    }

    // Save the normalized, timestamped speaker turns with the full transcript.
    console.log(`[Transcription] Saving speaker-labeled transcript for recording ${recordingId}`);
    await createTranscript({
      recordingId,
      userId: recording.userId,
      fullText: result.text,
      segments: result.segments,
      language: result.language || "en",
    });

    // Update recording status
    console.log(`[Transcription] Marking recording ${recordingId} as completed`);
    await updateRecordingStatus(recordingId, "completed");
    console.log(`[Transcription] Successfully completed recording ${recordingId}`);

    // Keep the existing in-app notification and deliver a push notification to opted-in devices.
    const completedMessage = `"${recording.title}" has been transcribed successfully. You can now use AI study tools.`;
    try {
      const db = await getDb();
      if (db) {
        await db.insert(userNotifications).values({
          userId: recording.userId,
          type: "success",
          title: "Transcription Complete",
          message: completedMessage,
          recordingId,
          isRead: 0,
        });
      }
      await sendBrowserPush(recording.userId, {
        title: "Transcription complete",
        body: `Your speaker-labeled transcript for “${recording.title}” is ready.`,
        url: `/recording/${recordingId}`,
        tag: `recording-${recordingId}`,
      });
    } catch (notifError) {
      console.error(`[Transcription] Failed to create or deliver completion notification:`, notifError);
    }
  } catch (error) {
    console.error(`[Transcription] Failed for recording ${recordingId}:`, error);
    try {
      await updateRecordingStatus(recordingId, "failed");
      // Create failure notification
      const recording = await getRecordingByIdDb(recordingId);
      if (recording) {
        const reason = error instanceof Error ? error.message : "Unknown error";
        const db = await getDb();
        if (db) {
          await db.insert(userNotifications).values({
            userId: recording.userId,
            type: "error",
            title: "Transcription Failed",
            message: `Transcription failed for "${recording.title}": ${reason}`,
            recordingId,
            isRead: 0,
          });
        }
        await sendBrowserPush(recording.userId, {
          title: "Transcription needs attention",
          body: `We could not transcribe “${recording.title}”. Please try uploading it again.`,
          url: `/recording/${recordingId}`,
          tag: `recording-${recordingId}`,
        });
      }
    } catch (updateError) {
      console.error(`[Transcription] Failed to update status for recording ${recordingId}:`, updateError);
    }
  }
}
