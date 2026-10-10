import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Button,
  FloatButton,
  Tag,
  Typography,
  message,
} from "antd";
import DailyDatePicker from "@/components/ui/DailyDatePicker";
import MarkdownEditor from "@/components/ui/MarkdownEditor";
import { CalendarCheck, Check, CircleAlert, LoaderCircle, RotateCcw } from "lucide-react";
import {
  dailyReviewApi,
  dailyScheduleApi,
  eventsApi,
  recurringActionsApi,
} from "@/lib/api";
import {
  getDefaultDailyReviewStatus,
  type OverallReviewStatus,
} from "@/lib/dailyReviewStatus";
import type {
  DailyReviewView,
  DailySchedule,
  Event,
} from "@/types";
import { REVIEW_REASON_BY_CODE, type ReviewReasonCode } from "@/lib/reviewReasons";

const localDate = (value = new Date()) => {
  const timezoneOffset = value.getTimezoneOffset() * 60 * 1000;
  return new Date(value.getTime() - timezoneOffset).toISOString().slice(0, 10);
};
const today = () => localDate();
const REVIEW_BACK_TOP_VISIBILITY_HEIGHT = 320;
type DraftSaveStatus = "idle" | "saving" | "saved" | "error";
const nextDate = (date: string) => {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + 1);
  return localDate(next);
};
const serializeDraft = (draft: {
  review_date: string;
  overall_status: string;
  reflection_text: string;
}) => JSON.stringify(draft);

const OVERALL_STATUS_COPY: Record<
  OverallReviewStatus,
  { label: string; description: string }
> = {
  smooth: {
    label: "顺利",
    description: "大多数时间段达到预期，并保持了专注。",
  },
  deviated: {
    label: "有偏差",
    description: "超过 30% 的时间段未达预期。",
  },
  chaotic: {
    label: "比较混乱",
    description: "超过 30% 的时间段未能保持专注。",
  },
};
export default function DailyReviewDemo() {
  const location = useLocation();
  const navigate = useNavigate();
  const [date, setDate] = useState(
    () =>
      (location.state as { reviewDate?: string } | null)?.reviewDate || today(),
  );
  const [data, setData] = useState<DailyReviewView | null>(null);
  const [schedule, setSchedule] = useState<DailySchedule | null>(null);
  const [actionScheduleDates, setActionScheduleDates] = useState<string[]>([]);
  const [inboxEvents, setInboxEvents] = useState<Event[]>([]);
  const [reflection, setReflection] = useState("");
  const [loading, setLoading] = useState(true);
  const [reviewBlocked, setReviewBlocked] = useState(false);
  const [showBackTop, setShowBackTop] = useState(false);
  const [draftSaveStatus, setDraftSaveStatus] = useState<DraftSaveStatus>("idle");
  const [draftSavedAt, setDraftSavedAt] = useState("");
  const [arrangingTomorrow, setArrangingTomorrow] = useState(false);
  const loadedDraftRef = useRef<string | null>(null);
  const savedStatusTimerRef = useRef<number | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const status = getDefaultDailyReviewStatus(schedule?.slots ?? []);

  const load = async (reviewDate: string) => {
    setLoading(true);
    try {
      const [
        review,
        daySchedule,
        events,
        nextActionScheduleDates,
      ] = await Promise.all([
        dailyReviewApi.get(reviewDate),
        dailyScheduleApi.get(reviewDate),
        eventsApi.list(),
        dailyScheduleApi.actionDates(),
      ]);
      const unreviewedSlots = daySchedule.slots.filter(
        (slot) =>
          slot.action_id != null &&
          (!slot.actual_notes?.trim() ||
            (slot.met_expectation !== 0 && slot.met_expectation !== 1) ||
            (slot.focused !== 0 && slot.focused !== 1)),
      );
      if (unreviewedSlots.length > 0) {
        setReviewBlocked(true);
        messageApi.warning(
          `还有 ${unreviewedSlots.length} 个已安排行动的时间段未完成复盘，请先补齐。`,
        );
        navigate("/daily-list", { state: { date: reviewDate }, replace: true });
        return;
      }
      setReviewBlocked(false);
      setData(review);
      setSchedule(daySchedule);
      setActionScheduleDates(nextActionScheduleDates);
      setInboxEvents(events.filter((event) => event.status === 0));
      setReflection(review.review.reflection_text || "");
      loadedDraftRef.current = serializeDraft({
        review_date: reviewDate,
        overall_status: getDefaultDailyReviewStatus(daySchedule.slots),
        reflection_text: review.review.reflection_text || "",
      });
    } catch (error) {
      messageApi.error(String(error).replace(/^Error: /, ""));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load(date);
  }, [date]);
  useEffect(() => {
    const scrollContainer = document.querySelector<HTMLElement>(".main-content");
    if (!scrollContainer) return;
    const updateBackTopVisibility = () => {
      setShowBackTop(scrollContainer.scrollTop > REVIEW_BACK_TOP_VISIBILITY_HEIGHT);
    };
    updateBackTopVisibility();
    scrollContainer.addEventListener("scroll", updateBackTopVisibility, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", updateBackTopVisibility);
  }, []);
  useEffect(() => {
    if (!data || loading) return;
    const draft = {
      review_date: date,
      overall_status: status,
      reflection_text: reflection,
    };
    const serializedDraft = serializeDraft(draft);
    if (serializedDraft === loadedDraftRef.current) return;

    let cancelled = false;
    if (savedStatusTimerRef.current != null) {
      window.clearTimeout(savedStatusTimerRef.current);
      savedStatusTimerRef.current = null;
    }
    setDraftSaveStatus("saving");
    const timer = window.setTimeout(() => {
      void dailyReviewApi
        .saveDraft(draft)
        .then(() => {
          if (cancelled) return;
          loadedDraftRef.current = serializedDraft;
          setDraftSavedAt(new Intl.DateTimeFormat("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(new Date()));
          setDraftSaveStatus("saved");
          savedStatusTimerRef.current = window.setTimeout(() => {
            setDraftSaveStatus("idle");
            savedStatusTimerRef.current = null;
          }, 3000);
        })
        .catch((error) => {
          if (cancelled) return;
          setDraftSaveStatus("error");
          messageApi.error({
            key: "daily-review-draft-save-error",
            content: `草稿保存失败：${String(error).replace(/^Error: /, "")}`,
          });
        });
    }, 700);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    date,
    status,
    reflection,
    data,
    loading,
  ]);
  useEffect(() => () => {
    if (savedStatusTimerRef.current != null) {
      window.clearTimeout(savedStatusTimerRef.current);
    }
  }, []);

  const statusCopy = OVERALL_STATUS_COPY[status];

  const arrangeTomorrow = async () => {
    const tomorrow = nextDate(date);
    setArrangingTomorrow(true);
    try {
      await recurringActionsApi.initializeForDate(tomorrow, "daily_review");
      navigate("/daily-list", {
        state: {
          date: tomorrow,
          showReviewSuggestions: true,
          sourceReviewDate: date,
        },
      });
    } catch (error) {
      messageApi.error(`安排明日重复行动失败：${String(error).replace(/^Error: /, "")}`);
    } finally {
      setArrangingTomorrow(false);
    }
  };

  const plannedActionCount = data?.summary.planned_event_count || 0;
  const completedActionCount = data?.summary.completed_event_count || 0;
  const incompleteActionCount = data?.summary.incomplete_event_count || 0;
  const completionRate = plannedActionCount
    ? Math.round((completedActionCount / plannedActionCount) * 100)
    : 0;

  const quadrants = useMemo(() => {
    const source = (() => {
      try {
        return JSON.parse(data?.summary.quadrants_json || "{}");
      } catch {
        return {} as Record<
          string,
          { count?: number; completed_count?: number; planned_minutes?: number }
        >;
      }
    })() as Record<
      string,
      { count?: number; completed_count?: number; planned_minutes?: number }
    >;
    return [
      ["重要且紧急", "11"],
      ["重要不紧急", "10"],
      ["不重要且紧急", "01"],
      ["不重要不紧急", "00"],
    ].map(([name, key]) => ({
      name,
      count: source[key]?.count || 0,
      minutes: source[key]?.planned_minutes || 0,
      done: source[key]?.completed_count || 0,
    }));
  }, [data]);
  const quadrantActionCount = useMemo(
    () => quadrants.reduce((total, item) => total + item.count, 0),
    [quadrants],
  );
  const quadrantPlannedMinutes = useMemo(
    () => quadrants.reduce((total, item) => total + item.minutes, 0),
    [quadrants],
  );

  const slotReviewSummary = useMemo(() => {
    const reviewedSlots = (schedule?.slots ?? []).filter((slot) => slot.action_id != null && slot.actual_notes?.trim());
    const unmetCount = reviewedSlots.filter((slot) => slot.met_expectation === 0).length;
    const unfocusedCount = reviewedSlots.filter((slot) => slot.focused === 0).length;
    const reasons = new Map<ReviewReasonCode, { count: number; slots: string[] }>();
    reviewedSlots.forEach((slot) => {
      const reason = slot.primary_review_reason;
      if (!reason || (slot.met_expectation !== 0 && slot.focused !== 0)) return;
      const current = reasons.get(reason) ?? { count: 0, slots: [] };
      current.count += 1;
      current.slots.push(`${slot.start_time}–${slot.end_time}`);
      reasons.set(reason, current);
    });
    return { reviewedCount: reviewedSlots.length, unmetCount, unfocusedCount, reasons: [...reasons.entries()].sort((left, right) => right[1].count - left[1].count) };
  }, [schedule]);
  const reflectionGuide = useMemo(() => {
    const plannedCount = data?.summary.planned_event_count || 0;
    const completedCount = data?.summary.completed_event_count || 0;
    const completionRate = plannedCount
      ? Math.round((completedCount / plannedCount) * 100)
      : 0;
    const importantNotUrgentCount = quadrants.find(
      (item) => item.name === "重要不紧急",
    )?.count || 0;
    const importantNotUrgentRate = quadrantActionCount
      ? Math.round((importantNotUrgentCount / quadrantActionCount) * 100)
      : 0;
    const statusLabel = {
      smooth: "顺利",
      deviated: "有偏差",
      chaotic: "比较混乱",
    }[status];
    const prompts = {
      smooth: [
        "今天都做了什么，推进了哪些重要的事",
        "对哪些比较满意，那些不满意",
        "有什么收获？",
        "明天的规划是什么",
      ],
      deviated: [
        "推进了什么重要的事？",
        "对哪些满意，哪些不满意？",
        "有什么收获？",
        "今日出现的问题有没有解决思路？",
      ],
      chaotic: [
        "最影响今天节奏的因素是什么？",
        "哪些事其实可以不做或晚些做？",
        "明天先保护哪段时间？",
        "今日出现的问题有没有解决思路？",
      ],
    }[status];

    return {
      facts: [
        {
          label: "行动完成度",
          value: `${completedCount}/${plannedCount} · ${completionRate}%`,
        },
        {
          label: "重要不紧急",
          value: `${importantNotUrgentCount}/${quadrantActionCount} · ${importantNotUrgentRate}%`,
        },
        { label: "执行状态", value: statusLabel },
      ],
      prompts,
    };
  }, [data, quadrantActionCount, quadrants, status]);
  const changeDate = (nextReviewDate: string) => {
    if (!nextReviewDate || nextReviewDate === date) return;
    setLoading(true);
    setReviewBlocked(false);
    setData(null);
    setSchedule(null);
    setReflection("");
    loadedDraftRef.current = null;
    setDraftSaveStatus("idle");
    setDate(nextReviewDate);
  };

  if (reviewBlocked) return null;
  if (loading)
    return (
      <div className="page daily-review-demo-page">
        <div className="review-empty-state">
          正在读取 {date} 的任务和执行记录…
        </div>
      </div>
    );
  return (
    <div className="page daily-review-demo-page">
      {contextHolder}
      <header className="page-header review-demo-header">
        <div>
          <div className="review-title-row">
            <Typography.Title level={2} className="page-title">
              每日复盘
            </Typography.Title>
            <Button
              type="text"
              className="review-back-button"
              icon={<RotateCcw size={16} strokeWidth={2} />}
              onClick={() => navigate("/daily-list", { state: { date } })}
            >
              返回今日事
            </Button>
          </div>
          <Typography.Paragraph className="page-subtitle">
            用10分钟整理今天，把复盘变成明天可执行的改变。
          </Typography.Paragraph>
        </div>
        <DailyDatePicker
          date={date}
          onChange={changeDate}
          actionScheduleDates={actionScheduleDates}
          disableFutureDates
        />
      </header>
      <div className="review-layout">
        <main className="review-main">
          <section className="review-section">
            <div className="review-section-title">
              <div className="review-step">1</div>
              <div>
                <h3>今天过得怎么样？</h3>
              </div>
            </div>
            <div className="review-summary-workspace">
              <div className="review-completion-panel">
                <div className="review-completion-heading">
                  <strong>行动完成度</strong>
                  <span>今日已排程行动的完成情况</span>
                </div>
                <div className="review-overview">
                  <div className="review-overview-stat review-overview-planned">
                    <strong>{plannedActionCount}</strong>
                    <span>计划行动</span>
                  </div>
                  <div className="review-overview-stat review-overview-events">
                    <strong>{data?.summary.involved_event_count || 0}</strong>
                    <span>涉及事件</span>
                  </div>
                  <div className="review-overview-stat review-overview-completion">
                    <div className="review-overview-completion-values">
                      <strong className="is-done">{completedActionCount}</strong>
                      <span>/</span>
                      <strong className="is-pending">{incompleteActionCount}</strong>
                    </div>
                    <span>已完成 / 未完成</span>
                  </div>
                  <div className="review-overview-stat review-overview-rate">
                    <strong>{completionRate}%</strong>
                    <span>今日完成度</span>
                  </div>
                </div>
              </div>
              <div className="review-priority-panel">
                <div className="review-priority-heading">
                  <div>
                    <strong>行动安排优先级</strong>
                    <span>
                      今日已排程行动的 importance / urgency
                    </span>
                  </div>
                  <span className="review-priority-total">
                    {quadrantActionCount} 项
                  </span>
                </div>
                <div className="review-priority-quadrants">
                  {quadrants.map((item, index) => (
                    <div className={`quadrant q${index + 1}`} key={item.name}>
                      <span>{item.name}</span>
                      <strong>
                        {item.count} 项 ·{" "}
                        {quadrantPlannedMinutes
                          ? Math.round(
                              (item.minutes / quadrantPlannedMinutes) * 100,
                            )
                          : 0}
                        % 时间
                      </strong>
                      <small>
                        {item.minutes} 分钟计划 · {item.done} 项完成
                      </small>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="review-execution-trace">
              <div className="review-execution-trace-heading">
                <div>
                  <strong>今日执行轨迹</strong>
                  <span>
                    时间段复盘记录，标记执行偏差，帮助明日优化安排。
                  </span>
                </div>
                <span className="review-execution-trace-count">
                  {schedule?.slots?.length || 0} 段
                </span>
              </div>
              {schedule?.slots?.length ? (
                <div className="review-execution-timeline">
                  {schedule.slots.map((slot) => {
                    const actionTitle =
                      slot.action?.title?.trim() || "未绑定行动";
                    const note = slot.actual_notes?.trim() || "";
                    const normalizeTraceText = (value: string) =>
                      value.replace(/[\s·•—–:：，,。.!！?？-]/g, "");
                    const normalizedTitle = normalizeTraceText(actionTitle);
                    const normalizedNote = normalizeTraceText(note);
                    const isDuplicateNote = Boolean(
                      normalizedTitle &&
                      [
                        normalizedTitle,
                        `完成${normalizedTitle}`,
                        `已完成${normalizedTitle}`,
                        `${normalizedTitle}完成`,
                        `${normalizedTitle}完成${normalizedTitle}`,
                      ].includes(normalizedNote),
                    );
                    const hasMeaningfulNote = Boolean(note) && !isDuplicateNote;
                    const hasReview = Boolean(
                      hasMeaningfulNote ||
                      slot.met_expectation !== null ||
                      slot.focused !== null,
                    );
                    const isWarning = slot.met_expectation === 0;
                    const isUnfocused = slot.focused === 0;
                    const status =
                      slot.met_expectation === 1
                        ? "达到预期"
                        : slot.met_expectation === 0
                          ? "未达预期"
                          : "未复盘";
                    const focus =
                      slot.focused === 1
                        ? "保持专注"
                        : slot.focused === 0
                          ? "没有专注"
                          : null;
                    const reviewReason = slot.primary_review_reason
                      ? REVIEW_REASON_BY_CODE[slot.primary_review_reason]
                      : null;
                    return (
                      <article
                        className={`review-trace-item ${
                          isWarning ? "is-warning" : ""
                        } ${isUnfocused ? "is-unfocused" : ""} ${
                          !hasReview ? "is-muted" : ""
                        }`}
                        key={slot.id}
                      >
                        <time>
                          {slot.start_time}–{slot.end_time}
                        </time>
                        <i aria-hidden="true" />
                        <div className="review-trace-content">
                          <div className="review-trace-title-row">
                            <strong>{actionTitle}</strong>
                            <div className="review-trace-tags">
                              <span className={isWarning ? "warn" : "good"}>
                                {status}
                              </span>
                              {focus && (
                                <span
                                  className={
                                    slot.focused === 0 ? "danger" : "good"
                                  }
                                >
                                  {focus}
                                </span>
                              )}
                            </div>
                          </div>
                          <p className={!hasMeaningfulNote ? "is-muted" : ""}>
                            {reviewReason && (
                              <span className="review-trace-reason">
                                {reviewReason.label}
                              </span>
                            )}
                            {hasMeaningfulNote ? note : "未填写有效复盘备注"}
                          </p>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="review-trace-empty">
                  今天还没有时间段复盘记录。
                </div>
              )}
            </div>
            <div className="review-slot-summary" aria-label="当天时间段复盘汇总与整体状态">
              <div className="review-slot-summary-heading">
                <div>
                  <strong>时间段复盘汇总</strong>
                  <span>基于当天已填写的时间段复盘自动生成</span>
                </div>
              </div>
              <div
                className={`review-overall-status is-${status}`}
                aria-label={`今日整体状态：${statusCopy.label}`}
              >
                <span>今日整体状态</span>
                <strong>{statusCopy.label}</strong>
                <small>{statusCopy.description}</small>
              </div>
              <div className="review-slot-summary-stats">
                <span>已复盘 <strong>{slotReviewSummary.reviewedCount}</strong> 段</span>
                <span>未达预期 <strong>{slotReviewSummary.unmetCount}</strong> 段</span>
                <span>未专注 <strong>{slotReviewSummary.unfocusedCount}</strong> 段</span>
              </div>
              {slotReviewSummary.reasons.length > 0 ? (
                <div className="review-slot-summary-reasons">
                  {slotReviewSummary.reasons.map(([reason, detail]) => (
                    <div key={reason}>
                      <strong><CircleAlert aria-hidden="true" />{REVIEW_REASON_BY_CODE[reason].label}</strong>
                      <span>{detail.count} 段 · {detail.slots.join("、")}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="review-slot-summary-empty">当天没有需要归因的时间段。</p>}
            </div>
          </section>
          <section className="review-section review-reflection-section">
            <div className="review-section-title">
              <div className="review-step">2</div>
              <div>
                <h3>今日复盘思考</h3>
              </div>
            </div>
            <div className="review-reflection-workspace">
              <aside className="review-reflection-guide">
                <div className="review-reflection-guide-title">
                  吾日三省吾身，可参考以下思路
                </div>
                <div
                  className="review-reflection-prompts"
                  id="reflection-prompts"
                >
                  <div
                    className="review-reflection-facts"
                    aria-label="今日复盘事实"
                  >
                    {reflectionGuide.facts.map((fact) => (
                      <div key={fact.label}>
                        <span>{fact.label}</span>
                        <strong>{fact.value}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="review-reflection-question-heading">
                    可从以下问题开始思考
                  </div>
                  <ul className="review-reflection-question-list">
                    {reflectionGuide.prompts.map((prompt) => (
                      <li key={prompt}>{prompt}</li>
                    ))}
                  </ul>
                </div>
              </aside>
              <div className="review-reflection-input-fill">
                <MarkdownEditor
                  className="review-reflection-editor"
                  value={reflection}
                  onChange={setReflection}
                  placeholder="写下今天的复盘思考…"
                  minHeight={280}
                  showToolbar
                />
              </div>
            </div>
          </section>
          <section className="review-section review-tomorrow-guide-section">
            <div className="review-section-title">
              <div className="review-step">3</div>
              <div>
                <h3>明天会更好</h3>
                <p>先清空事件篮，再安排明日行动并选好一只青蛙行动。</p>
              </div>
            </div>
            <div className="review-tomorrow-guide">
              <div
                className={`review-tomorrow-guide-step ${
                  inboxEvents.length === 0 ? "is-complete" : ""
                }`}
              >
                <span className="review-guide-step-number">1</span>
                <div className="review-guide-step-copy">
                  <strong>清空事件篮待处理</strong>
                  <span>
                    {inboxEvents.length
                      ? `还有 ${inboxEvents.length} 条待处理事项，先完成归类、拆分或安排。`
                      : "事件篮已清空，可以开始准备明日计划。"}
                  </span>
                </div>
                {inboxEvents.length ? (
                  <Button type="primary" onClick={() => navigate("/inbox")}>
                    去处理事件篮
                  </Button>
                ) : (
                  <Tag color="green">已清空</Tag>
                )}
              </div>
              <div
                className={`review-tomorrow-guide-step ${
                  inboxEvents.length ? "is-locked" : ""
                }`}
              >
                <span className="review-guide-step-number">2</span>
                <div className="review-guide-step-copy">
                  <strong>安排明日行动，选好青蛙</strong>
                  <span>
                    基于今日复盘，认真做好明日规划，珍惜每一次成长的机会
                  </span>
                </div>
                <div className="review-tomorrow-action-button">
                  <Button
                    type="primary"
                    disabled={inboxEvents.length > 0}
                    loading={arrangingTomorrow}
                    onClick={() => void arrangeTomorrow()}
                  >
                    去安排明日计划
                  </Button>
                  {inboxEvents.length > 0 && (
                    <button
                      type="button"
                      className="review-tomorrow-action-lock"
                      aria-label="请先清空待处理事件篮"
                      onClick={() => messageApi.warning("请先清空待处理事件篮")}
                    />
                  )}
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
      <div className="review-page-bottom-spacer" aria-hidden="true" />
      {draftSaveStatus !== "idle" && (
        <div className={`review-autosave-status is-${draftSaveStatus}`} role="status" aria-live="polite">
          {draftSaveStatus === "saving" && <LoaderCircle className="review-autosave-spinner" size={15} />}
          {draftSaveStatus === "saved" && <Check size={15} />}
          {draftSaveStatus === "error" && <CircleAlert size={15} />}
          <span>
            {draftSaveStatus === "saving" && "正在自动保存…"}
            {draftSaveStatus === "saved" && `已自动保存 ${draftSavedAt}`}
            {draftSaveStatus === "error" && "自动保存失败"}
          </span>
        </div>
      )}
      {showBackTop ? (
        <FloatButton.Group
          shape="square"
          style={{ insetInlineEnd: 28, bottom: 24 }}
        >
          <FloatButton.BackTop
            target={() => document.querySelector<HTMLElement>(".main-content") ?? window}
            visibilityHeight={0}
            tooltip="回到顶部"
          />
          <FloatButton
            icon={<CalendarCheck size={18} aria-hidden="true" />}
            tooltip="返回今日事"
            onClick={() => navigate("/daily-list", { state: { date } })}
          />
        </FloatButton.Group>
      ) : (
        <FloatButton
          shape="square"
          style={{ insetInlineEnd: 28, bottom: 24 }}
          icon={<CalendarCheck size={18} aria-hidden="true" />}
          tooltip="返回今日事"
          onClick={() => navigate("/daily-list", { state: { date } })}
        />
      )}
    </div>
  );
}


