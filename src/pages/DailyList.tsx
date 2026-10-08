import { useEffect, useMemo, useRef, useState, type SVGProps } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import dayjs, { type Dayjs } from "dayjs";
import {
  Alert,
  Button,
  Checkbox,
  DatePicker,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal as AntModal,
  Popconfirm,
  Select,
  Space,
  Tag,
  Tooltip,
  Dropdown,
  Typography,
  Radio,
  message,
} from "antd";
import {
  ArrowRight,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  FileText,
  ListChecks,
  Pencil,
  Plus,
  RotateCcw,
  ListTree,
  Rows3,
  CircleHelp,
} from "lucide-react";
import { actionsApi, dailyReviewApi, dailyScheduleApi, recurringActionsApi } from "@/lib/api";
import type {
  Action,
  DailySchedule,
  DailyScheduleSlot,
  DailyTemplateSlot,
  NewAction,
  NewRecurringAction,
  RecurringAction,
  UpdateRecurringAction,
  DailyReviewSuggestion,
} from "@/types";
import { userFacingError } from "@/lib/errors";
import DailyDatePicker from "@/components/ui/DailyDatePicker";
import FrogHelp from "@/components/ui/FrogHelp";
import WorkLogModal from "@/components/ui/WorkLogModal";
import { track } from "@/lib/analytics";
import { sortDailyActions } from "@/lib/dailyActionSort";
import { sortByPriority } from "@/lib/prioritySort";
import { REVIEW_REASON_BY_CODE, REVIEW_REASON_OPTIONS, type ReviewReasonCode } from "@/lib/reviewReasons";

const today = () => dayjs().format("YYYY-MM-DD");
const formatTime = (value: string) => value;
const minutesBetween = (start: string, end: string) => {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
};
const slotLabel = (slot: DailyScheduleSlot) =>
  `${formatTime(slot.start_time)}-${formatTime(slot.end_time)}`;
const priorityColor = (priority: number) =>
  ({ 1: "red", 2: "orange", 3: "geekblue", 4: "default" })[priority] ??
  "default";
const ACTION_VIEW_STORAGE_KEY = "lifeplan-daily-action-picker-view";

type DailyListRouteState = {
  date?: string;
  reviewActionId?: number;
  showReviewSuggestions?: boolean;
  sourceReviewDate?: string;
};

const isSlotReviewed = (slot: DailyScheduleSlot) =>
  Boolean(slot.actual_notes?.trim()) &&
  (slot.met_expectation === 0 || slot.met_expectation === 1) &&
  (slot.focused === 0 || slot.focused === 1);

const DailyReviewIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    <path d="M10.5 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.7.7L19.3 6.3A2.4 2.4 0 0 1 20 8v6" />
    <path d="M14 2v5a1 1 0 0 0 1 1h5M8 10h5M8 13h5M14 20l2 2 4-4" />
  </svg>
);
const HALF_HOUR_TIMES = Array.from({ length: 48 }, (_, index) => {
  const minutes = index * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});
const toHalfHourTime = (value: Dayjs) => {
  const roundedMinutes = value.minute() < 15 ? 0 : value.minute() < 45 ? 30 : 0;
  const hour = value.minute() >= 45 ? value.hour() + 1 : value.hour();
  return `${String(hour % 24).padStart(2, "0")}:${String(roundedMinutes).padStart(2, "0")}`;
};

const shouldShowReviewSuggestions = (routeState: DailyListRouteState | null) =>
  Boolean(
    routeState?.showReviewSuggestions &&
      routeState.sourceReviewDate &&
      routeState.date === dayjs(routeState.sourceReviewDate).add(1, "day").format("YYYY-MM-DD") &&
      routeState.date >= today(),
  );

export default function DailyList() {
  const navigate = useNavigate();
  const location = useLocation();
  const [date, setDate] = useState(
    () => (location.state as DailyListRouteState | null)?.date || today(),
  );
  const [schedule, setSchedule] = useState<DailySchedule | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [actionScheduleDates, setActionScheduleDates] = useState<string[]>([]);
  const [reviewSuggestions, setReviewSuggestions] = useState<
    DailyReviewSuggestion[]
  >([]);
  const [showReviewSuggestions, setShowReviewSuggestions] = useState(() =>
    shouldShowReviewSuggestions(location.state as DailyListRouteState | null),
  );
  const [selectedSlot, setSelectedSlot] = useState<DailyScheduleSlot | null>(
    null,
  );
  const [timeSlot, setTimeSlot] = useState<DailyScheduleSlot | null>(null);
  const [pickerSlot, setPickerSlot] = useState<DailyScheduleSlot | null>(null);
  const [insertPreset, setInsertPreset] = useState<{
    startTime?: string;
    endTime?: string;
  } | null>(null);
  const [workLogOpen, setWorkLogOpen] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const latestLoadRef = useRef(0);

  const load = async () => {
    const loadId = ++latestLoadRef.current;
    const requestedDate = date;
    setLoading(true);
    try {
      const [nextSchedule, allActions, nextActionScheduleDates, suggestions] =
        await Promise.all([
          dailyScheduleApi.get(requestedDate),
          actionsApi.list(),
          dailyScheduleApi.actionDates(),
          showReviewSuggestions
            ? dailyReviewApi.suggestions(requestedDate)
            : Promise.resolve([] as DailyReviewSuggestion[]),
        ]);
      if (loadId !== latestLoadRef.current) return;
      setSchedule(nextSchedule);
      setActions(allActions);
      setActionScheduleDates(nextActionScheduleDates);
      setReviewSuggestions(suggestions);
      setError("");
    } catch (cause) {
      if (loadId !== latestLoadRef.current) return;
      setError(userFacingError(cause));
    } finally {
      if (loadId === latestLoadRef.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [date, showReviewSuggestions]);
  useEffect(() => {
    if (!showReviewSuggestions || reviewSuggestions.length > 0) return;
    // 复盘保存与页面跳转可能接近同时完成，空结果时补查一次以避免错过刚落库的数据。
    const retryTimer = window.setTimeout(() => void load(), 800);
    return () => window.clearTimeout(retryTimer);
  }, [date, reviewSuggestions.length, showReviewSuggestions]);
  useEffect(() => {
    if (!showReviewSuggestions) return;
    const refreshOnReturn = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [date, showReviewSuggestions]);
  useEffect(() => {
    const routeState = location.state as DailyListRouteState | null;
    if (routeState?.date) {
      const canShowSuggestions = shouldShowReviewSuggestions(routeState);
      setShowReviewSuggestions(canShowSuggestions);
      if (routeState.date !== date) setDate(routeState.date);
      navigate(location.pathname, { replace: true, state: null });
      return;
    }
    const reviewActionId = routeState?.reviewActionId;
    if (!reviewActionId || loading || !schedule || date !== today()) return;
    const reviewSlot = schedule.slots.find(
      (slot) =>
        slot.action_id === reviewActionId || slot.action?.id === reviewActionId,
    );
    if (reviewSlot) setSelectedSlot(reviewSlot);
    navigate(location.pathname, { replace: true, state: null });
  }, [date, loading, location.pathname, location.state, navigate, schedule]);
  const slots = schedule?.slots ?? [];
  const pendingActions = useMemo(
    () => actions.filter((action) => action.status === 0),
    [actions],
  );
  const isToday = date === today();
  const changeDate = (nextDate: string) => {
    setShowReviewSuggestions(false);
    setDate(nextDate);
  };

  const saveTemplate = async () => {
    const template: DailyTemplateSlot[] = slots.map((slot, index) => ({
      start_time: slot.start_time,
      end_time: slot.end_time,
      sort_order: index,
    }));
    const confirmed = await new Promise<boolean>((resolve) => {
      AntModal.confirm({
        title: template.length === 0 ? "保存空模板？" : "保存模板？",
        content:
          template.length === 0
            ? "以后首次打开的新日期将不会自动生成时间段；已存在日期和当前日期不受影响。"
            : "只影响尚未创建日程的未来日期，不会修改任何已存在日期、行动或复盘记录。",
        okText: "确认保存",
        cancelText: "取消",
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!confirmed) return;
    try {
      await dailyScheduleApi.saveTemplate(template);
      message.success(template.length === 0 ? "已保存空模板" : "已保存模板");
    } catch (cause) {
      setError(userFacingError(cause));
    }
  };
  const prepareInsertedSlot = (index: number) => {
    const before = slots[index];
    if (!before) return;
    const startMinutes = minutesBetween("00:00", before.end_time);
    if (startMinutes + 60 >= 24 * 60) {
      message.warning("新增时间段的结束时间不能超过次日 00:00");
      return;
    }
    const endTime = dayjs(`2000-01-01T${before.end_time}`)
      .add(1, "hour")
      .format("HH:mm");
    setInsertPreset({ startTime: before.end_time, endTime });
  };

  const openDailyReview = () => {
    if (slots.every((slot) => slot.action_id == null)) {
      message.warning('请先安排行动后再进行今日复盘');
      return;
    }
    const unreviewedSlots = slots.filter(
      (slot) => slot.action_id != null && !isSlotReviewed(slot),
    );
    if (unreviewedSlots.length > 0) {
      message.warning(
        `还有 ${unreviewedSlots.length} 个已安排行动的时间段未完成复盘，补齐后再进入今日复盘。`,
      );
      return;
    }
    navigate("/daily-review", { state: { reviewDate: date } });
  };
  const promptDailyReviewAfterLastSlot = (savedSlot: DailyScheduleSlot) => {
    const plannedSlots = slots.filter((slot) => slot.action_id != null);
    const isLastSlotReviewed =
      plannedSlots.length > 0 &&
      plannedSlots.every((slot) =>
        slot.id === savedSlot.id ? isSlotReviewed(savedSlot) : isSlotReviewed(slot),
      );
    if (!isToday || !isLastSlotReviewed) return;
    AntModal.confirm({
      title: "今天的行动已完成",
      content: "要不要进行今日复盘，回顾今天并为明天做准备？",
      okText: "去复盘",
      cancelText: "稍后再说",
      onOk: openDailyReview,
    });
  };

  return (
    <div className="page daily-list-page">
      <header className="page-header daily-list-header">
        <div>
          <Typography.Title level={2} className="page-title">
            今日事
          </Typography.Title>
          <Typography.Paragraph className="page-subtitle">
            按时间安排行动，并在右侧独立记录该计划执行情况的复盘。
          </Typography.Paragraph>
        </div>
        <DailyDatePicker
          date={date}
          onChange={changeDate}
          actionScheduleDates={actionScheduleDates}
        />
      </header>
      {error && (
        <Alert
          className="page-alert"
          type="error"
          showIcon
          message={error}
          closable
          onClose={() => setError("")}
        />
      )}
      {showReviewSuggestions && reviewSuggestions.length > 0 && (
        <Alert
          className="page-alert review-suggestion-alert"
          type="info"
          showIcon
          message={
            <span className="review-suggestion-title">
              根据过去 7 天的时间段复盘整理，仅供安排次日计划时参考。
              <Tooltip title="近7天内同一问题达到3次会触发系统提示">
                <button
                  type="button"
                  className="review-suggestion-help"
                  aria-label="查看明日计划建议的出现规则"
                >
                  <CircleHelp size={14} />
                </button>
              </Tooltip>
            </span>
          }
          description={
            <ul className="review-suggestion-list">
                {reviewSuggestions.map((item) => (
                  <li key={item.reason}>
                    <strong>{REVIEW_REASON_BY_CODE[item.reason as ReviewReasonCode]?.label ?? item.reason}</strong>
                    （累计{item.occurrence_days}次）：{item.suggestion}
                  </li>
                ))}
              </ul>
          }
        />
      )}
      {loading ? (
        <div className="card empty">正在加载…</div>
      ) : (
        <>
          {slots.length === 0 ? (
            <div className="card onboarding-empty">
              <Empty
                className="empty"
                description={
                  <div>
                    <Typography.Title level={4}>
                      今天还没有安排行动
                    </Typography.Title>
                    <Typography.Paragraph type="secondary">
                      先创建一个时间段，再把要做的行动放进去。
                    </Typography.Paragraph>
                    <Space>
                      <Button
                        type="primary"
                        icon={<Plus size={15} />}
                        onClick={() => setInsertPreset({})}
                      >
                        新增时间段
                      </Button>
                      <Button onClick={() => navigate("/inbox")}>
                        去事件篮记录
                      </Button>
                      <Button onClick={() => void saveTemplate()}>
                        保存空模板
                      </Button>
                    </Space>
                  </div>
                }
              />
            </div>
          ) : (
            <ScheduleTable
              slots={slots}
              onPlan={setPickerSlot}
              onReview={(slot) => {
                if (!slot.action) {
                  message.warning({
                    content: "请先安排行动",
                    className: "daily-review-toast",
                  });
                  return;
                }
                setSelectedSlot(slot);
              }}
              onEditTime={setTimeSlot}
              onInsert={prepareInsertedSlot}
            />
          )}
          <div className="daily-template-action">
            <div className="daily-template-action-left">
              <Tooltip title="只影响尚未创建日程的未来日期，不修改已有日期">
                <Button
                  type="text"
                  icon={<CalendarDays size={15} />}
                  onClick={() => void saveTemplate()}
                >
                  保存模板
                </Button>
              </Tooltip>
            </div>
            <div className="daily-record-actions">
              <Button
                type="text"
                className="daily-review-trigger"
                icon={<DailyReviewIcon width={15} height={15} />}
                onClick={openDailyReview}
              >
                今日复盘
              </Button>
              <Button
                type="text"
                className="work-log-trigger"
                icon={<FileText size={15} />}
                disabled={slots.length === 0}
                onClick={() => setWorkLogOpen(true)}
              >
                工作日志
              </Button>
            </div>
          </div>
        </>
      )}
      <ActionPickerModal
        slot={pickerSlot}
        slots={slots}
        actions={pendingActions}
        onGuideToInbox={() =>
          navigate("/inbox", { state: { guideNewEvent: true } })
        }
        onClose={() => setPickerSlot(null)}
        onStartPomodoro={(action) => {
          const minutes = Math.max(
            30,
            Math.ceil(((action.estimated_hours || 0.5) * 60) / 30) * 30,
          );
          sessionStorage.setItem(
            "lifeplan-pomodoro-prefill",
            JSON.stringify({
              actionId: action.id,
              plannedSeconds: minutes * 60,
            }),
          );
          setPickerSlot(null);
          navigate("/pomodoro");
        }}
        onActionUpdated={(updatedAction) => {
          setActions((current) =>
            current.map((action) =>
              action.id === updatedAction.id ? updatedAction : action,
            ),
          );
          setSchedule((current) =>
            current
              ? {
                  ...current,
                  slots: current.slots.map((item) =>
                    item.action_id === updatedAction.id
                      ? { ...item, action: updatedAction }
                      : item,
                  ),
                }
              : current,
          );
        }}
        onAssigned={(assignedSlots) => {
          setSchedule((current) =>
            current
              ? {
                  ...current,
                  slots: current.slots.map(
                    (item) =>
                      assignedSlots.find(
                        (assigned) => assigned.id === item.id,
                      ) ?? item,
                  ),
                }
              : current,
          );
          setActionScheduleDates((current) =>
            current.includes(date) ? current : [...current, date],
          );
          setPickerSlot(null);
        }}
      />
      <DailySlotModal
        slot={selectedSlot}
        onClose={() => setSelectedSlot(null)}
        onReviewSaved={promptDailyReviewAfterLastSlot}
        onSaved={(slot) => {
          // 同一行动可被安排到多个时间段；完成或恢复后同步所有引用该行动的时间段。
          const action = slot.action;
          if (action) {
            setActions((current) =>
              current.map((item) => (item.id === action.id ? action : item)),
            );
          }
          setSchedule((current) =>
            current
              ? {
                  ...current,
                  slots: current.slots.map((item) => {
                    if (item.id === slot.id) return slot;
                    if (action && item.action_id === action.id)
                      return { ...item, action };
                    return item;
                  }),
                }
              : current,
          );
          setSelectedSlot(slot);
        }}
      />
      <TimeSlotModal
        slot={timeSlot}
        onClose={() => setTimeSlot(null)}
        onSaved={async () => {
          setTimeSlot(null);
          await load();
        }}
        onDeleted={async () => {
          setTimeSlot(null);
          await load();
          message.success("时间段已删除");
        }}
      />
      <InsertSlotModal
        date={date}
        preset={insertPreset}
        onClose={() => setInsertPreset(null)}
        onSaved={async () => {
          setInsertPreset(null);
          await load();
          message.success("已新增时间段");
        }}
      />
      {workLogOpen && (
        <WorkLogModal
          date={date}
          slots={slots}
          onClose={() => setWorkLogOpen(false)}
        />
      )}
    </div>
  );
}

function ScheduleTable({
  slots,
  onPlan,
  onReview,
  onEditTime,
  onInsert,
}: {
  slots: DailyScheduleSlot[];
  onPlan: (slot: DailyScheduleSlot) => void;
  onReview: (slot: DailyScheduleSlot) => void;
  onEditTime: (slot: DailyScheduleSlot) => void;
  onInsert: (index: number) => void;
}) {
  return (
    <div className="daily-schedule-card card">
      <div className="daily-schedule-head">
        <div>时间段</div>
        <div>安排行动</div>
        <div>复盘</div>
      </div>
      <div className="daily-schedule-body">
        {slots.map((slot, index) => (
          <div className="daily-schedule-row-wrap" key={slot.id}>
            <div className="daily-schedule-row">
              <div
                className="daily-time-cell"
                role="button"
                tabIndex={0}
                onClick={() => onEditTime(slot)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ")
                    onEditTime(slot);
                }}
              >
                {slotLabel(slot)}
                {index < slots.length - 1 && (
                  <button
                    className="daily-insert-button"
                    type="button"
                    aria-label="插入时间段"
                    title="插入时间段"
                    onClick={(event) => {
                      event.stopPropagation();
                      onInsert(index);
                    }}
                  >
                    <span className="daily-insert-plus">
                      <Plus size={14} />
                    </span>
                  </button>
                )}
              </div>
              <PlanCell slot={slot} onClick={() => onPlan(slot)} />
              <ReviewCell slot={slot} onClick={() => onReview(slot)} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanCell({
  slot,
  onClick,
}: {
  slot: DailyScheduleSlot;
  onClick: () => void;
}) {
  const action = slot.action;
  const statusClass = !action
    ? "empty"
    : action.status === 1
      ? "completed"
      : action.status === 2
        ? "abandoned"
        : "pending";
  return (
    <button
      type="button"
      className={`daily-plan-cell daily-cell-button ${statusClass}`}
      onClick={onClick}
    >
      {action ? (
        <>
          <span className="daily-inline-tags">
            <Tag color={priorityColor(action.priority)}>P{action.priority}</Tag>
            {action.is_frog === 1 && <Tag color="green">青蛙</Tag>}
          </span>
          <span
            className={`daily-inline-title ${action.status === 1 ? "completed-title" : ""}`}
          >
            {action.title}
          </span>
        </>
      ) : (
        <span className="daily-empty-action">+ 点击安排行动</span>
      )}
    </button>
  );
}

function ReviewCell({
  slot,
  onClick,
}: {
  slot: DailyScheduleSlot;
  onClick: () => void;
}) {
  const reviewed =
    slot.met_expectation !== undefined &&
    slot.focused !== undefined &&
    Boolean(slot.actual_notes);
  return (
    <button
      type="button"
      className={`daily-review-cell daily-cell-button ${reviewed ? "reviewed" : "empty"}`}
      onClick={onClick}
    >
      {reviewed ? (
        <>
          <span className="daily-inline-tags">
            <Tag color={slot.met_expectation === 1 ? "green" : "red"}>
              {slot.met_expectation === 1 ? "达到预期" : "未达预期"}
            </Tag>
            <Tag color={slot.focused === 1 ? "blue" : "red"}>
              {slot.focused === 1 ? "专注" : "没有专注"}
            </Tag>
          </span>
          <span className="daily-review-summary">{slot.actual_notes}</span>
        </>
      ) : (
        <span className="daily-review-placeholder">添加复盘</span>
      )}
    </button>
  );
}

function HalfHourTimePicker({
  value,
  onChange,
  className,
}: {
  value?: Dayjs;
  onChange?: (value: Dayjs | null) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const currentTime = value?.format("HH:mm");
  useEffect(() => {
    if (!open || !currentTime) return;
    const frame = requestAnimationFrame(() => {
      const selectedOption = listRef.current?.querySelector<HTMLButtonElement>(
        `[data-time="${currentTime}"]`,
      );
      selectedOption?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, currentTime]);
  const selectTime = (time: string) => {
    onChange?.(dayjs(`2000-01-01T${time}`));
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const selectNow = () => selectTime(toHalfHourTime(dayjs()));
  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      trigger={["click"]}
      placement="bottomLeft"
      popupRender={() => (
        <div className="daily-time-picker-panel">
          <div
            ref={listRef}
            className="daily-time-picker-list"
            role="listbox"
            aria-label="时间选项"
          >
            {HALF_HOUR_TIMES.map((time) => (
              <button
                key={time}
                data-time={time}
                type="button"
                role="option"
                aria-selected={time === currentTime}
                className={`daily-time-picker-option ${time === currentTime ? "selected" : ""}`}
                onClick={() => selectTime(time)}
              >
                {time}
              </button>
            ))}
          </div>
          <div className="daily-time-picker-footer">
            <Button type="link" size="small" onClick={selectNow}>
              此刻
            </Button>
          </div>
        </div>
      )}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`daily-time-picker-trigger ${className ?? ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {currentTime ?? "请选择时间"}
      </button>
    </Dropdown>
  );
}

function InsertSlotModal({
  date,
  preset,
  onClose,
  onSaved,
}: {
  date: string;
  preset: { startTime?: string; endTime?: string } | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!preset) return;
    form.resetFields();
    if (preset.startTime && preset.endTime)
      form.setFieldsValue({
        start_time: dayjs(`2000-01-01T${preset.startTime}`),
        end_time: dayjs(`2000-01-01T${preset.endTime}`),
      });
  }, [preset, form]);
  if (!preset) return null;
  const submit = async (values: Record<string, unknown>) => {
    const startTime = (values.start_time as Dayjs).format("HH:mm");
    const endTime = (values.end_time as Dayjs).format("HH:mm");
    if (minutesBetween(startTime, endTime) <= 0) {
      message.error("结束时间必须晚于开始时间，且不能超过次日 00:00");
      return;
    }
    setSaving(true);
    try {
      await dailyScheduleApi.createSlot({
        list_date: date,
        start_time: startTime,
        end_time: endTime,
      });
      await onSaved();
    } catch (cause) {
      message.error(userFacingError(cause));
    } finally {
      setSaving(false);
    }
  };
  return (
    <AntModal
      open
      title="新增时间段"
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      <Form
        form={form}
        className="form"
        layout="vertical"
        onFinish={(values) => void submit(values)}
      >
        <div className="form-grid">
          <Form.Item
            name="start_time"
            label="开始时间"
            rules={[{ required: true }]}
          >
            <HalfHourTimePicker className="full-width" />
          </Form.Item>
          <Form.Item
            name="end_time"
            label="结束时间"
            rules={[{ required: true }]}
          >
            <HalfHourTimePicker className="full-width" />
          </Form.Item>
        </div>
        <div className="form-footer">
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" htmlType="submit" loading={saving}>
            保存时间段
          </Button>
        </div>
      </Form>
    </AntModal>
  );
}

function TimeSlotModal({
  slot,
  onClose,
  onSaved,
  onDeleted,
}: {
  slot: DailyScheduleSlot | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (slot)
      form.setFieldsValue({
        start_time: dayjs(`2000-01-01T${slot.start_time}`),
        end_time: dayjs(`2000-01-01T${slot.end_time}`),
      });
  }, [slot, form]);
  if (!slot) return null;

  const submit = async (values: Record<string, unknown>) => {
    setSaving(true);
    try {
      await dailyScheduleApi.updateSlot({
        id: slot.id,
        start_time: (values.start_time as Dayjs).format("HH:mm"),
        end_time: (values.end_time as Dayjs).format("HH:mm"),
      });
      await onSaved();
      message.success("时间段已更新");
    } catch (cause) {
      message.error(userFacingError(cause));
    } finally {
      setSaving(false);
    }
  };

  const split = async () => {
    setSaving(true);
    try {
      await dailyScheduleApi.splitSlot(slot.list_date, slot.id);
      await onSaved();
      message.success({
        content: "完成拆分",
        className: "daily-split-message",
      });
    } catch (cause) {
      message.error(userFacingError(cause));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await dailyScheduleApi.deleteSlot(slot.list_date, slot.id);
      await onDeleted();
    } catch (cause) {
      message.error(userFacingError(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AntModal
      open
      title={`编辑时间段 · ${slotLabel(slot)}`}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      <Form
        form={form}
        className="form"
        layout="vertical"
        onFinish={(values) => void submit(values)}
      >
        <div className="form-grid">
          <Form.Item
            name="start_time"
            label="开始时间"
            rules={[{ required: true, message: "请选择开始时间" }]}
          >
            <HalfHourTimePicker className="full-width" />
          </Form.Item>
          <Form.Item
            name="end_time"
            label="结束时间"
            dependencies={["start_time"]}
            rules={[
              { required: true, message: "请选择结束时间" },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  const start = getFieldValue("start_time") as
                    Dayjs | undefined;
                  if (!value || !start || value.isAfter(start))
                    return Promise.resolve();
                  return Promise.reject(new Error("结束时间必须晚于开始时间"));
                },
              }),
            ]}
          >
            <HalfHourTimePicker className="full-width" />
          </Form.Item>
        </div>
        <div className="form-footer">
          {slot.action_id ? (
            <Button danger disabled title="请先移除已安排的行动">
              删除
            </Button>
          ) : (
            <Popconfirm
              title="确定删除这个时间段吗？"
              onConfirm={() => void remove()}
              okText="删除"
              cancelText="取消"
            >
              <Button danger loading={saving}>
                删除
              </Button>
            </Popconfirm>
          )}
          {minutesBetween(slot.start_time, slot.end_time) > 30 && (
            <Button onClick={() => void split()} loading={saving}>
              拆分
            </Button>
          )}
          <Button type="primary" htmlType="submit" loading={saving}>
            保存
          </Button>
        </div>
      </Form>
    </AntModal>
  );
}

function ActionPickerModal({
  slot,
  slots,
  actions,
  onGuideToInbox,
  onClose,
  onStartPomodoro,
  onActionUpdated,
  onAssigned,
}: {
  slot: DailyScheduleSlot | null;
  slots: DailyScheduleSlot[];
  actions: Action[];
  onGuideToInbox: () => void;
  onClose: () => void;
  onStartPomodoro: (action: Action) => void;
  onActionUpdated: (action: Action) => void;
  onAssigned: (slots: DailyScheduleSlot[]) => void;
}) {
  const [mode, setMode] = useState<
    "existing" | "new" | "recurring" | "new-recurring" | "edit-recurring"
  >("existing");
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [query, setQuery] = useState("");
  const [actionView, setActionView] = useState<"flat" | "event">(() => {
    const saved = localStorage.getItem(ACTION_VIEW_STORAGE_KEY);
    return saved === "event" ? "event" : "flat";
  });
  const [recurringActions, setRecurringActions] = useState<RecurringAction[]>(
    [],
  );
  const [recurringQuery, setRecurringQuery] = useState("");
  const [editingRecurringAction, setEditingRecurringAction] =
    useState<RecurringAction | null>(null);
  const [frogSaving, setFrogSaving] = useState(false);
  const [frogChecked, setFrogChecked] = useState(false);

  useEffect(() => {
    if (!slot) return;
    setMode("existing");
    setQuery("");
    setActionView((current) => {
      const saved = localStorage.getItem(ACTION_VIEW_STORAGE_KEY);
      return saved === "event" ? "event" : current;
    });
    setRecurringQuery("");
    setEditingRecurringAction(null);
    setFrogChecked(slot.action?.is_frog === 1);
    setFrogSaving(false);
    setViewing(Boolean(slot.action));
    void recurringActionsApi
      .list()
      .then(setRecurringActions)
      .catch((cause) => message.error(userFacingError(cause)));
  }, [slot]);
  const selectableActions = actions.filter(
    (action) =>
      action.status === 0 &&
      action.event_id != null &&
      action.event_status !== 3,
  );
  const visibleActions = selectableActions.filter(
    (action) =>
      action.title.toLowerCase().includes(query.trim().toLowerCase()) ||
      action.description?.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const flatVisibleActions = useMemo(
    () => sortDailyActions(visibleActions),
    [visibleActions],
  );
  const visibleRecurringActions = recurringActions.filter((action) =>
    action.title.toLowerCase().includes(recurringQuery.trim().toLowerCase()),
  );

  if (!slot) return null;

  const updateFrogStatus = async (checked: boolean) => {
    if (!slot.action) return;
    const previous = frogChecked;
    setFrogChecked(checked);
    setFrogSaving(true);
    try {
      const action = slot.action;
      const updated = await actionsApi.update({
        id: action.id,
        title: action.title,
        description: action.description,
        estimated_hours: action.estimated_hours,
        start_date: action.start_date,
        deadline: action.deadline,
        is_frog: checked ? 1 : 0,
        importance: action.importance,
        urgency: action.urgency,
      });
      onActionUpdated(updated);
      message.success(checked ? "已标记为青蛙行动" : "已恢复为普通行动");
    } catch (cause) {
      setFrogChecked(previous);
      message.error(userFacingError(cause));
    } finally {
      setFrogSaving(false);
    }
  };

  const performAssign = async (
    targets: DailyScheduleSlot[],
    actionId: number,
  ) => {
    setSaving(true);
    try {
      const assigned = [];
      for (const target of targets)
        assigned.push(await dailyScheduleApi.assignAction(target.id, actionId));
      track("安排到今日", { count: targets.length });
      onAssigned(assigned);
      message.success("行动已安排");
    } catch (cause) {
      message.error(userFacingError(cause));
    } finally {
      setSaving(false);
    }
  };

  const assignAction = async (action: Action) => {
    const currentIndex = slots.findIndex((item) => item.id === slot.id);
    const previousAssigned = slots
      .slice(0, currentIndex)
      .some((item) => item.action_id === action.id);
    const currentMinutes = minutesBetween(slot.start_time, slot.end_time);
    const requiredMinutes = Math.max(
      0,
      Math.round(action.estimated_hours * 60),
    );
    const targets = [slot];
    if (!previousAssigned && requiredMinutes > currentMinutes) {
      let availableMinutes = currentMinutes;
      for (const next of slots.slice(currentIndex + 1)) {
        if (next.action_id) break;
        targets.push(next);
        availableMinutes += minutesBetween(next.start_time, next.end_time);
        if (availableMinutes >= requiredMinutes) break;
      }
      if (availableMinutes < requiredMinutes) {
        AntModal.confirm({
          title: "提示",
          content: "该行动耗时预计大于当前这段可安排时间",
          okText: "我已了解",
          cancelText: "取消",
          onOk: async () => {
            await performAssign([slot], action.id);
          },
        });
        return;
      }
    }
    await performAssign(targets, action.id);
  };

  const assign = async (actionId: number) => {
    const action = selectableActions.find((item) => item.id === actionId);
    if (action) await assignAction(action);
  };

  const assignRecurring = async (recurringActionId: number) => {
    try {
      const action = await recurringActionsApi.instantiate(recurringActionId);
      await assignAction(action);
    } catch (cause) {
      message.error(userFacingError(cause));
    }
  };

  const moveRecurring = async (recurringActionId: number, offset: -1 | 1) => {
    const index = recurringActions.findIndex(
      (action) => action.id === recurringActionId,
    );
    const targetIndex = index + offset;
    if (
      index < 0 ||
      targetIndex < 0 ||
      targetIndex >= recurringActions.length ||
      saving
    )
      return;
    const reordered = [...recurringActions];
    [reordered[index], reordered[targetIndex]] = [
      reordered[targetIndex],
      reordered[index],
    ];
    setSaving(true);
    try {
      setRecurringActions(
        await recurringActionsApi.reorder({
          action_ids: reordered.map((action) => action.id),
        }),
      );
    } catch (cause) {
      message.error(userFacingError(cause));
    } finally {
      setSaving(false);
    }
  };

  const createRecurring = async (
    payload: NewRecurringAction | UpdateRecurringAction,
  ) => {
    setSaving(true);
    try {
      const newPayload: NewRecurringAction = {
        title: payload.title,
        estimated_hours: payload.estimated_hours,
        is_frog: payload.is_frog,
        importance: payload.importance,
        urgency: payload.urgency,
        frequency_unit: payload.frequency_unit,
        frequency_count: payload.frequency_count,
      };
      const created = await recurringActionsApi.create(newPayload);
      setRecurringActions((current) => [...current, created]);
      setMode("recurring");
      setRecurringQuery("");
      message.success("重复行动已新增");
    } catch (cause) {
      message.error(userFacingError(cause));
    } finally {
      setSaving(false);
    }
  };

  const deleteRecurring = async () => {
    if (!editingRecurringAction) return;
    setSaving(true);
    try {
      await recurringActionsApi.delete(editingRecurringAction.id);
      setRecurringActions((current) =>
        current.filter((item) => item.id !== editingRecurringAction.id),
      );
      setEditingRecurringAction(null);
      setMode("recurring");
      message.success("重复行动已删除");
    } catch (cause) {
      message.error(userFacingError(cause));
    } finally {
      setSaving(false);
    }
  };

  const updateRecurring = async (
    payload: NewRecurringAction | UpdateRecurringAction,
  ) => {
    setSaving(true);
    try {
      if (!("id" in payload))
        throw new Error("重复行动信息已失效，请重新打开编辑");
      const updated = await recurringActionsApi.update(payload);
      setRecurringActions((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setEditingRecurringAction(null);
      setMode("recurring");
      message.success("重复行动已更新");
    } catch (cause) {
      message.error(userFacingError(cause));
    } finally {
      setSaving(false);
    }
  };

  if (viewing && slot.action)
    return (
      <AntModal
        open
        title={`行动详情 · ${slotLabel(slot)}`}
        onCancel={onClose}
        footer={null}
        destroyOnHidden
      >
        <ActionPreview action={slot.action} />
        <div className="form-footer daily-action-detail-footer">
          <Checkbox
            checked={frogChecked}
            disabled={frogSaving}
            onChange={(event) => void updateFrogStatus(event.target.checked)}
          >
            标记为青蛙 <FrogHelp />
          </Checkbox>
          <Space>
            <Button onClick={() => setViewing(false)}>更换行动</Button>
            <Button
              type="primary"
              onClick={() => slot.action && onStartPomodoro(slot.action)}
            >
              开始番茄钟
            </Button>
          </Space>
        </div>
      </AntModal>
    );
  return (
    <AntModal
      open
      title={`安排行动 · ${slotLabel(slot)}`}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      {(mode === "existing" || mode === "recurring" || mode === "new") && (
        <Radio.Group
          className="daily-picker-radio"
          value={mode}
          onChange={(event) =>
            setMode(event.target.value as "existing" | "recurring" | "new")
          }
          optionType="button"
          buttonStyle="solid"
        >
          <Radio.Button value="existing">事件行动</Radio.Button>
          <Radio.Button value="recurring">重复行动</Radio.Button>
          <Radio.Button value="new">临时行动</Radio.Button>
        </Radio.Group>
      )}
      {mode === "existing" &&
        (selectableActions.length === 0 ? (
          <div className="daily-action-empty-guide">
            <div className="daily-action-empty-guide-icon">
              <ListChecks size={30} strokeWidth={1.8} />
            </div>
            <Typography.Title level={4}>
              还没有可以直接安排的行动
            </Typography.Title>
            <Typography.Paragraph>
              先创建要做的事，再把事情拆解成一步步能马上开始的行动，然后依次安排到每天，会更容易将事情推进完成。
            </Typography.Paragraph>
            <div className="daily-action-empty-guide-example">
              <span>例如</span>
              <span>准备汇报</span>
              <ArrowRight size={14} />
              <span>整理数据 → 写提纲 → 完成初稿</span>
            </div>
            <Button
              type="primary"
              icon={<ArrowRight size={15} />}
              iconPosition="end"
              onClick={onGuideToInbox}
            >
              去事件篮拆分活动
            </Button>
          </div>
        ) : (
          <>
            <div className="daily-picker-search-row">
              <Input
                allowClear
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索行动标题关键词"
              />
              <Button
                type={actionView === "flat" ? "primary" : "default"}
                ghost={actionView === "flat"}
                size="middle"
                icon={<Rows3 size={15} />}
                aria-label="平铺视图"
                title="平铺视图"
                onClick={() => {
                  setActionView("flat");
                  localStorage.setItem(ACTION_VIEW_STORAGE_KEY, "flat");
                }}
              />
              <Button
                type={actionView === "event" ? "primary" : "default"}
                ghost={actionView === "event"}
                size="middle"
                icon={<ListTree size={15} />}
                aria-label="按事件视图"
                title="按事件视图"
                onClick={() => {
                  setActionView("event");
                  localStorage.setItem(ACTION_VIEW_STORAGE_KEY, "event");
                }}
              />
            </div>
            <div
              className={`daily-action-picker-list ${actionView === "event" ? "daily-action-picker-event-list" : ""}`}
            >
              {visibleActions.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="没有符合条件的行动"
                />
              ) : actionView === "flat" ? (
                flatVisibleActions.map((action, index) => (
                  <button
                    className={`daily-action-picker-item ${action.id === slot.action_id ? "selected" : ""}`}
                    type="button"
                    key={action.id}
                    onClick={() => void assign(action.id)}
                    disabled={saving}
                  >
                    <ActionPreview
                      action={action}
                      index={index + 1}
                      scheduledToday={slots.some(
                        (item) => item.action_id === action.id,
                      )}
                    />
                  </button>
                ))
              ) : (
                <EventActionPicker
                  actions={visibleActions}
                  slots={slots}
                  saving={saving}
                  onAssign={(id) => void assign(id)}
                />
              )}
            </div>
          </>
        ))}
      {mode === "recurring" && (
        <>
          <div className="daily-picker-search-row">
            <Input
              allowClear
              value={recurringQuery}
              onChange={(event) => setRecurringQuery(event.target.value)}
              placeholder="搜索重复行动标题"
            />
            <Button
              icon={<Plus size={15} />}
              onClick={() => setMode("new-recurring")}
            >
              新增重复行动
            </Button>
          </div>
          <div className="daily-action-picker-list">
            {visibleRecurringActions.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  recurringActions.length === 0
                    ? "还没有重复行动"
                    : "没有符合条件的重复行动"
                }
              />
            ) : (
              visibleRecurringActions.map((action, index) => {
                const actualIndex = recurringActions.findIndex(
                  (item) => item.id === action.id,
                );
                return (
                  <div className="daily-recurring-picker-item" key={action.id}>
                    <button
                      className="daily-action-picker-item"
                      type="button"
                      onClick={() => void assignRecurring(action.id)}
                      disabled={saving}
                    >
                      <RecurringActionPreview
                        action={action}
                        index={index + 1}
                      />
                    </button>
                    <div className="daily-recurring-order-actions">
                      <Button
                        type="text"
                        size="small"
                        aria-label="编辑重复行动"
                        title="编辑"
                        icon={<Pencil size={15} />}
                        disabled={saving}
                        onClick={(event) => {
                          event.stopPropagation();
                          setEditingRecurringAction(action);
                          setMode("edit-recurring");
                        }}
                      />
                      <Button
                        type="text"
                        size="small"
                        aria-label="上移重复行动"
                        title="上移"
                        icon={<ChevronUp size={15} />}
                        disabled={actualIndex === 0 || saving}
                        onClick={(event) => {
                          event.stopPropagation();
                          void moveRecurring(action.id, -1);
                        }}
                      />
                      <Button
                        type="text"
                        size="small"
                        aria-label="下移重复行动"
                        title="下移"
                        icon={<ChevronDown size={15} />}
                        disabled={
                          actualIndex === recurringActions.length - 1 || saving
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          void moveRecurring(action.id, 1);
                        }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
      {mode === "new" && (
        <NewActionForm
          onSubmit={async (payload) => {
            try {
              const action = await actionsApi.create(payload);
              await assignAction(action);
            } catch (cause) {
              message.error(userFacingError(cause));
            }
          }}
        />
      )}
      {(mode === "new-recurring" || mode === "edit-recurring") && (
        <NewRecurringActionForm
          action={editingRecurringAction}
          onSubmit={
            mode === "edit-recurring" ? updateRecurring : createRecurring
          }
        />
      )}
      <div className="form-footer">
        {mode !== "new-recurring" && mode !== "edit-recurring" && (
          <Button onClick={onClose}>取消</Button>
        )}
        {mode === "new" && (
          <Button
            type="primary"
            form="daily-new-action-form"
            htmlType="submit"
            loading={saving}
          >
            创建并安排
          </Button>
        )}
        {(mode === "new-recurring" || mode === "edit-recurring") && (
          <>
            {mode === "edit-recurring" && (
              <Popconfirm
                title="删除后不可恢复，确认删除吗"
                onConfirm={() => void deleteRecurring()}
                okText="删除"
                cancelText="取消"
              >
                <Button danger loading={saving}>
                  删除
                </Button>
              </Popconfirm>
            )}
            <Button
              onClick={() => {
                setEditingRecurringAction(null);
                setMode("recurring");
              }}
            >
              取消
            </Button>
            <Button
              type="primary"
              form="daily-new-recurring-action-form"
              htmlType="submit"
              loading={saving}
            >
              {mode === "edit-recurring" ? "保存修改" : "保存重复行动"}
            </Button>
          </>
        )}
      </div>
    </AntModal>
  );
}
function DailySlotModal({
  slot,
  onClose,
  onSaved,
  onReviewSaved,
}: {
  slot: DailyScheduleSlot | null;
  onClose: () => void;
  onSaved: (slot: DailyScheduleSlot) => void;
  onReviewSaved: (slot: DailyScheduleSlot) => void;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [completeAfterReview, setCompleteAfterReview] = useState(false);
  useEffect(() => {
    if (!slot) return;
    setCompleteAfterReview(false);
    const isNewReview =
      slot.actual_notes == null &&
      slot.met_expectation == null &&
      slot.focused == null;
    const defaultActualNotes = slot.action
      ? `${slot.action.event_title ? `${slot.action.event_title}-` : ""}${slot.action.title}`
      : "";
    form.setFieldsValue({
      actual_notes: isNewReview ? defaultActualNotes : slot.actual_notes,
      met_expectation: isNewReview ? 1 : slot.met_expectation,
      focused: isNewReview ? 1 : slot.focused,
      primary_review_reason: slot.primary_review_reason,
    });
  }, [slot, form]);
  if (!slot) return null;
  const saveReview = async () => {
    try {
      setSaving(true);
      const values = await form.validateFields([
        "actual_notes",
        "met_expectation",
        "focused",
        "primary_review_reason",
      ]);
      let reviewed = await dailyScheduleApi.updateReview({
        id: slot.id,
        actual_notes: String(values.actual_notes),
        met_expectation: Number(values.met_expectation) as 0 | 1,
        focused: Number(values.focused) as 0 | 1,
        primary_review_reason:
          Number(values.met_expectation) === 0 || Number(values.focused) === 0
            ? values.primary_review_reason
            : undefined,
      });
      track("完成每日复盘", {
        met_expectation: Number(values.met_expectation) === 1,
        focused: Number(values.focused) === 1,
      });
      if (completeAfterReview && slot.action_id) {
        await actionsApi.complete(slot.action_id);
        const refreshed = await dailyScheduleApi.get(slot.list_date);
        reviewed =
          refreshed.slots.find((item) => item.id === slot.id) ?? reviewed;
      }
      onSaved(reviewed);
      onClose();
      onReviewSaved(reviewed);
      message.success(
        completeAfterReview ? "复盘已保存，行动已完成" : "复盘已保存",
      );
    } catch (cause) {
      if (cause && typeof cause === "object" && "errorFields" in cause) return;
      message.error(userFacingError(cause));
    } finally {
      setSaving(false);
      setCompleteAfterReview(false);
    }
  };
  const restore = async () => {
    if (!slot.action_id) return;
    try {
      await actionsApi.restore(slot.action_id);
      const refreshed = await dailyScheduleApi.get(slot.list_date);
      onSaved(refreshed.slots.find((item) => item.id === slot.id) ?? slot);
      message.success("行动已恢复");
    } catch (cause) {
      message.error(userFacingError(cause));
    }
  };
  return (
    <AntModal
      open
      title={`时间段详情 · ${slotLabel(slot)}`}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      className="daily-slot-review-modal"
      wrapClassName="daily-slot-review-modal-wrap"
      styles={{ body: { display: "flex", minHeight: 0, overflow: "hidden" } }}
    >
      <Form form={form} className="form daily-slot-form" layout="vertical">
        <div className="daily-slot-review-scroll-area">
        {slot.action ? (
          <ActionPreview action={slot.action} />
        ) : (
          <div className="daily-action-preview-empty">
            当前时间段尚未安排行动
          </div>
        )}
        <Form.Item
          name="actual_notes"
          label="实际工作情况"
          rules={[
            { required: true, whitespace: true, message: "请填写实际工作情况" },
          ]}
        >
          <Input.TextArea autoSize={{ minRows: 3, maxRows: 5 }} />
        </Form.Item>
        <div className="form-grid">
          <Form.Item
            name="met_expectation"
            label="是否达到预期"
            rules={[{ required: true, message: "请选择是否达到预期" }]}
          >
            <Select
              options={[
                { value: 1, label: "达到预期" },
                { value: 0, label: "未达预期" },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="focused"
            label="是否专注"
            rules={[{ required: true, message: "请选择是否专注" }]}
          >
            <Select
              options={[
                { value: 1, label: "专注" },
                { value: 0, label: "没有专注" },
              ]}
            />
          </Form.Item>
        </div>
        <Form.Item
          noStyle
          shouldUpdate={(previous, current) =>
            previous.met_expectation !== current.met_expectation ||
            previous.focused !== current.focused
          }
        >
          {({ getFieldValue }) => {
            const shouldShowReasons =
              getFieldValue("met_expectation") === 0 ||
              getFieldValue("focused") === 0;
            if (!shouldShowReasons) return null;
            return (
              <Form.Item
                name="primary_review_reason"
                label="偏差主因"
                rules={[{ required: true, message: "请选择偏差主因" }]}
              >
                <Radio.Group className="daily-slot-review-reasons">
                  <Space direction="vertical" size={8}>
                    {REVIEW_REASON_OPTIONS.map((option) => (
                      <Radio key={option.value} value={option.value}>
                        {option.label}
                        <Tooltip title={option.description}>
                          <button
                            type="button"
                            className="review-reason-help"
                            aria-label={`${option.label}说明：${option.description}`}
                            onClick={(event) => event.preventDefault()}
                          >
                            <CircleHelp size={14} aria-hidden="true" />
                          </button>
                        </Tooltip>
                      </Radio>
                    ))}
                  </Space>
                </Radio.Group>
              </Form.Item>
            );
          }}
        </Form.Item>
        </div>
        <div className="daily-slot-actions">
          <Space>
            {slot.action?.status === 0 && (
              <Checkbox
                checked={completeAfterReview}
                onChange={(event) =>
                  setCompleteAfterReview(event.target.checked)
                }
              >
                已完成行动
              </Checkbox>
            )}
            {slot.action?.status === 1 && (
              <Button
                icon={<RotateCcw size={14} />}
                onClick={() => void restore()}
              >
                恢复行动
              </Button>
            )}
          </Space>
          <Space>
            <Button
              type="primary"
              onClick={() => void saveReview()}
              loading={saving}
            >
              保存复盘
            </Button>
          </Space>
        </div>
      </Form>
    </AntModal>
  );
}

function EventActionPicker({
  actions,
  slots,
  saving,
  onAssign,
}: {
  actions: Action[];
  slots: DailyScheduleSlot[];
  saving: boolean;
  onAssign: (id: number) => void;
}) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const groups = sortByPriority(
    actions
      .filter((action) => action.status !== 1)
      .reduce<
        Array<{
          key: string;
          eventTitle: string;
          actions: Action[];
          priority: number;
        }>
      >((result, action) => {
        const key =
          action.event_id != null ? `event:${action.event_id}` : "unassigned";
        const existing = result.find((item) => item.key === key);
        if (existing) {
          existing.actions.push(action);
          existing.priority = Math.min(existing.priority, action.priority);
        } else
          result.push({
            key,
            eventTitle: action.event_title || "所属事件",
            actions: [action],
            priority: action.priority,
          });
        return result;
      }, [])
      .map((group) => ({
        ...group,
        actions: [...group.actions].sort(
          (left, right) => left.sort_order - right.sort_order,
        ),
      })),
  );
  return (
    <div className="daily-event-action-groups">
      {groups.map((group) => {
        const expanded = expandedKeys.has(group.key);
        return (
          <section className="daily-event-action-group" key={group.key}>
            <button
              type="button"
              className="daily-event-action-parent"
              aria-expanded={expanded}
              onClick={() =>
                setExpandedKeys((current) => {
                  const next = new Set(current);
                  if (next.has(group.key)) next.delete(group.key);
                  else next.add(group.key);
                  return next;
                })
              }
            >
              <span className="daily-event-action-parent-label">事件：</span>
              <Typography.Text
                strong
                className="daily-event-action-parent-title"
                ellipsis={{ tooltip: group.eventTitle }}
              >
                {group.eventTitle}
              </Typography.Text>
              {group.actions[0] && (
                <span className="daily-event-action-parent-tags">
                  <Tag
                    color={
                      group.actions[0].importance === 1 ? "orange" : "default"
                    }
                  >
                    {group.actions[0].importance === 1 ? "重要" : "不重要"}
                  </Tag>
                  <Tag
                    color={group.actions[0].urgency === 1 ? "red" : "default"}
                  >
                    {group.actions[0].urgency === 1 ? "紧急" : "不紧急"}
                  </Tag>
                </span>
              )}
              <span className="daily-event-action-count">
                {group.actions.length}
              </span>
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {expanded && (
              <div className="daily-event-action-children">
                {group.actions.map((action, index) => (
                  <button
                    className={`daily-action-picker-item ${slots.some((item) => item.action_id === action.id) ? "selected" : ""}`}
                    type="button"
                    key={action.id}
                    onClick={() => onAssign(action.id)}
                    disabled={saving}
                  >
                    <ActionPreview
                      action={action}
                      index={index + 1}
                      scheduledToday={slots.some(
                        (item) => item.action_id === action.id,
                      )}
                      hideEventRelation
                      hideEventActionMeta
                    />
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
function ActionPreview({
  action,
  index,
  scheduledToday = false,
  hideEventRelation = false,
  hideEventActionMeta = false,
}: {
  action: Action;
  index?: number;
  scheduledToday?: boolean;
  hideEventRelation?: boolean;
  hideEventActionMeta?: boolean;
}) {
  const relationLabel = action.event_title
    ? `所属事件：${action.event_title}`
    : "";
  const eventLabel =
    relationLabel +
    (action.delegated_to ? ` · 委托给 ${action.delegated_to}` : "");
  const tooltipProps = {
    color: "#fff",
    classNames: { root: "daily-action-tooltip" },
    styles: {
      container: {
        color: "#303133",
        backgroundColor: "#fff",
        boxShadow: "0 4px 12px rgba(0, 0, 0, .12)",
      },
    },
  };
  return (
    <div className="daily-action-preview">
      <div
        className={`daily-action-preview-title ${action.status === 1 ? "completed-title" : ""}`}
      >
        {index !== undefined && <span className="card-index">{index}.</span>}
        <Tooltip title={action.title} {...tooltipProps}>
          <span className="daily-action-preview-title-text">
            {action.title}
          </span>
        </Tooltip>
        {scheduledToday && (
          <Tag className="daily-action-scheduled-tag">当日已安排</Tag>
        )}
      </div>
      <div className="daily-action-preview-tags">
        <Tag color={priorityColor(action.priority)}>
          优先级 P{action.priority}
        </Tag>
        <Tag
          color={
            action.estimated_hours <= 0.5
              ? "blue"
              : action.estimated_hours <= 1
                ? "cyan"
                : action.estimated_hours <= 1.5
                  ? "orange"
                  : "red"
          }
        >
          {action.estimated_hours === 0.5
            ? "30 分钟"
            : `${action.estimated_hours} 小时`}
        </Tag>
        {hideEventActionMeta ? (
          <>
            {action.start_date && (
              <Tag color="default">开始：{action.start_date}</Tag>
            )}
            {action.deadline && (
              <Tag color="default">截止：{action.deadline}</Tag>
            )}
          </>
        ) : (
          <>
            <Tag color={action.importance === 1 ? "orange" : "default"}>
              {action.importance === 1 ? "重要" : "不重要"}
            </Tag>
            <Tag color={action.urgency === 1 ? "red" : "default"}>
              {action.urgency === 1 ? "紧急" : "不紧急"}
            </Tag>
            <Tag
              color={
                action.status === 1
                  ? "green"
                  : action.status === 2
                    ? "red"
                    : "blue"
              }
            >
              {action.status === 1
                ? "已完成"
                : action.status === 2
                  ? "已放弃"
                  : "待办"}
            </Tag>
          </>
        )}
        {action.is_delegated_follow_up === 1 && (
          <Tag color="gold">委托跟进</Tag>
        )}
        {action.is_frog === 1 && <Tag color="green">青蛙</Tag>}
      </div>
      {!hideEventActionMeta && (action.start_date || action.deadline) && (
        <div className="daily-action-preview-dates">
          {action.start_date && <span>开始：{action.start_date}</span>}
          {action.deadline && <span>截止：{action.deadline}</span>}
        </div>
      )}
      {eventLabel && !hideEventRelation && (
        <div className="daily-action-preview-event">
          <Tooltip title={eventLabel} {...tooltipProps}>
            <span className="daily-action-preview-event-text">
              {eventLabel}
            </span>
          </Tooltip>
        </div>
      )}
      {action.description && (
        <Typography.Paragraph className="daily-action-preview-description">
          {action.description}
        </Typography.Paragraph>
      )}
    </div>
  );
}

function RecurringActionPreview({
  action,
  index,
}: {
  action: RecurringAction;
  index?: number;
}) {
  const frequencyLabel = `${action.frequency_unit === "daily" ? "每日" : action.frequency_unit === "weekly" ? "每周" : "每月"} ${action.frequency_count} 次`;
  return (
    <div className="daily-action-preview">
      <div className="daily-action-preview-title">
        {index !== undefined && <span className="card-index">{index}.</span>}
        <span className="daily-action-preview-title-text">{action.title}</span>
      </div>
      <div className="daily-action-preview-tags">
        <Tag color={priorityColor(action.priority)}>
          优先级 P{action.priority}
        </Tag>
        <Tag
          color={
            action.estimated_hours <= 0.5
              ? "blue"
              : action.estimated_hours <= 1
                ? "cyan"
                : action.estimated_hours <= 1.5
                  ? "orange"
                  : "red"
          }
        >
          {action.estimated_hours === 0.5
            ? "30 分钟"
            : `${action.estimated_hours} 小时`}
        </Tag>
        <Tag color={action.importance === 1 ? "orange" : "default"}>
          {action.importance === 1 ? "重要" : "不重要"}
        </Tag>
        <Tag color={action.urgency === 1 ? "red" : "default"}>
          {action.urgency === 1 ? "紧急" : "不紧急"}
        </Tag>
        <Tag color="purple">{frequencyLabel}</Tag>
        {action.is_frog === 1 && <Tag color="green">青蛙</Tag>}
      </div>
    </div>
  );
}

function NewRecurringActionForm({
  action,
  onSubmit,
}: {
  action: RecurringAction | null;
  onSubmit: (
    payload: NewRecurringAction | UpdateRecurringAction,
  ) => Promise<void>;
}) {
  const [form] = Form.useForm();
  useEffect(() => {
    form.setFieldsValue(
      action
        ? {
            title: action.title,
            estimated_hours: action.estimated_hours,
            is_frog: action.is_frog === 1,
            importance: action.importance,
            urgency: action.urgency,
            frequency_unit: action.frequency_unit,
            frequency_count: action.frequency_count,
          }
        : {
            title: undefined,
            estimated_hours: 0.5,
            is_frog: false,
            importance: 1,
            urgency: 1,
            frequency_unit: "daily",
            frequency_count: 1,
          },
    );
  }, [action, form]);
  return (
    <Form
      id="daily-new-recurring-action-form"
      form={form}
      className="form daily-new-action-form"
      layout="vertical"
      onFinish={(values) =>
        void onSubmit({
          ...(action ? { id: action.id } : {}),
          title: String(values.title),
          estimated_hours: Number(values.estimated_hours),
          is_frog: values.is_frog ? 1 : 0,
          importance: Number(values.importance),
          urgency: Number(values.urgency),
          frequency_unit: values.frequency_unit,
          frequency_count: Number(values.frequency_count),
        })
      }
    >
      <Form.Item
        name="title"
        label="行动标题"
        rules={[{ required: true, message: "请输入行动标题" }]}
      >
        <Input autoFocus />
      </Form.Item>
      <div className="form-grid action-modal-grid">
        <Form.Item
          name="estimated_hours"
          label="单次耗时"
          rules={[{ required: true, message: "请选择单次耗时" }]}
        >
          <Select
            options={[
              { value: 0.5, label: "30 分钟" },
              { value: 1, label: "1 小时" },
              { value: 1.5, label: "1.5 小时" },
              { value: 2, label: "2 小时" },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="frequency_unit"
          label="频率"
          rules={[{ required: true }]}
        >
          <Select
            options={[
              { value: "daily", label: "每日" },
              { value: "weekly", label: "每周" },
              { value: "monthly", label: "每月" },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="frequency_count"
          label="次数"
          rules={[
            { required: true, message: "请输入次数" },
            { type: "number", min: 1, max: 99, message: "次数范围为 1～99" },
          ]}
        >
          <InputNumber min={1} max={99} precision={0} className="full-width" />
        </Form.Item>
      </div>
      <div className="form-grid action-priority-grid">
        <Form.Item name="importance" label="重要程度">
          <Select
            options={[
              { value: 1, label: "重要" },
              { value: 0, label: "不重要" },
            ]}
          />
        </Form.Item>
        <Form.Item name="urgency" label="紧急程度">
          <Select
            options={[
              { value: 1, label: "紧急" },
              { value: 0, label: "不紧急" },
            ]}
          />
        </Form.Item>
      </div>
      <Form.Item name="is_frog" valuePropName="checked">
        <Checkbox>
          标记为青蛙 <FrogHelp />
        </Checkbox>
      </Form.Item>
    </Form>
  );
}

function NewActionForm({
  onSubmit,
}: {
  onSubmit: (payload: NewAction) => Promise<void>;
}) {
  const [form] = Form.useForm();
  return (
    <Form
      id="daily-new-action-form"
      form={form}
      className="form daily-new-action-form"
      layout="vertical"
      onFinish={(values) =>
        void onSubmit({
          title: String(values.title),
          estimated_hours: Number(values.estimated_hours),
          start_date: values.start_date
            ? (values.start_date as Dayjs).format("YYYY-MM-DD")
            : undefined,
          deadline: values.deadline
            ? (values.deadline as Dayjs).format("YYYY-MM-DD")
            : undefined,
          is_frog: values.is_frog ? 1 : 0,
          importance: Number(values.importance),
          urgency: Number(values.urgency),
        })
      }
    >
      <Form.Item
        name="title"
        label="行动标题"
        rules={[{ required: true, message: "请输入行动标题" }]}
      >
        <Input autoFocus />
      </Form.Item>
      <div className="form-grid action-modal-grid">
        <Form.Item
          name="estimated_hours"
          label="预计耗时"
          initialValue={0.5}
          rules={[{ required: true }]}
        >
          <Select
            options={[
              { value: 0.5, label: "30 分钟" },
              { value: 1, label: "1 小时" },
              { value: 1.5, label: "1.5 小时" },
              { value: 2, label: "2 小时" },
            ]}
          />
        </Form.Item>
        <Form.Item name="start_date" label="开始日期">
          <DatePicker className="full-width" format="YYYY-MM-DD" />
        </Form.Item>
        <Form.Item name="deadline" label="截止日期">
          <DatePicker className="full-width" format="YYYY-MM-DD" />
        </Form.Item>
      </div>
      <div className="form-grid action-priority-grid">
        <Form.Item name="importance" label="重要程度" initialValue={1}>
          <Select
            options={[
              { value: 1, label: "重要" },
              { value: 0, label: "不重要" },
            ]}
          />
        </Form.Item>
        <Form.Item name="urgency" label="紧急程度" initialValue={1}>
          <Select
            options={[
              { value: 1, label: "紧急" },
              { value: 0, label: "不紧急" },
            ]}
          />
        </Form.Item>
      </div>
      <Form.Item name="is_frog" valuePropName="checked">
        <Checkbox>
          标记为青蛙 <FrogHelp />
        </Checkbox>
      </Form.Item>
    </Form>
  );
}
