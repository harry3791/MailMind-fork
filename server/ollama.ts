import type { ExtractedEvent } from "@shared/schema";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OllamaResponse {
  model: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
}

export async function chatWithOllama(
  messages: OllamaMessage[],
  model: string = "llama3.2"
): Promise<string> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data: OllamaResponse = await response.json();
    return data.message.content;
  } catch (error) {
    console.error("Ollama chat error:", error);
    throw new Error("AI 서버에 연결할 수 없습니다. Ollama가 실행 중인지 확인해주세요.");
  }
}

export async function extractEventsFromEmail(
  emailSubject: string,
  emailBody: string,
  emailDate: string
): Promise<ExtractedEvent[]> {
  const systemPrompt = `당신은 이메일에서 일정/이벤트 정보를 추출하는 전문가입니다.
이메일 내용을 분석하여 **가장 중요한 메인 일정 하나만** 추출해주세요.

**추출해야 하는 일정 유형:**
- 회의 일정 (예: "오후 3시 현장 회의", "2시에 회의")
- 작업 일정 (예: "조립 시작", "점검 실시", "교육 진행")
- 진수식/행사 일정 (가장 우선순위 높음)
- 검사/점검 일정 (예: "검사 일시: 1월 18일 ~ 20일")
- 납기/입고 예정일 (예: "납기: 3월 15일", "입고 예정: 1월 29일")
- 마감일/제출일 (예: "제출 기한: 1월 10일", "까지 회신")
- 인도/시운전 일정
- 기타 구체적인 날짜가 언급된 일정

**일정 선택 우선순위 (한 이메일에서 하나만 추출):**
1. 진수식, 시운전, 인도 등 주요 행사
2. 회의, 점검, 검사 일정
3. 작업 시작/완료 일정
4. 납기/입고 예정일
5. 마감일/제출 기한

**중요 규칙:**
1. 제목(title): **반드시 구체적인 제목 작성 필수** (필수)
   - 이메일 제목을 그대로 사용하거나, 본문의 핵심 일정 내용으로 작성
   - 예: "H-1234호선 블록 조립", "S-5678호선 진수식", "용접 불량 현장 회의"
   - **절대 빈 문자열("")을 사용하지 마세요**
2. 날짜(startDate): 구체적인 날짜가 있어야 함 (필수)
   - **반드시 YYYY-MM-DD 또는 YYYY-MM-DD HH:mm 형식으로 변환**
   - "2025년 1월 15일" → "2025-01-15"
   - "2025년 1월 15일 08:00" → "2025-01-15 08:00"
   - "오늘", "내일" 같은 상대적 표현은 이메일 수신 날짜 기준으로 계산
3. 종료일(endDate): 기간이 명시된 경우만 (선택)
   - 형식: "YYYY-MM-DD" 또는 "YYYY-MM-DD HH:mm"
4. 장소(location): 회의실, 공장, 도크 등 장소 정보 (선택)
5. 설명(description): 마감일, 부가 일정 등 추가 정보를 여기에 포함 (선택)
   - 예: "참석 여부 회신 마감: 2월 3일"
6. **빈 문자열 절대 금지** - 정보가 없으면 null 사용
7. **이메일당 가장 중요한 일정 하나만 추출**

반드시 다음 JSON 배열 형식으로만 응답하세요:
[
  {
    "title": "구체적인 일정 제목",
    "startDate": "YYYY-MM-DD HH:mm",
    "endDate": "YYYY-MM-DD HH:mm",
    "location": "장소",
    "description": "추가 설명"
  }
]

일정이 하나도 없으면 빈 배열 []을 반환하세요.

**학습 예시:**

예시 1:
이메일 제목: H-1234호선 블록 조립 일정 통보
본문: "H-1234호선 중앙블록 조립 일정을 다음과 같이 통보합니다. 조립 시작: 2025년 1월 15일 08:00, 조립 완료 예정: 2025년 1월 20일 17:00, 작업 장소: 제2공장 조립장"
응답:
[
  {
    "title": "H-1234호선 블록 조립",
    "startDate": "2025-01-15 08:00",
    "endDate": "2025-01-20 17:00",
    "location": "제2공장 조립장",
    "description": null
  }
]

예시 2:
이메일 제목: S-5678호선 진수식 일정 안내
본문: "S-5678호선 컨테이너선 진수식을 다음과 같이 개최합니다. 일시: 2025년 2월 10일 오전 10시, 장소: 제1도크. 진수식 후 오찬이 예정되어 있으니 참석 여부를 2월 3일까지 회신 바랍니다."
응답:
[
  {
    "title": "S-5678호선 진수식",
    "startDate": "2025-02-10 10:00",
    "endDate": null,
    "location": "제1도크",
    "description": "참석 여부 회신 마감: 2025-02-03"
  }
]

예시 3:
이메일 제목: 긴급: 용접 불량 발견
본문: "블록 305번 용접부에서 불량이 발견되었습니다. 오늘 오후 3시 현장 회의 요청드립니다."
수신 날짜: 2025-01-04 11:15:00
응답:
[
  {
    "title": "용접 불량 현장 회의",
    "startDate": "2025-01-04 15:00",
    "endDate": null,
    "location": "현장",
    "description": null
  }
]`;

  const userPrompt = `다음 이메일에서 **가장 중요한 메인 일정 하나만** 추출해주세요:

이메일 제목: ${emailSubject}

이메일 본문:
${emailBody}

참고 - 이메일 수신 날짜: ${emailDate}`;

  try {
    const response = await chatWithOllama(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      "llama3.2"
    );

    // JSON 배열 추출 (더 견고한 매칭)
    const jsonMatch = response.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) {
      console.log("[Event Extraction] No JSON array found in response");
      console.log("[Event Extraction] Raw response:", response.substring(0, 500));
      return [];
    }

    let events;
    try {
      console.log("[Event Extraction] Parsing JSON:", jsonMatch[0].substring(0, 200));
      events = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.log("[Event Extraction] JSON parse error:", parseError);
      console.log("[Event Extraction] Failed JSON:", jsonMatch[0]);
      return [];
    }
    
    // 유효성 검사: title과 startDate가 비어있거나 없는 이벤트 필터링
    const validEvents = Array.isArray(events) 
      ? events.filter(e => {
          const hasTitle = e.title && typeof e.title === 'string' && e.title.trim().length > 0;
          const hasDate = e.startDate && typeof e.startDate === 'string' && e.startDate.trim().length > 0;
          
          if (!hasTitle || !hasDate) {
            console.log(`[Event Extraction] Filtered invalid event - Title: "${e.title}", Date: "${e.startDate}"`);
            return false;
          }
          
          return true;
        })
      : [];
    
    console.log(`[Event Extraction] Extracted ${validEvents.length} valid events from ${Array.isArray(events) ? events.length : 0} total`);
    return validEvents;
  } catch (error) {
    console.error("Event extraction error:", error);
    return [];
  }
}

export async function checkOllamaConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function getAvailableModels(): Promise<string[]> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.models?.map((m: { name: string }) => m.name) || [];
  } catch {
    return [];
  }
}

export type EmailClassification = "업무요청" | "회의" | "첨부파일" | "결재요청" | "공지";

export interface ClassificationResult {
  classification: EmailClassification;
  confidence: string;
}

export async function classifyEmail(
  subject: string,
  body: string,
  sender: string
): Promise<ClassificationResult> {
  const systemPrompt = `당신은 조선소 이메일 분류 전문가입니다. 
  아래의 **판단 알고리즘**과 **예시**를 엄격히 준수하여 분류하세요.

  ### [판단 알고리즘 - 이 순서대로 검토하세요]

  1. **결재요청 (Approval)**: 
    - 핵심 키워드: 금액(원, $), 예산, 승인 바랍니다, 결재, 품의, 정산.
    - 판단 기준: 경제적 의사결정이나 비용 집행에 대한 허가가 주된 목적인 경우.

  2. **회의 (Meeting)**: 
    - 핵심 키워드: 일시, 장소, 참석자, Agenda, 회의록, 미팅 소집.
    - 판단 기준: 특정 시간에 모여서 논의하는 장을 마련하거나 그 결과를 공유하는 경우.

  3. **업무요청 (Task)**: 
    - **중요**: 수신자가 메일을 읽고 '실제로 작업을 수행'하거나 '결과를 보고'해야 한다면 반드시 이 카테고리입니다.
    - 핵심 키워드: 수행 의뢰, 측정 요청, 점검 요망, 수정 바랍니다, 제출, 조치 계획, 기한(~까지).
    - 예시: NDT 검사 의뢰, 소음 측정 요청, 장비 점검 지시 등.

  4. **공지 (Announcement)**: 
    - 판단 기준: 수신자가 '알고만 있으면 되는' 정보. 개별적인 작업이나 결과 보고가 필요 없는 전사 안내문.
    - 예시: 시스템 점검 안내, 복장 규정 공지, 식단 안내, 인사 발령.

  ### [강화된 예시 (Few-Shot)]
  - "용접부 NDT 검사 수행 의뢰" -> **업무요청** (검사라는 구체적 행동 필요)
  - "작업장 내 소음 측정 및 분석 요청" -> **업무요청** (측정 및 결과 제출 필요)
  - "호이스트 와이어 로프 점검 요청" -> **업무요청** (현장 점검 액션 필요)
  - "B-21 블록 추가 자재 구매 승인" -> **결재요청** (비용 승인 필요)
  - "공정 지연 대응 회의 소집" -> **회의** (미팅 약속)
  - "2월 정기 안전 점검 기간 안내" -> **공지** (단순 일정 참고용 정보 전달)

  ### [응답 규칙]
  - 반드시 아래 JSON 형식으로만 답변하고 다른 설명은 절대 생략하세요.
  {"classification": "업무요청|회의|결재요청|공지", "reason": "수신자의 액션 필요 여부를 근거로 기술", "confidence": "high|medium|low"}`;

  const userPrompt = `다음 이메일을 분류해주세요.
발신자: ${sender}
제목: ${subject}
내용:
${body.substring(0, 800)}`;

  try {
    // 옵션 객체를 제거하여 TypeScript 에러(TS2345)를 해결합니다.
    const response = await chatWithOllama([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    // JSON 형식만 추출하여 파싱
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return {
        classification: result.classification ?? "공지",
        confidence: result.confidence ?? "medium",
      };
    }

    return { classification: "공지", confidence: "low" };
  } catch (error) {
    console.error("Classification error:", error);
    return { classification: "공지", confidence: "low" };
  }
}

export async function chatWithEmailContext(
  message: string,
  emailContext: Array<{ subject: string; body: string; sender: string; date: string }>
): Promise<string> {
  const contextText = emailContext
    .map((e, i) => `[이메일 ${i + 1}]\n제목: ${e.subject}\n발신자: ${e.sender}\n날짜: ${e.date}\n내용: ${e.body.substring(0, 300)}...`)
    .join("\n\n");

  const systemPrompt = `당신은 이메일 관리와 일정 정리를 도와주는 AI 비서입니다. 
사용자가 업로드한 이메일 데이터를 기반으로 질문에 답변해주세요.
아래는 관련 이메일 내용입니다:

${contextText}

이 정보를 바탕으로 사용자의 질문에 친절하게 답변해주세요.`;

  return chatWithOllama([
    { role: "system", content: systemPrompt },
    { role: "user", content: message },
  ]);
}
