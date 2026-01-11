import { PSTFile, PSTFolder, PSTMessage } from "pst-extractor";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as iconv from "iconv-lite";

/* =========================
 * 타입 정의
 * ========================= */

export interface ParsedEmail {
  subject: string;
  sender: string;
  date: string;
  body: string;
  hasAttachment?: boolean;
  importance?: string;
  label?: string;
}

export interface PSTParseResult {
  emails: ParsedEmail[];
  totalCount: number;
  errorCount: number;
  errors: string[];
}

/* =========================
 * 유틸: 인코딩 디코드
 * ========================= */

function decodeText(text: string | null | undefined): string {
  if (!text) return "";

  try {
    // 깨진 문자 있으면 인코딩 복구 시도
    if (text.includes("�")) {
      const buffer = Buffer.from(text, "latin1");

      try {
        return iconv.decode(buffer, "cp949");
      } catch {}

      try {
        return iconv.decode(buffer, "euc-kr");
      } catch {}

      return buffer.toString("utf-8");
    }

    return text;
  } catch {
    return text || "";
  }
}

/* =========================
 * HTML → TEXT 변환 (핵심)
 * ========================= */

function htmlToText(html: string): string {
  if (!html) return "";

  return html
    // script / style 제거
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")

    // 줄바꿈 태그 → 개행
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")

    // 나머지 태그 제거
    .replace(/<[^>]+>/g, "")

    // HTML 엔티티 일부 처리
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")

    // 공백 정리
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* =========================
 * 기타 유틸
 * ========================= */

function formatDate(date: Date | null): string {
  if (!date) return "";
  try {
    return date.toISOString();
  } catch {
    return "";
  }
}

function getImportance(importance: number): string {
  switch (importance) {
    case 2:
      return "high";
    case 0:
      return "low";
    default:
      return "normal";
  }
}

/* =========================
 * 폴더 재귀 처리
 * ========================= */

function processFolder(
  folder: PSTFolder,
  emails: ParsedEmail[],
  errors: string[]
): void {
  try {
    if (folder.hasSubfolders) {
      for (const sub of folder.getSubFolders()) {
        processFolder(sub, emails, errors);
      }
    }

    let message: PSTMessage | null = folder.getNextChild();

    while (message) {
      try {
        // ✅ 본문 처리 우선순위
        let bodyText = "";

        if (message.body) {
          bodyText = decodeText(message.body);
        } else if (message.bodyHTML) {
          const decodedHtml = decodeText(message.bodyHTML);
          bodyText = htmlToText(decodedHtml);
        }

        const parsed: ParsedEmail = {
          subject: decodeText(message.subject) || "(제목 없음)",
          sender:
            decodeText(
              message.senderEmailAddress || message.senderName
            ) || "",
          date: formatDate(
            message.messageDeliveryTime || message.clientSubmitTime
          ),
          body: bodyText || "(본문 없음)",
          hasAttachment: message.hasAttachments,
          importance: getImportance(message.importance),
          label: decodeText(folder.displayName) || undefined,
        };

        emails.push(parsed);
      } catch (err) {
        errors.push(
          `메일 파싱 오류: ${
            err instanceof Error ? err.message : "Unknown error"
          }`
        );
      }

      message = folder.getNextChild();
    }
  } catch (err) {
    errors.push(
      `폴더 처리 오류 (${folder.displayName}): ${
        err instanceof Error ? err.message : "Unknown error"
      }`
    );
  }
}

/* =========================
 * PST 파일 파싱
 * ========================= */

export function parsePSTFile(filePath: string): PSTParseResult {
  const emails: ParsedEmail[] = [];
  const errors: string[] = [];

  try {
    const pstFile = new PSTFile(filePath);
    const root = pstFile.getRootFolder();
    processFolder(root, emails, errors);
  } catch (err) {
    errors.push(
      `PST 파일 열기 실패: ${
        err instanceof Error ? err.message : "Unknown error"
      }`
    );
  }

  return {
    emails,
    totalCount: emails.length,
    errorCount: errors.length,
    errors,
  };
}

/* =========================
 * Buffer → PST
 * ========================= */

export function parsePSTFromBuffer(
  buffer: Buffer,
  filename: string
): PSTParseResult {
  const tempPath = path.join(
    os.tmpdir(),
    `pst_${Date.now()}_${filename}`
  );

  try {
    fs.writeFileSync(tempPath, buffer);
    return parsePSTFile(tempPath);
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {}
  }
}
