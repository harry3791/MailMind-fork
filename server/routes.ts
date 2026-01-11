import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage.ts";
import multer from "multer";
import { 
  chatRequestSchema, 
  aiChatRequestSchema,
  eventExtractionRequestSchema,
  type ChatResponse, 
  type ImportResult, 
  type SearchResult,
  type AiChatResponse,
  type EventExtractionResponse
} from "../shared/schema.ts";
import { ZodError } from "zod";
import { chatWithOllama, extractEventsFromEmail, checkOllamaConnection, classifyEmail } from "./ollama.ts";
import { parsePSTFromBuffer } from "./pst-parser.ts";

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
});

function parseEmailsFromJson(content: string): Array<{
  subject: string;
  sender: string;
  date: string;
  body: string;
  importance?: string;
  label?: string;
}> {
  try {
    const data = JSON.parse(content);
    const emails = Array.isArray(data) ? data : (data.emails || []);
    
    return emails.map((email: Record<string, unknown>) => ({
      subject: String(email.subject || email.Subject || ""),
      sender: String(email.sender || email.from || email.From || ""),
      date: String(email.date || email.Date || email.sent_date || ""),
      body: String(email.body || email.content || email.text || email.Body || ""),
      importance: email.importance ? String(email.importance) : undefined,
      label: email.label ? String(email.label) : undefined,
    }));
  } catch {
    return [];
  }
}

function generateSampleEmails(): Array<{
  subject: string;
  sender: string;
  date: string;
  body: string;
}> {
  return [
    {
      subject: "프로젝트 진행 상황 보고",
      sender: "김철수 <kim@example.com>",
      date: "2025-01-05 09:30:00",
      body: "안녕하세요, 프로젝트 진행 상황을 보고드립니다. 현재 1차 개발 단계가 완료되었으며, 다음 주 월요일부터 2차 개발에 착수할 예정입니다. 테스트 일정도 조율 중이오니 참고 부탁드립니다.",
    },
    {
      subject: "회의 일정 안내",
      sender: "박영희 <park@example.com>",
      date: "2025-01-06 14:00:00",
      body: "다음 주 화요일 오후 2시에 정기 회의가 예정되어 있습니다. 회의실 A에서 진행되며, 주요 안건은 분기별 실적 검토와 향후 계획 수립입니다. 참석 여부를 회신해 주세요.",
    },
    {
      subject: "견적서 요청의 건",
      sender: "이민수 <lee@example.com>",
      date: "2025-01-04 11:15:00",
      body: "안녕하세요, 제안서에 언급된 시스템 구축 비용에 대한 상세 견적서를 요청드립니다. 예산 검토를 위해 가능한 빨리 회신 부탁드리며, 항목별 세부 내역도 함께 보내주시면 감사하겠습니다.",
    },
    {
      subject: "서버 점검 공지",
      sender: "시스템관리자 <admin@example.com>",
      date: "2025-01-07 08:00:00",
      body: "금일 오후 10시부터 내일 오전 6시까지 서버 정기 점검이 진행됩니다. 해당 시간 동안 시스템 접속이 불가하오니 양해 부탁드립니다. 중요한 작업은 점검 전 완료해 주시기 바랍니다.",
    },
    {
      subject: "교육 참석 안내",
      sender: "인사팀 <hr@example.com>",
      date: "2025-01-03 16:45:00",
      body: "신규 시스템 사용법 교육이 다음 주 수요일에 진행됩니다. 대상자는 각 부서 담당자이며, 교육 시간은 오전 10시부터 12시까지입니다. 교육장 위치는 본관 3층 대회의실입니다.",
    },
    {
      subject: "계약서 검토 요청",
      sender: "법무팀 <legal@example.com>",
      date: "2025-01-02 10:30:00",
      body: "첨부된 계약서 초안을 검토해 주시기 바랍니다. 수정 사항이나 의견이 있으시면 금주 금요일까지 회신 부탁드립니다. 계약 체결 일정이 촉박하오니 신속한 검토 부탁드립니다.",
    },
    {
      subject: "월간 보고서 제출 안내",
      sender: "경영지원팀 <support@example.com>",
      date: "2025-01-01 09:00:00",
      body: "1월 월간 보고서 제출 마감일은 1월 10일입니다. 각 부서별 실적 및 향후 계획을 포함하여 작성해 주시기 바랍니다. 보고서 양식은 공유 폴더에서 다운로드 가능합니다.",
    },
    {
      subject: "출장 경비 정산 안내",
      sender: "재무팀 <finance@example.com>",
      date: "2025-01-06 13:20:00",
      body: "지난달 출장 경비 정산을 위해 영수증 원본과 정산서를 제출해 주세요. 제출 마감은 이번 주 금요일이며, 지연 시 다음 달로 이월됩니다. 문의사항은 재무팀으로 연락 바랍니다.",
    },
  ];
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  app.get("/api/stats", async (_req: Request, res: Response) => {
    try {
      const stats = await storage.getStats();
      res.json(stats);
    } catch (error) {
      console.error("Stats error:", error);
      res.status(500).json({ error: "Failed to get stats" });
    }
  });

  app.post("/api/import", upload.single("file"), async (req: Request, res: Response) => {
    try {
      const file = req.file;
      let emailsToImport: Array<{
        subject: string;
        sender: string;
        date: string;
        body: string;
        importance?: string;
        label?: string;
      }> = [];
      let filename = "sample_data";

      if (file) {
        filename = file.originalname;
        const ext = filename.toLowerCase().split(".").pop();

        if (ext === "json") {
          const content = file.buffer.toString("utf-8");
          emailsToImport = parseEmailsFromJson(content);
        } else if (ext === "pst") {
          const parseResult = parsePSTFromBuffer(file.buffer, filename);
          if (parseResult.errors.length > 0 && parseResult.emails.length === 0) {
            res.status(400).json({
              ok: false,
              inserted: 0,
              message: `PST 파일 파싱 오류: ${parseResult.errors.join(", ")}`,
            });
            return;
          }
          emailsToImport = parseResult.emails;
        } else {
          res.status(400).json({
            ok: false,
            inserted: 0,
            message: "지원되지 않는 파일 형식입니다. JSON 또는 PST 파일을 사용해 주세요.",
          });
          return;
        }
      } else {
        emailsToImport = generateSampleEmails();
        filename = "sample_demo_data";
      }

      if (emailsToImport.length === 0) {
        res.status(400).json({
          ok: false,
          inserted: 0,
          message: "파일에서 이메일을 찾을 수 없습니다.",
        });
        return;
      }

      // 🔧 hasAttachment 명시적으로 주입 (JSON/PST 공통)
      const emailsWithAttachment = emailsToImport.map(email => ({
        ...email,
        hasAttachment: "false" as const, // 첨부파일 메타 없으면 기본 false
      }));
      const insertedEmails = await storage.insertEmailsAndGetIds(emailsWithAttachment);

      const insertedCount = insertedEmails.length;

      await storage.logImport({
        filename,
        emailsImported: insertedCount,
      });

      let classifiedCount = 0;
      let eventsExtractedCount = 0;
      let skippedCount = 0;

      const ollamaConnected = await checkOllamaConnection();

      if (ollamaConnected) {
        for (const email of insertedEmails) {
          try {
            // 1️⃣ 분류 시도
            const classification = await classifyEmail(
              email.subject,
              email.body,
              email.sender
            );

            // 2️⃣ 분류 결과 가드 (핵심)
            if (!classification?.classification) {
              console.warn(
                `[SKIP] Invalid classification for email ${email.id}`,
                classification
              );
              skippedCount++;
              continue;
            }

            // 3️⃣ 분류 저장
            await storage.updateEmailClassification(
              email.id,
              classification.classification,
              classification.confidence
            );
            classifiedCount++;

            // 4️⃣ 일정 추출
            const events = await extractEventsFromEmail(
              email.subject,
              email.body,
              email.date
            );

            for (const event of events) {
              await storage.addCalendarEvent({
                emailId: email.id,
                title: event.title,
                startDate: event.startDate,
                endDate: event.endDate || null,
                location: event.location || null,
                description: event.description || null,
              });
              eventsExtractedCount++;
            }

            // 5️⃣ 여기까지 성공한 경우에만 processed 처리
            await storage.markEmailProcessed(email.id);

          } catch (err) {
            console.error(`Error processing email ${email.id}:`, err);
            skippedCount++;
          }
        }
      }

      res.json({
        ok: true,
        inserted: insertedCount,
        classified: classifiedCount,
        skipped: skippedCount,
        eventsExtracted: eventsExtractedCount,
        message: ollamaConnected
          ? `${insertedCount}개의 이메일을 가져왔습니다. ${classifiedCount}개 분류, ${skippedCount}개 건너뜀, ${eventsExtractedCount}개 일정 추출 완료.`
          : `${insertedCount}개의 이메일을 가져왔습니다. AI 서버 미연결로 자동 분류/일정 추출이 건너뛰어졌습니다.`,
      });
    } catch (error) {
      console.error("Import error:", error);
      res.status(500).json({
        ok: false,
        inserted: 0,
        message: error instanceof Error ? error.message : "가져오기 중 오류가 발생했습니다.",
      });
    }
  });


  app.post("/api/search", async (req: Request, res: Response) => {
    try {
      const validationResult = chatRequestSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        const errors = validationResult.error.errors.map(e => e.message).join(", ");
        res.status(400).json({ error: errors || "잘못된 요청입니다." });
        return;
      }

      const { message, topK } = validationResult.data;
      const citations: SearchResult[] = await storage.searchEmails(message.trim(), topK);

      const topSubjects = citations
        .slice(0, 10)
        .map(c => `- ${c.subject} (점수=${c.score.toFixed(1)}, ID=${c.mailId})`)
        .join("\n");

      const answer = `검색어: ${message}\n\nTop 결과:\n${topSubjects || "- (결과 없음)"}`;

      const response: ChatResponse = {
        answer,
        citations,
        debug: {
          topK,
          hitsCount: citations.length,
        },
      };

      res.json(response);
    } catch (error) {
      console.error("Search error:", error);
      if (error instanceof ZodError) {
        res.status(400).json({ error: "잘못된 요청 형식입니다." });
        return;
      }
      res.status(500).json({ error: "검색 중 오류가 발생했습니다." });
    }
  });

  app.get("/api/ping", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      hint: "POST /api/import로 이메일 가져오기, /api/stats로 통계 확인, POST /api/search로 검색",
    });
  });

  app.get("/api/ollama/status", async (_req: Request, res: Response) => {
    try {
      const connected = await checkOllamaConnection();
      res.json({ connected, baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434" });
    } catch {
      res.json({ connected: false, baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434" });
    }
  });

  app.get("/api/conversations", async (_req: Request, res: Response) => {
    try {
      const conversations = await storage.getConversations();
      res.json(conversations);
    } catch (error) {
      console.error("Get conversations error:", error);
      res.status(500).json({ error: "대화 목록을 가져오는 중 오류가 발생했습니다." });
    }
  });

  app.get("/api/conversations/:id", async (req: Request, res: Response) => {
    try {
      const emailId = parseInt(req.params.id);
      if (isNaN(emailId)) {
        res.status(400).json({ error: "잘못된 이메일 ID입니다." });
        return;
      }
      const email = await storage.getEmailById(emailId);
      if (!email) {
        res.status(404).json({ error: "이메일을 찾을 수 없습니다." });
        return;
      }
      res.json(email);
    } catch (error) {
      console.error("Get email error:", error);
      res.status(500).json({ error: "이메일을 가져오는 중 오류가 발생했습니다." });
    }
  });

  app.get("/api/conversations/:id/messages", async (req: Request, res: Response) => {
    try {
      const conversationId = parseInt(req.params.id);
      if (isNaN(conversationId)) {
        res.status(400).json({ error: "잘못된 대화 ID입니다." });
        return;
      }
      const messages = await storage.getMessages(conversationId);
      res.json(messages);
    } catch (error) {
      console.error("Get messages error:", error);
      res.status(500).json({ error: "메시지를 가져오는 중 오류가 발생했습니다." });
    }
  });

  app.post("/api/ai/chat", async (req: Request, res: Response) => {
    try {
      const validationResult = aiChatRequestSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        const errors = validationResult.error.errors.map(e => e.message).join(", ");
        res.status(400).json({ error: errors || "잘못된 요청입니다." });
        return;
      }

      const { message, conversationId } = validationResult.data;
      
      let convId = conversationId;
      if (!convId) {
        const newConv = await storage.createConversation({ title: message.slice(0, 50) });
        convId = newConv.id;
      }

      await storage.addMessage({
        conversationId: convId,
        role: "user",
        content: message,
      });

      const relevantEmails = await storage.searchEmails(message, 5);
      
      let emailContext = "";
      if (relevantEmails.length > 0) {
        const emailContextItems = relevantEmails.map((e, i) => 
          `[이메일 ${i + 1}]\n제목: ${e.subject}\n발신자: ${e.sender}\n날짜: ${e.date}\n내용: ${e.body.substring(0, 300)}...`
        );
        emailContext = `\n\n참고할 관련 이메일들:\n${emailContextItems.join("\n\n")}`;
      }

      const previousMessages = await storage.getMessages(convId);
      const ollamaMessages = previousMessages.map(m => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      }));

      const systemPrompt = `당신은 이메일 관리와 일정 정리를 도와주는 AI 비서입니다. 
사용자가 업로드한 이메일 데이터를 기반으로 질문에 답변해주세요.
한국어로 친절하게 응답해주세요.${emailContext}`;

      const aiResponse = await chatWithOllama([
        { role: "system", content: systemPrompt },
        ...ollamaMessages,
      ]);

      await storage.addMessage({
        conversationId: convId,
        role: "assistant",
        content: aiResponse,
      });

      const response: AiChatResponse = {
        response: aiResponse,
        conversationId: convId,
      };

      res.json(response);
    } catch (error) {
      console.error("AI chat error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "AI 채팅 중 오류가 발생했습니다." });
    }
  });

  app.post("/api/events/extract", async (req: Request, res: Response) => {
    try {
      const validationResult = eventExtractionRequestSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        const errors = validationResult.error.errors.map(e => e.message).join(", ");
        res.status(400).json({ error: errors || "잘못된 요청입니다." });
        return;
      }

      const { emailId } = validationResult.data;
      const email = await storage.getEmailById(emailId);
      
      if (!email) {
        res.status(404).json({ error: "이메일을 찾을 수 없습니다." });
        return;
      }

      const extractedEvents = await extractEventsFromEmail(
        email.subject,
        email.body,
        email.date
      );

      for (const event of extractedEvents) {
        await storage.addCalendarEvent({
          emailId: email.id,
          title: event.title,
          startDate: event.startDate,
          endDate: event.endDate || null,
          location: event.location || null,
          description: event.description || null,
        });
      }

      const response: EventExtractionResponse = {
        events: extractedEvents,
        emailId,
      };

      res.json(response);
    } catch (error) {
      console.error("Event extraction error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "일정 추출 중 오류가 발생했습니다." });
    }
  });

  app.get("/api/events", async (_req: Request, res: Response) => {
    try {
      const events = await storage.getCalendarEvents();
      res.json(events);
    } catch (error) {
      console.error("Get events error:", error);
      res.status(500).json({ error: "일정을 가져오는 중 오류가 발생했습니다." });
    }
  });

  app.get("/api/emails", async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const classification = req.query.classification as string | undefined;
      
      let allEmails = await storage.getAllEmails(limit);
      
      if (classification && classification !== "all") {
        allEmails = allEmails.filter(e => e.classification === classification);
      }
      
      res.json(allEmails);
    } catch (error) {
      console.error("Get emails error:", error);
      res.status(500).json({ error: "이메일 목록을 가져오는 중 오류가 발생했습니다." });
    }
  });

  app.post("/api/emails/:id/classify", async (req: Request, res: Response) => {
    try {
      const ollamaConnected = await checkOllamaConnection();
      if (!ollamaConnected) {
        res.status(503).json({ error: "AI 서버에 연결할 수 없습니다." });
        return;
      }

      const emailId = parseInt(req.params.id);
      if (isNaN(emailId)) {
        res.status(400).json({ error: "잘못된 이메일 ID입니다." });
        return;
      }

      const email = await storage.getEmailById(emailId);
      if (!email) {
        res.status(404).json({ error: "이메일을 찾을 수 없습니다." });
        return;
      }

      // 🔒 이미 분류된 경우 재분류 방지
      if (email.classification && email.classification.trim() !== "") {
        res.json({
          success: true,
          classification: email.classification,
          confidence: email.classificationConfidence || "medium",
          skipped: true,
          message: "이미 분류된 이메일입니다.",
        });
        return;
      }

      const classification = await classifyEmail(
        email.subject,
        email.body,
        email.sender
      );

      // ❗ 분류 결과 유효성 가드
      if (!classification?.classification) {
        res.status(500).json({
          error: "분류 결과가 유효하지 않습니다.",
        });
        return;
      }

      await storage.updateEmailClassification(
        emailId,
        classification.classification,
        classification.confidence
      );

      // ✅ 단건 분류 성공 시에만 processed 처리
      await storage.markEmailProcessed(emailId);

      res.json({
        success: true,
        classification: classification.classification,
        confidence: classification.confidence,
      });
    } catch (error) {
      console.error("Classification error:", error);
      res.status(500).json({
        error: error instanceof Error
          ? error.message
          : "분류 중 오류가 발생했습니다.",
      });
    }
  });

  app.post("/api/emails/classify-all", async (_req: Request, res: Response) => {
    try {
      const ollamaConnected = await checkOllamaConnection();
      if (!ollamaConnected) {
        res.status(503).json({ error: "AI 서버에 연결할 수 없습니다." });
        return;
      }

      const unprocessedEmails = await storage.getUnprocessedEmails();

      let classified = 0;
      let skipped = 0;
      let failed = 0;

      for (const email of unprocessedEmails) {
        try {
          // 🔒 이미 분류된 메일 → skip 처리
          if (email.classification && email.classification.trim() !== "") {
            await storage.markEmailProcessed(email.id);
            skipped++;
            continue;
          }

          const classification = await classifyEmail(
            email.subject,
            email.body,
            email.sender
          );

          // ❗ 분류 결과 가드
          if (!classification?.classification) {
            console.warn(
              `[SKIP] Email ${email.id} classification invalid`,
              classification
            );
            failed++;
            continue;
          }

          await storage.updateEmailClassification(
            email.id,
            classification.classification,
            classification.confidence
          );

          await storage.markEmailProcessed(email.id);
          classified++;

        } catch (error) {
          console.error(`Failed to classify email ${email.id}:`, error);
          failed++;
        }
      }

      res.json({
        success: true,
        total: unprocessedEmails.length,
        classified,   // 새로 분류한 메일
        skipped,      // 이미 분류되어 있었던 메일
        failed,
      });
    } catch (error) {
      console.error("Batch classification error:", error);
      res.status(500).json({ error: "일괄 분류 중 오류가 발생했습니다." });
    }
  });

  app.get("/api/settings/storage", async (_req: Request, res: Response) => {
    try {
      const savedSettings = await storage.getAppSetting("storage_config");
      let config = { mode: "postgresql", dataDir: "" };
      
      if (savedSettings) {
        try {
          config = JSON.parse(savedSettings);
        } catch {}
      }
      
      const currentMode = process.env.STORAGE_MODE || "postgresql";
      const currentDataDir = process.env.DATA_DIR || "";
      
      res.json({ 
        mode: currentMode,
        dataDir: currentDataDir,
        savedMode: config.mode,
        savedDataDir: config.dataDir,
        info: currentMode === "local" && currentDataDir 
          ? `로컬 저장소 사용 중 (${currentDataDir})` 
          : "PostgreSQL 데이터베이스 사용 중",
        needsRestart: config.mode !== currentMode || config.dataDir !== currentDataDir
      });
    } catch (error) {
      console.error("Get storage settings error:", error);
      res.status(500).json({ error: "설정을 가져오는 중 오류가 발생했습니다." });
    }
  });

  app.post("/api/settings/storage", async (req: Request, res: Response) => {
    try {
      const { mode, dataDir } = req.body;
      
      if (!mode || (mode !== "local" && mode !== "postgresql")) {
        res.status(400).json({ error: "유효하지 않은 저장소 모드입니다." });
        return;
      }
      
      if (mode === "local" && !dataDir) {
        res.status(400).json({ error: "로컬 모드에는 데이터 폴더 경로가 필요합니다." });
        return;
      }

      const config = JSON.stringify({ mode, dataDir: dataDir || "" });
      await storage.setAppSetting("storage_config", config);
      
      res.json({ 
        success: true, 
        message: "설정이 저장되었습니다. 변경 사항을 적용하려면 애플리케이션을 재시작하세요.",
        savedMode: mode,
        savedDataDir: dataDir
      });
    } catch (error) {
      console.error("Save storage settings error:", error);
      res.status(500).json({ error: "설정 저장 중 오류가 발생했습니다." });
    }
  });

  app.post("/api/process/unprocessed", async (_req: Request, res: Response) => {
    try {
      const ollamaConnected = await checkOllamaConnection();
      if (!ollamaConnected) {
        res.status(503).json({ error: "AI 서버에 연결할 수 없습니다." });
        return;
      }

      const unprocessed = await storage.getUnprocessedEmails();

      let processedCount = 0;
      let skippedCount = 0;
      let eventsCount = 0;

      for (const email of unprocessed) {
        try {
          // 🔒 이미 분류된 메일은 재처리 금지
          if (email.classification && email.classification.trim() !== "") {
            await storage.markEmailProcessed(email.id);
            skippedCount++;
            continue;
          }

          // 1️⃣ 분류 시도
          const classification = await classifyEmail(
            email.subject,
            email.body,
            email.sender
          );

          // 2️⃣ 분류 결과 유효성 가드
          if (
            !classification ||
            !classification.classification ||
            classification.classification.trim() === ""
          ) {
            console.warn(
              `[SKIP] Invalid classification for email ${email.id}`,
              classification
            );
            skippedCount++;
            continue;
          }

          // 3️⃣ 분류 저장
          await storage.updateEmailClassification(
            email.id,
            classification.classification,
            classification.confidence
          );

          // 4️⃣ 일정 추출
          const events = await extractEventsFromEmail(
            email.subject,
            email.body,
            email.date
          );

          for (const event of events) {
            await storage.addCalendarEvent({
              emailId: email.id,
              title: event.title,
              startDate: event.startDate,
              endDate: event.endDate || null,
              location: event.location || null,
              description: event.description || null,
            });
            eventsCount++;
          }

          // 5️⃣ 여기까지 성공한 경우만 processed 처리
          await storage.markEmailProcessed(email.id);
          processedCount++;

        } catch (err) {
          console.error(`Error processing email ${email.id}:`, err);
          skippedCount++;
        }
      }

      res.json({
        success: true,
        total: unprocessed.length,
        processed: processedCount,
        skipped: skippedCount,
        eventsExtracted: eventsCount,
        message: `처리 완료: ${processedCount}개 성공, ${skippedCount}개 건너뜀, 일정 ${eventsCount}개 추출`,
      });
    } catch (error) {
      console.error("Process unprocessed error:", error);
      res.status(500).json({ error: "처리 중 오류가 발생했습니다." });
    }
  });

  return httpServer;
}
