import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Mail,
  User,
  Clock,
  FileText,
  Loader2,
  Calendar,
  Sparkles,
  Inbox,
  Briefcase,
  Users,
  Paperclip,
  CheckCircle,
  Bell,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Email {
  id: number;
  subject: string;
  sender: string;
  date: string;
  body: string;
  classification?: string;
  classificationConfidence?: string;
  isProcessed?: string;
  hasAttachment?: boolean;
  importance?: string;
  label?: string;
}

interface EventExtractionResponse {
  success: boolean;
  events: Array<{
    title: string;
    startDate: string;
    endDate?: string;
    location?: string;
    description?: string;
  }>;
}

const CATEGORIES = [
  { id: "all", label: "전체", icon: Inbox },
  { id: "업무요청", label: "업무요청", icon: Briefcase },
  { id: "회의", label: "회의", icon: Users },
  { id: "결재요청", label: "결재요청", icon: CheckCircle },
  { id: "공지", label: "공지", icon: Bell },
];

type DetailTab = "email" | "draft";

export default function InboxPage() {
  const { toast } = useToast();
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [extractingId, setExtractingId] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("email");
  const [draftByEmailId, setDraftByEmailId] = useState<Record<number, string>>(
    {}
  );
  const [draftErrorByEmailId, setDraftErrorByEmailId] = useState<
    Record<number, string>
  >({});
  const [draftLoadingId, setDraftLoadingId] = useState<number | null>(null);

  const { data: allEmails } = useQuery<Email[]>({
    queryKey: ["/api/emails"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/emails");
      return response.json();
    },
  });

  const { data: emails, isLoading } = useQuery<Email[]>({
    queryKey: ["/api/emails", selectedCategory],
    queryFn: async () => {
      const url =
        selectedCategory === "all"
          ? "/api/emails"
          : `/api/emails?classification=${encodeURIComponent(selectedCategory)}`;
      const response = await apiRequest("GET", url);
      return response.json();
    },
  });

  const classifyMutation = useMutation({
    mutationFn: async (emailId: number) => {
      const response = await apiRequest("POST", `/api/emails/${emailId}/classify`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/emails"] });
      toast({
        title: "분류 완료",
        description: "이메일이 성공적으로 분류되었습니다.",
      });
    },
  });

  const classifyAllMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/emails/classify-all");
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/emails"] });
      toast({
        title: "전체 분류 완료",
        description: `${data.classified}개의 이메일이 분류되었습니다.`,
      });
    },
    onError: () => {
      toast({
        title: "분류 실패",
        description: "이메일 분류 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  const extractEventsMutation = useMutation({
    mutationFn: async (emailId: number) => {
      setExtractingId(emailId);
      const response = await apiRequest("POST", `/api/events/extract/${emailId}`);
      return response.json() as Promise<EventExtractionResponse>;
    },
    onSuccess: (data) => {
      setExtractingId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      toast({
        title: "일정 추출 완료",
        description: `${data.events.length}개의 일정이 추출되었습니다.`,
      });
    },
    onError: () => {
      setExtractingId(null);
    },
  });

  const filteredEmails = emails || [];
  const isImportantEmail = (email: Email) => {
    const importanceValue = (email.importance || "").toLowerCase();
    if (importanceValue === "high") return true;

    const text = `${email.subject} ${email.body}`.toLowerCase();
    return ["긴급", "중요", "urgent", "important"].some((keyword) =>
      text.includes(keyword)
    );
  };

  const isReplyEmail = (email: Email) => {
    const text = `${email.subject} ${email.body}`.toLowerCase();
    return ["회신", "답변", "답장", "reply", "respond", "re:"].some((keyword) =>
      text.includes(keyword)
    );
  };

  const importantEmails = filteredEmails.filter(isImportantEmail);
  const replyEmails = filteredEmails.filter(isReplyEmail);
  const otherEmails = filteredEmails.filter(
    (email) => !isImportantEmail(email) && !isReplyEmail(email)
  );

  const categoryCount = CATEGORIES.map((cat) => ({
    ...cat,
    count:
      cat.id === "all"
        ? allEmails?.length || 0
        : allEmails?.filter((e) => e.classification === cat.id).length || 0,
  }));

  const buildDraftPrompt = (email: Email) => `다음 이메일을 확인하고 한국어로만 회신 초안을 작성해줘.

절대 규칙:
- 한국어만 사용
- 영어, 한자, 일본어, 베트남어, 태국어 등 다른 언어/문자 사용 금지
- 숫자/날짜 표기는 한국어 문장 안에서만 사용

요구사항:
- 정중한 비즈니스 톤
- 질문에 대한 답변 포함
- 다음 액션과 마감일을 명확히 제시
- 필요 시 확인해야 할 항목도 목록으로 제시

출력 형식(반드시 지켜):
제목: ...
내용:
...본문...

다음 액션:
1. ...
2. ...

마감일: ...

확인 항목:
1. ...
2. ...

[이메일]
제목: ${email.subject}
발신자: ${email.sender}
날짜: ${email.date}
내용:
${email.body}`;

  const generateDraft = async (email: Email) => {
    setDraftLoadingId(email.id);
    setDraftErrorByEmailId((prev) => ({ ...prev, [email.id]: "" }));
    try {
      const response = await apiRequest("POST", "/api/ai/chat", {
        message: buildDraftPrompt(email),
      });
      const data = (await response.json()) as { response?: string; answer?: string };
      const draft = (data.response || data.answer || "").trim();
      if (!draft) {
        throw new Error("AI 응답이 비어 있습니다.");
      }
      setDraftByEmailId((prev) => ({ ...prev, [email.id]: draft }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "초안 생성 중 오류가 발생했습니다.";
      setDraftErrorByEmailId((prev) => ({ ...prev, [email.id]: message }));
      toast({
        title: "초안 생성 실패",
        description: message,
        variant: "destructive",
      });
    } finally {
      setDraftLoadingId(null);
    }
  };

  useEffect(() => {
    if (!selectedEmail) return;
    setDetailTab("email");
  }, [selectedEmail?.id]);

  useEffect(() => {
    if (!selectedEmail) return;
    if (detailTab !== "draft") return;
    if (!isReplyEmail(selectedEmail)) return;
    if (draftByEmailId[selectedEmail.id]) return;
    if (draftLoadingId === selectedEmail.id) return;
    void generateDraft(selectedEmail);
  }, [detailTab, selectedEmail?.id]);

  const renderEmailCard = (email: Email) => (
    <Card
      key={email.id}
      className="hover:shadow-md transition-shadow cursor-pointer"
      onClick={() => {
        setSelectedEmail(email);
        setDetailTab("email");
      }}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold truncate flex items-center gap-1">
                {email.subject || "(제목 없음)"}

                {email.hasAttachment && (
                  <Paperclip className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
              </h3>
              {email.classification && (
                <Badge variant="secondary" className="shrink-0">
                  {email.classification}
                </Badge>
              )}
              {isImportantEmail(email) && (
                <Badge variant="destructive" className="shrink-0">
                  중요
                </Badge>
              )}
              {isReplyEmail(email) && (
                <Badge variant="outline" className="shrink-0">
                  회신
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                <span className="truncate max-w-[200px]">{email.sender}</span>
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>{email.date}</span>
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground line-clamp-1">
              {email.body}
            </p>
          </div>

          {email.isProcessed !== "true" && (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                classifyMutation.mutate(email.id);
              }}
              disabled={classifyMutation.isPending}
            >
              {classifyMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="flex h-screen">
      <div className="w-64 border-r bg-muted/20">
        <div className="p-4 border-b">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mail className="h-6 w-6" />
            메일함
          </h1>
        </div>
        <ScrollArea className="h-[calc(100vh-73px)]">
          <div className="p-2 space-y-1">
            {categoryCount.map((category) => {
              const Icon = category.icon;
              return (
                <Button
                  key={category.id}
                  variant={selectedCategory === category.id ? "secondary" : "ghost"}
                  className="w-full justify-start gap-2"
                  onClick={() => setSelectedCategory(category.id)}
                >
                  <Icon className="h-4 w-4" />
                  <span className="flex-1 text-left">{category.label}</span>
                  <Badge variant="outline" className="ml-auto">
                    {category.count}
                  </Badge>
                </Button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      <div className="flex-1 flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {CATEGORIES.find((c) => c.id === selectedCategory)?.label}
            <span className="text-muted-foreground ml-2">
              ({filteredEmails.length})
            </span>
          </h2>
          <Button
            variant="outline"
            onClick={() => classifyAllMutation.mutate()}
            disabled={classifyAllMutation.isPending}
          >
            {classifyAllMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                분류 중...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                전체 분류
              </>
            )}
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-6">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <Skeleton className="h-6 w-3/4 mb-2" />
                    <Skeleton className="h-4 w-1/2" />
                  </CardContent>
                </Card>
              ))
            ) : filteredEmails.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Mail className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>이메일이 없습니다</p>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-muted-foreground">
                      중요 메일
                    </h3>
                    <Badge variant="outline">{importantEmails.length}</Badge>
                  </div>
                  {importantEmails.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-4 text-center border rounded-md">
                      중요 메일이 없습니다
                    </div>
                  ) : (
                    <div className="space-y-2">{importantEmails.map(renderEmailCard)}</div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-muted-foreground">
                      회신 메일
                    </h3>
                    <Badge variant="outline">{replyEmails.length}</Badge>
                  </div>
                  {replyEmails.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-4 text-center border rounded-md">
                      회신 메일이 없습니다
                    </div>
                  ) : (
                    <div className="space-y-2">{replyEmails.map(renderEmailCard)}</div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-muted-foreground">기타</h3>
                    <Badge variant="outline">{otherEmails.length}</Badge>
                  </div>
                  {otherEmails.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-4 text-center border rounded-md">
                      기타 메일이 없습니다
                    </div>
                  ) : (
                    <div className="space-y-2">{otherEmails.map(renderEmailCard)}</div>
                  )}
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </div>

      <Dialog open={!!selectedEmail} onOpenChange={() => setSelectedEmail(null)}>
        <DialogContent className="max-w-4xl max-h-[95vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{selectedEmail?.subject || "(제목 없음)"}</DialogTitle>
          </DialogHeader>

          {selectedEmail && (
            <div className="flex-1 overflow-hidden flex flex-col gap-4">
              <Tabs value={detailTab} onValueChange={(value) => setDetailTab(value as DetailTab)}>
                <TabsList>
                  <TabsTrigger value="email">메일</TabsTrigger>
                  <TabsTrigger value="draft" disabled={!isReplyEmail(selectedEmail)}>
                    초안 작성
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="email">
                  <div className="space-y-4">
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">발신자:</span>
                        <span>{selectedEmail.sender}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">날짜:</span>
                        <span>{selectedEmail.date}</span>
                      </div>
                      {selectedEmail.classification && (
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">분류:</span>
                          <Badge variant="secondary">{selectedEmail.classification}</Badge>
                          {selectedEmail.classificationConfidence && (
                            <Badge variant="outline" className="text-xs">
                              신뢰도 {selectedEmail.classificationConfidence}
                            </Badge>
                          )}
                        </div>
                      )}

                      {selectedEmail.hasAttachment && (
                        <div className="flex items-center gap-2 text-sm">
                          <Paperclip className="h-4 w-4 text-muted-foreground" />
                          <span>첨부파일 포함</span>
                        </div>
                      )}
                    </div>

                    <div className="flex-1 overflow-y-auto border rounded-md p-4 bg-muted/50">
                      <p className="whitespace-pre-wrap text-sm">{selectedEmail.body}</p>
                    </div>

                    <div className="flex gap-2 pt-2 border-t">
                      {selectedEmail.isProcessed !== "true" && (
                        <Button
                          variant="outline"
                          onClick={() => classifyMutation.mutate(selectedEmail.id)}
                          disabled={classifyMutation.isPending}
                        >
                          {classifyMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <Sparkles className="h-4 w-4 mr-2" />
                          )}
                          분류하기
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => extractEventsMutation.mutate(selectedEmail.id)}
                        disabled={extractingId === selectedEmail.id}
                      >
                        {extractingId === selectedEmail.id ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <Calendar className="h-4 w-4 mr-2" />
                        )}
                        일정 추출
                      </Button>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="draft">
                  {isReplyEmail(selectedEmail) ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold">회신 초안</p>
                          <p className="text-xs text-muted-foreground">
                            탭에 들어오면 자동 생성되며 필요하면 재생성할 수 있습니다.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          onClick={() => generateDraft(selectedEmail)}
                          disabled={draftLoadingId === selectedEmail.id}
                        >
                          {draftLoadingId === selectedEmail.id ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              생성 중...
                            </>
                          ) : (
                            "재생성"
                          )}
                        </Button>
                      </div>

                      {draftErrorByEmailId[selectedEmail.id] && (
                        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                          {draftErrorByEmailId[selectedEmail.id]}
                        </div>
                      )}

                      <Textarea
                        value={draftByEmailId[selectedEmail.id] || ""}
                        placeholder="초안이 아직 없습니다. 잠시만 기다려 주세요."
                        className="min-h-[220px]"
                        onChange={(event) =>
                          setDraftByEmailId((prev) => ({
                            ...prev,
                            [selectedEmail.id]: event.target.value,
                          }))
                        }
                      />
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                      회신 메일에서만 초안 작성이 가능합니다.
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
