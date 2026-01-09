# MailMind

AI 기반 이메일 관리 및 일정 추출 시스템

## 기능

- 📧 PST/JSON 파일 이메일 가져오기
- 🤖 AI 기반 이메일 자동 분류
- 📅 이메일에서 일정 자동 추출
- 🔍 이메일 검색 및 필터링
- 💬 AI 챗봇 지원
- 🌐 한글 인코딩 자동 처리

## 사전 요구사항

- Node.js 18 이상
- Ollama (로컬 AI 모델)

## 설치 방법

### 1. 저장소 클론

```bash
git clone https://github.com/rladhEKd/MailMind.git
cd MailMind
```

### 2. 의존성 설치

```bash
npm install
```

### 3. Ollama 설치 및 실행

**Windows:**
1. [Ollama 다운로드](https://ollama.ai/download)
2. 설치 후 터미널에서 모델 다운로드:
```bash
ollama pull llama3.2
```

**Mac/Linux:**
```bash
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull llama3.2
```

### 4. Ollama 실행 확인

```bash
ollama list
```

llama3.2가 목록에 있으면 준비 완료!

## 실행 방법

### Windows

```bash
npm run dev
```

### Mac/Linux

```bash
npm run dev
```

서버가 http://localhost:5000 에서 실행됩니다.

## 사용 방법

1. **이메일 가져오기**
   - 홈 페이지에서 "이메일 가져오기" 버튼 클릭
   - PST 파일 또는 JSON 파일 선택
   - 자동으로 AI가 이메일을 분류하고 일정을 추출합니다

2. **검색**
   - 검색창에 키워드 입력
   - 관련 이메일이 점수 순으로 표시됩니다

3. **일정 보기**
   - 상단 메뉴에서 "일정" 클릭
   - 추출된 일정 목록 확인
   - 일정 카드를 클릭하면 원본 이메일도 확인 가능

4. **AI 채팅**
   - 상단 메뉤에서 "채팅" 클릭
   - AI와 대화하며 이메일 관련 질문 가능

## 프로젝트 구조

```
MailMind/
├── client/          # React 프론트엔드
│   └── src/
│       ├── pages/   # 페이지 컴포넌트
│       └── components/ # UI 컴포넌트
├── server/          # Express 백엔드
│   ├── index.ts     # 서버 진입점
│   ├── routes.ts    # API 라우트
│   ├── ollama.ts    # AI 통합
│   ├── pst-parser.ts # PST 파일 파서
│   └── local-storage.ts # 로컬 SQLite 저장소
├── shared/          # 공유 타입
└── data/            # 로컬 데이터 (자동 생성)
```

## 기술 스택

- **Frontend**: React 18, TypeScript, Vite, TailwindCSS
- **Backend**: Express.js, TypeScript
- **Database**: SQLite (로컬)
- **AI**: Ollama (llama3.2)
- **Email Parser**: pst-extractor

## 문제 해결

### Ollama 연결 오류
```bash
# Ollama 실행 확인
ollama list

# Ollama 재시작
# Windows: 작업 관리자에서 Ollama 프로세스 종료 후 재실행
# Mac/Linux:
killall ollama
ollama serve
```

### 한글 깨짐
- 최신 버전은 자동으로 CP949/EUC-KR/UTF-8 인코딩을 처리합니다
- 문제가 지속되면 PST 파일을 다시 업로드해보세요

### 포트 충돌
```bash
# 5000번 포트가 사용 중이면 환경 변수로 변경
set PORT=3000
npm run dev
```

## 라이선스

MIT

## 기여

버그 리포트나 기능 제안은 [Issues](https://github.com/rladhEKd/MailMind/issues)에 등록해주세요.
