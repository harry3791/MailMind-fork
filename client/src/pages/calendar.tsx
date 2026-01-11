import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Calendar as CalendarIcon,
  MapPin,
  Clock,
  FileText,
  Mail,
  User,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isValid,
  parse,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type { CalendarEvent, Email } from "@shared/schema";

type CalendarView = "month" | "week" | "day";

type EventWithMeta = CalendarEvent & {
  start: Date | null;
  end: Date | null;
  classification?: string;
};

const CLASSIFICATION_META: Record<
  string,
  { label: string; dot: string; badge: string }
> = {
  업무요청: {
    label: "업무요청",
    dot: "bg-blue-500",
    badge: "border-blue-200 bg-blue-50 text-blue-700",
  },
  회의: {
    label: "회의",
    dot: "bg-emerald-500",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  결재요청: {
    label: "결재요청",
    dot: "bg-amber-500",
    badge: "border-amber-200 bg-amber-50 text-amber-700",
  },
  공지: {
    label: "공지",
    dot: "bg-rose-500",
    badge: "border-rose-200 bg-rose-50 text-rose-700",
  },
};

const FALLBACK_CLASSIFICATION = {
  label: "미분류",
  dot: "bg-slate-400",
  badge: "border-slate-200 bg-slate-50 text-slate-600",
};

const VIEW_OPTIONS: Array<{ id: CalendarView; label: string }> = [
  { id: "month", label: "월간" },
  { id: "week", label: "주간" },
  { id: "day", label: "일간" },
];

const WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const DATE_FORMATS = ["yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd HH:mm", "yyyy-MM-dd"];
const WEEK_STARTS_ON = 1;

function getClassificationMeta(classification?: string | null) {
  if (!classification) return FALLBACK_CLASSIFICATION;
  return CLASSIFICATION_META[classification] || {
    label: classification,
    dot: FALLBACK_CLASSIFICATION.dot,
    badge: FALLBACK_CLASSIFICATION.badge,
  };
}

function parseEventDate(value?: string | null): Date | null {
  if (!value) return null;

  for (const formatString of DATE_FORMATS) {
    const parsed = parse(value, formatString, new Date());
    if (isValid(parsed)) return parsed;
  }

  const fallback = new Date(value);
  return isValid(fallback) ? fallback : null;
}

function getDayKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function hasTime(value?: string | null) {
  return Boolean(value && value.includes(":"));
}

function EventChip({
  event,
  onClick,
  compact = false,
  showTime = false,
}: {
  event: EventWithMeta;
  onClick: () => void;
  compact?: boolean;
  showTime?: boolean;
}) {
  const meta = getClassificationMeta(event.classification);
  const timeLabel =
    showTime && event.start
      ? hasTime(event.startDate)
        ? format(event.start, "HH:mm")
        : "종일"
      : null;

  return (
    <button
      type="button"
      className={`flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-xs transition hover:bg-muted/50 ${
        compact ? "border-transparent px-0" : meta.badge
      }`}
      onClick={onClick}
    >
      <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
      {showTime && timeLabel && (
        <span className="text-[11px] text-muted-foreground">{timeLabel}</span>
      )}
      <span className="flex-1 truncate font-medium">{event.title}</span>
    </button>
  );
}

function EventCard({
  event,
  onClick,
}: {
  event: EventWithMeta;
  onClick: () => void;
}) {
  const meta = getClassificationMeta(event.classification);
  return (
    <Card className="hover-elevate cursor-pointer" onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3
                className="font-semibold text-lg truncate"
                data-testid={`event-title-${event.id}`}
              >
                {event.title}
              </h3>
              {event.classification && (
                <Badge variant="outline" className={meta.badge}>
                  {meta.label}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>{event.startDate}</span>
                {event.endDate && <span>~ {event.endDate}</span>}
              </span>
              {event.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  <span>{event.location}</span>
                </span>
              )}
            </div>
            {event.description && (
              <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                {event.description}
              </p>
            )}
          </div>
          {event.emailId && (
            <Badge variant="outline" className="shrink-0">
              <FileText className="h-3 w-3 mr-1" />
              이메일 #{event.emailId}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function CalendarPage() {
  const [selectedEvent, setSelectedEvent] = useState<EventWithMeta | null>(null);
  const [view, setView] = useState<CalendarView>("month");
  const [activeDate, setActiveDate] = useState(() => new Date());

  const { data: events, isLoading } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/events"],
  });

  const { data: emails } = useQuery<Email[]>({
    queryKey: ["/api/emails"],
  });

  const emailById = useMemo(() => {
    return new Map((emails || []).map((email) => [email.id, email]));
  }, [emails]);

  const eventsWithMeta = useMemo<EventWithMeta[]>(() => {
    return (events || [])
      .map((event) => {
        const email = event.emailId ? emailById.get(event.emailId) : undefined;
        return {
          ...event,
          start: parseEventDate(event.startDate),
          end: parseEventDate(event.endDate),
          classification: email?.classification ?? undefined,
        };
      })
      .sort((a, b) => {
        const aTime = a.start?.getTime() ?? 0;
        const bTime = b.start?.getTime() ?? 0;
        return aTime - bTime;
      });
  }, [events, emailById]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventWithMeta[]>();
    for (const event of eventsWithMeta) {
      if (!event.start) continue;
      const key = getDayKey(event.start);
      if (!map.has(key)) map.set(key, []);
      map.get(key)?.push(event);
    }
    return map;
  }, [eventsWithMeta]);

  const calendarTitle = useMemo(() => {
    if (view === "month") {
      return format(activeDate, "yyyy년 M월");
    }
    if (view === "week") {
      const weekStart = startOfWeek(activeDate, { weekStartsOn: WEEK_STARTS_ON });
      const weekEnd = endOfWeek(activeDate, { weekStartsOn: WEEK_STARTS_ON });
      return `${format(weekStart, "M월 d일")} - ${format(weekEnd, "M월 d일")}`;
    }
    return format(activeDate, "yyyy년 M월 d일");
  }, [activeDate, view]);

  const handlePrev = () => {
    setActiveDate((prev) => {
      if (view === "month") return addMonths(prev, -1);
      if (view === "week") return addWeeks(prev, -1);
      return addDays(prev, -1);
    });
  };

  const handleNext = () => {
    setActiveDate((prev) => {
      if (view === "month") return addMonths(prev, 1);
      if (view === "week") return addWeeks(prev, 1);
      return addDays(prev, 1);
    });
  };

  const handleToday = () => setActiveDate(new Date());

  const monthDays = useMemo(() => {
    const monthStart = startOfMonth(activeDate);
    const monthEnd = endOfMonth(activeDate);
    const start = startOfWeek(monthStart, { weekStartsOn: WEEK_STARTS_ON });
    const end = endOfWeek(monthEnd, { weekStartsOn: WEEK_STARTS_ON });
    const days: Date[] = [];
    let day = start;
    while (day <= end) {
      days.push(day);
      day = addDays(day, 1);
    }
    return { days, monthStart };
  }, [activeDate]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(activeDate, { weekStartsOn: WEEK_STARTS_ON });
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }, [activeDate]);

  const dayEvents = useMemo(() => {
    const key = getDayKey(activeDate);
    return eventsByDay.get(key) || [];
  }, [activeDate, eventsByDay]);

  const { data: email, isLoading: isEmailLoading } = useQuery<Email>({
    queryKey: ["/api/conversations", selectedEvent?.emailId],
    enabled: !!selectedEvent?.emailId,
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary p-2">
                <CalendarIcon className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">일정</h1>
                <p className="text-xs text-muted-foreground">
                  이메일에서 추출된 일정 목록
                </p>
              </div>
            </div>
            {events && (
              <Badge variant="outline" className="gap-1">
                <CalendarIcon className="h-3 w-3" />
                {events.length}건 일정
              </Badge>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <Button variant="outline" size="icon" onClick={handlePrev}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div>
                  <p className="text-sm text-muted-foreground">캘린더</p>
                  <h2 className="text-lg font-semibold">{calendarTitle}</h2>
                </div>
                <Button variant="outline" size="icon" onClick={handleNext}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button variant="secondary" onClick={handleToday}>
                  오늘
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 rounded-full bg-muted p-1">
                  {VIEW_OPTIONS.map((option) => (
                    <Button
                      key={option.id}
                      size="sm"
                      variant={view === option.id ? "default" : "ghost"}
                      onClick={() => setView(option.id)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {Object.values(CLASSIFICATION_META).map((meta) => (
                    <Badge
                      key={meta.label}
                      variant="outline"
                      className={`gap-2 ${meta.badge}`}
                    >
                      <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                      {meta.label}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-6 w-1/3" />
                <Skeleton className="h-40 w-full" />
              </div>
            ) : (
              <>
                {view === "month" && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-7 gap-2 text-xs text-muted-foreground">
                      {WEEKDAY_LABELS.map((label) => (
                        <div key={label} className="text-center">
                          {label}
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-2">
                      {monthDays.days.map((day) => {
                        const key = getDayKey(day);
                        const dayEvents = eventsByDay.get(key) || [];
                        const isOutside = !isSameMonth(day, monthDays.monthStart);
                        const isSelected = isSameDay(day, activeDate);

                        return (
                          <div
                            key={key}
                            className={`min-h-[120px] rounded-lg border p-2 ${
                              isOutside ? "bg-muted/30 text-muted-foreground" : "bg-background"
                            }`}
                          >
                            <button
                              type="button"
                              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                                isSelected
                                  ? "bg-primary text-primary-foreground"
                                  : "hover:bg-muted"
                              }`}
                              onClick={() => setActiveDate(day)}
                            >
                              {format(day, "d")}
                            </button>
                            <div className="mt-2 space-y-1">
                              {dayEvents.slice(0, 3).map((event) => (
                                <EventChip
                                  key={event.id}
                                  event={event}
                                  compact
                                  onClick={() => setSelectedEvent(event)}
                                />
                              ))}
                              {dayEvents.length > 3 && (
                                <button
                                  type="button"
                                  className="text-[11px] text-muted-foreground hover:underline"
                                  onClick={() => setActiveDate(day)}
                                >
                                  +{dayEvents.length - 3}건 더보기
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {view === "week" && (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-7">
                    {weekDays.map((day) => {
                      const key = getDayKey(day);
                      const dayEvents = eventsByDay.get(key) || [];
                      const isSelected = isSameDay(day, activeDate);

                      return (
                        <div
                          key={key}
                          className={`rounded-lg border p-3 ${
                            isSelected ? "border-primary/50 bg-primary/5" : "bg-background"
                          }`}
                        >
                          <button
                            type="button"
                            className="flex w-full items-center justify-between text-sm font-semibold"
                            onClick={() => setActiveDate(day)}
                          >
                            <span>{format(day, "M/d")}</span>
                            <span className="text-xs text-muted-foreground">
                              {WEEKDAY_LABELS[day.getDay() === 0 ? 6 : day.getDay() - 1]}
                            </span>
                          </button>
                          <div className="mt-3 space-y-2">
                            {dayEvents.length === 0 && (
                              <p className="text-xs text-muted-foreground">일정 없음</p>
                            )}
                            {dayEvents.map((event) => (
                              <EventChip
                                key={event.id}
                                event={event}
                                showTime
                                onClick={() => setSelectedEvent(event)}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {view === "day" && (
                  <div className="rounded-lg border p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">선택한 날짜</p>
                        <h3 className="text-lg font-semibold">
                          {format(activeDate, "yyyy년 M월 d일")}
                        </h3>
                      </div>
                      <Badge variant="outline">{dayEvents.length}건</Badge>
                    </div>
                    <div className="mt-4 space-y-3">
                      {dayEvents.length === 0 && (
                        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                          일정이 없습니다.
                        </div>
                      )}
                      {dayEvents.map((event) => (
                        <EventChip
                          key={event.id}
                          event={event}
                          showTime
                          onClick={() => setSelectedEvent(event)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <Skeleton className="h-6 w-3/4 mb-2" />
                  <Skeleton className="h-4 w-1/2 mb-4" />
                  <Skeleton className="h-12 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : eventsWithMeta.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="rounded-full bg-muted p-4 mb-4">
                <CalendarIcon className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="font-semibold mb-2">일정이 없습니다</h3>
              <p className="text-sm text-muted-foreground text-center max-w-md">
                메일 검수 결과에서 "일정 추출" 버튼을 눌러 이메일의 일정을
                추출해보세요.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4" data-testid="events-list">
            {eventsWithMeta.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                onClick={() => setSelectedEvent(event)}
              />
            ))}
          </div>
        )}

        <Dialog open={!!selectedEvent} onOpenChange={(open) => !open && setSelectedEvent(null)}>
          <DialogContent className="max-w-4xl max-h-[95vh] flex flex-col">
            <DialogHeader className="flex-shrink-0">
              <DialogTitle>{selectedEvent?.title}</DialogTitle>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto pr-2">
              {selectedEvent && (
                <div className="space-y-4">
                  <div className="grid gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">일정:</span>
                      <span>{selectedEvent.startDate}</span>
                      {selectedEvent.endDate && <span>~ {selectedEvent.endDate}</span>}
                    </div>

                    {selectedEvent.classification && (
                      <div className="flex items-center gap-2">
                        <span className="font-medium">분류:</span>
                        <Badge
                          variant="outline"
                          className={getClassificationMeta(selectedEvent.classification).badge}
                        >
                          {getClassificationMeta(selectedEvent.classification).label}
                        </Badge>
                      </div>
                    )}

                    {selectedEvent.location && (
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">장소:</span>
                        <span>{selectedEvent.location}</span>
                      </div>
                    )}

                    {selectedEvent.description && (
                      <div className="flex items-start gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                        <div className="flex-1">
                          <span className="font-medium">상세 내용:</span>
                          <p className="mt-1 text-muted-foreground">
                            {selectedEvent.description}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {isEmailLoading && (
                    <div className="border-t pt-4">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm text-muted-foreground">
                          원본 이메일 로딩 중...
                        </span>
                      </div>
                    </div>
                  )}

                  {!isEmailLoading && email && (
                    <div className="border-t pt-4">
                      <h3 className="font-semibold mb-3 flex items-center gap-2">
                        <Mail className="h-4 w-4" />
                        원본 이메일
                      </h3>
                      <div className="space-y-3">
                        <div>
                          <span className="text-sm font-medium">제목:</span>
                          <p className="text-sm text-muted-foreground mt-1">{email.subject}</p>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <User className="h-3 w-3 text-muted-foreground" />
                          <span className="font-medium">발신자:</span>
                          <span className="text-muted-foreground">{email.sender}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          <span className="font-medium">날짜:</span>
                          <span className="text-muted-foreground">{email.date}</span>
                        </div>
                        <div>
                          <span className="text-sm font-medium">내용:</span>
                          <div className="mt-2 p-4 bg-muted rounded-md">
                            <p className="text-sm whitespace-pre-wrap">{email.body}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {!isEmailLoading && !email && selectedEvent?.emailId && (
                    <div className="border-t pt-4">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <AlertCircle className="h-4 w-4" />
                        <span>원본 이메일을 찾을 수 없습니다.</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
