import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import { createRecording, getRecordingsByUserId, getRecordingById as getRecordingByIdDb, updateRecordingStatus, createTranscript, getTranscriptByRecordingId, createStudyNote, getStudyNotesByRecordingId, createFlashcard, getFlashcardsByRecordingId, addChatMessage, getChatHistoryByRecordingId, softDeleteRecording, getDeletedRecordingsByUserId, restoreRecording, getDb, createStudyGuide, getStudyGuidesByRecordingId, getStudyGuideById, createQuiz, getQuizzesByRecordingId, getQuizById, createQuizAttempt, getQuizAttemptsByQuizId, createEmailDraft, getEmailDraftsByRecordingId, getEmailDraftById } from "./db";
import { storagePut, storageGetSignedUrl } from "./storage";
import { transcribeAudio } from "./_core/voiceTranscription";
import { invokeLLM } from "./_core/llm";
import { eq } from "drizzle-orm";
import { recordings } from "../drizzle/schema";
import { notificationsRouter } from "./notificationsRouter";
import { customAuthRouter } from "./customAuthRouter";

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
        // Extract MIME type from DataURL header
        const mimeMatch = input.audioBase64.match(/^data:([^;]+);/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'audio/wav';
        
        // Map MIME types to file extensions
        const mimeToExt: Record<string, string> = {
          'audio/mpeg': 'mp3',
          'audio/mp3': 'mp3',
          'audio/wav': 'wav',
          'audio/ogg': 'ogg',
          'audio/webm': 'webm',
          'audio/mp4': 'mp4',
          'audio/x-m4a': 'm4a',
        };
        
        const extension = mimeToExt[mimeType] || 'wav';
        if (!mimeToExt[mimeType]) {
          throw new Error(`Unsupported audio format: ${mimeType}. Supported formats: MP3, WAV, OGG, WebM, MP4`);
        }
        
        // Convert base64 to buffer
        const base64Data = input.audioBase64.split(',')[1] || input.audioBase64;
        const audioBuffer = Buffer.from(base64Data, 'base64');
        
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
  notifications: notificationsRouter,

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


