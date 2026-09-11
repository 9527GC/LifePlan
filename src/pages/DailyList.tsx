import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import dayjs, { type Dayjs } from "dayjs";
import { Alert, Button, Checkbox, DatePicker, Empty, Form, Input, InputNumber, Modal as AntModal, Popconfirm, Select, Space, Tag, TimePicker, Tooltip, Typography, Radio, message } from "antd";
import { ArrowRight, CalendarDays, ChevronDown, ChevronUp, FileText, ListChecks, Pencil, Plus, RotateCcw } from "lucide-react";
import { actionsApi, dailyScheduleApi, recurringActionsApi } from "@/lib/api";
import type { Action, DailySchedule, DailyScheduleSlot, DailyTemplateSlot, NewAction, NewRecurringAction, RecurringAction, UpdateRecurringAction } from "@/types";
import { userFacingError } from "@/lib/errors";
import FrogHelp from "@/components/ui/FrogHelp";
import WorkLogModal from "@/components/ui/WorkLogModal";
import { track } from "@/lib/analytics";

const today = () => dayjs().format("YYYY-MM-DD");
const formatTime = (value: string) => value;
const minutesBetween = (start: string, end: string) => { const [sh, sm] = start.split(":").map(Number); const [eh, em] = end.split(":").map(Number); return (eh * 60 + em) - (sh * 60 + sm); };
const slotLabel = (slot: DailyScheduleSlot) => `${formatTime(slot.start_time)}-${formatTime(slot.end_time)}`;
const weekdayNames = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
const priorityColor = (priority: number) => ({ 1: "red", 2: "orange", 3: "geekblue", 4: "default" }[priority] ?? "default");

export default function DailyList() {
  const [date, setDate] = useState(today);
  const [schedule, setSchedule] = useState<DailySchedule | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<DailyScheduleSlot | null>(null);
  const [timeSlot, setTimeSlot] = useState<DailyScheduleSlot | null>(null);
  const [pickerSlot, setPickerSlot] = useState<DailyScheduleSlot | null>(null);
  const [insertPreset, setInsertPreset] = useState<{ startTime?: string; endTime?: string } | null>(null);
  const [workLogOpen, setWorkLogOpen] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  const load = async () => { setLoading(true); try { const [nextSchedule, allActions] = await Promise.all([dailyScheduleApi.get(date), actionsApi.list()]); setSchedule(nextSchedule); setActions(allActions); setError(""); } catch (cause) { setError(userFacingError(cause)); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [date]);
  useEffect(() => {
    const reviewActionId = (location.state as { reviewActionId?: number } | null)?.reviewActionId;
    if (!reviewActionId || loading || !schedule || date !== today()) return;
    const reviewSlot = schedule.slots.find((slot) => slot.action_id === reviewActionId || slot.action?.id === reviewActionId);
    if (reviewSlot) setSelectedSlot(reviewSlot);
    navigate(location.pathname, { replace: true, state: null });
  }, [date, loading, location.pathname, location.state, navigate, schedule]);
  const slots = schedule?.slots ?? [];
  const pendingActions = useMemo(() => actions.filter((action) => action.status === 0), [actions]);
  const weekdayName = weekdayNames[dayjs(date).day()];
  const isToday = date === today();
  const refreshSlot = (slot: DailyScheduleSlot) => setSchedule((current) => current ? { ...current, slots: current.slots.map((item) => item.id === slot.id ? slot : item) } : current);

  const saveTemplate = async () => { try { const template: DailyTemplateSlot[] = slots.map((slot, index) => ({ start_time: slot.start_time, end_time: slot.end_time, sort_order: index })); await dailyScheduleApi.saveTemplate(template); message.success("已保存为最新模板"); } catch (cause) { setError(userFacingError(cause)); } };
  const prepareInsertedSlot = (index: number) => { const before = slots[index]; if (!before) return; const startMinutes = minutesBetween("00:00", before.end_time); if (startMinutes + 60 >= 24 * 60) { message.warning("新增时间段的结束时间不能超过次日 00:00"); return; } const endTime = dayjs(`2000-01-01T${before.end_time}`).add(1, "hour").format("HH:mm"); setInsertPreset({ startTime: before.end_time, endTime }); };

  return <div className="page daily-list-page">
    <header className="page-header daily-list-header"><div><Typography.Title level={2} className="page-title">今日事</Typography.Title><Typography.Paragraph className="page-subtitle">按时间安排行动，并在右侧独立记录当天复盘。</Typography.Paragraph></div><div className="daily-date-panel">{isToday && <Tag color="blue" className="daily-today-tag">今天</Tag>}<DatePicker value={dayjs(date)} format="YYYY年MM月DD日" allowClear={false} onChange={(value) => value && setDate(value.format("YYYY-MM-DD"))} /><Typography.Text className="daily-date-context"><span className="daily-weekday-name">{weekdayName}</span></Typography.Text></div></header>
    {error && <Alert className="page-alert" type="error" showIcon message={error} closable onClose={() => setError("")} />}
    {loading ? <div className="card empty">正在加载…</div> : <>{slots.length === 0 ? <div className="card onboarding-empty"><Empty className="empty" description={<div><Typography.Title level={4}>今天还没有安排行动</Typography.Title><Typography.Paragraph type="secondary">先创建一个时间段，再把要做的行动放进去。</Typography.Paragraph><Space><Button type="primary" icon={<Plus size={15} />} onClick={() => setInsertPreset({})}>新增时间段</Button><Button onClick={() => navigate("/inbox")}>去事件篮记录</Button></Space></div>} /></div> : <ScheduleTable slots={slots} onPlan={setPickerSlot} onReview={(slot) => { if (!slot.action) { message.warning({ content: "请先安排行动", className: "daily-review-toast" }); return; } setSelectedSlot(slot); }} onEditTime={setTimeSlot} onInsert={prepareInsertedSlot} />}<div className="daily-template-action"><div className="daily-template-action-left"><Button type="text" icon={<Plus size={15} />} onClick={() => setInsertPreset({})}>新增时间段</Button><Button type="text" icon={<CalendarDays size={15} />} disabled={slots.length === 0} onClick={() => void saveTemplate()}>保存为模板</Button></div><Button type="text" className="work-log-trigger" icon={<FileText size={15} />} disabled={slots.length === 0} onClick={() => setWorkLogOpen(true)}>工作日志</Button></div></>}
    <ActionPickerModal slot={pickerSlot} slots={slots} actions={pendingActions} onGuideToInbox={() => navigate("/inbox", { state: { guideNewEvent: true } })} onClose={() => setPickerSlot(null)} onStartPomodoro={(action) => { const minutes = Math.max(30, Math.ceil((action.estimated_hours || 0.5) * 60 / 30) * 30); sessionStorage.setItem("lifeplan-pomodoro-prefill", JSON.stringify({ actionId: action.id, plannedSeconds: minutes * 60 })); setPickerSlot(null); navigate("/pomodoro"); }} onAssigned={(assignedSlots) => { setSchedule((current) => current ? { ...current, slots: current.slots.map((item) => assignedSlots.find((assigned) => assigned.id === item.id) ?? item) } : current); setPickerSlot(null); }} />
    <DailySlotModal slot={selectedSlot} onClose={() => setSelectedSlot(null)} onSaved={(slot) => { refreshSlot(slot); setSelectedSlot(slot); }} />
    <TimeSlotModal slot={timeSlot} onClose={() => setTimeSlot(null)} onSaved={async () => { setTimeSlot(null); await load(); }} onDeleted={async () => { setTimeSlot(null); await load(); message.success("时间段已删除"); }} />
    <InsertSlotModal date={date} preset={insertPreset} onClose={() => setInsertPreset(null)} onSaved={async () => { setInsertPreset(null); await load(); message.success("已新增时间段"); }} />
    {workLogOpen && <WorkLogModal date={date} slots={slots} onClose={() => setWorkLogOpen(false)} />}
  </div>;
}

function ScheduleTable({ slots, onPlan, onReview, onEditTime, onInsert }: { slots: DailyScheduleSlot[]; onPlan: (slot: DailyScheduleSlot) => void; onReview: (slot: DailyScheduleSlot) => void; onEditTime: (slot: DailyScheduleSlot) => void; onInsert: (index: number) => void }) {
  return <div className="daily-schedule-card card"><div className="daily-schedule-head"><div>时间段</div><div>安排行动</div><div>复盘</div></div><div className="daily-schedule-body">{slots.map((slot, index) => <div className="daily-schedule-row-wrap" key={slot.id}><div className="daily-schedule-row"><div className="daily-time-cell" role="button" tabIndex={0} onClick={() => onEditTime(slot)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onEditTime(slot); }}>{slotLabel(slot)}{index < slots.length - 1 && <button className="daily-insert-button" type="button" aria-label="插入时间段" title="插入时间段" onClick={(event) => { event.stopPropagation(); onInsert(index); }}><span className="daily-insert-plus"><Plus size={14} /></span></button>}</div><PlanCell slot={slot} onClick={() => onPlan(slot)} /><ReviewCell slot={slot} onClick={() => onReview(slot)} /></div></div>)}</div></div>;
}

function PlanCell({ slot, onClick }: { slot: DailyScheduleSlot; onClick: () => void }) {
  const action = slot.action; const statusClass = !action ? "empty" : action.status === 1 ? "completed" : action.status === 2 ? "abandoned" : "pending";
  return <button type="button" className={`daily-plan-cell daily-cell-button ${statusClass}`} onClick={onClick}>{action ? <><span className="daily-inline-tags"><Tag color={priorityColor(action.priority)}>P{action.priority}</Tag>{action.is_frog === 1 && <Tag color="green">青蛙</Tag>}</span><span className={`daily-inline-title ${action.status === 1 ? "completed-title" : ""}`}>{action.title}</span></> : <span className="daily-empty-action">+ 点击安排行动</span>}</button>;
}

function ReviewCell({ slot, onClick }: { slot: DailyScheduleSlot; onClick: () => void }) {
  const reviewed = slot.met_expectation !== undefined && slot.focused !== undefined && Boolean(slot.actual_notes);
  return <button type="button" className={`daily-review-cell daily-cell-button ${reviewed ? "reviewed" : "empty"}`} onClick={onClick}>{reviewed ? <><span className="daily-inline-tags"><Tag color={slot.met_expectation === 1 ? "green" : "red"}>{slot.met_expectation === 1 ? "达到预期" : "未达预期"}</Tag><Tag color={slot.focused === 1 ? "blue" : "red"}>{slot.focused === 1 ? "专注" : "未专注"}</Tag></span><span className="daily-review-summary">{slot.actual_notes}</span></> : <span className="daily-review-placeholder">添加复盘</span>}</button>;
}

function InsertSlotModal({ date, preset, onClose, onSaved }: { date: string; preset: { startTime?: string; endTime?: string } | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form] = Form.useForm(); const [saving, setSaving] = useState(false);
  useEffect(() => { if (!preset) return; form.resetFields(); if (preset.startTime && preset.endTime) form.setFieldsValue({ start_time: dayjs(`2000-01-01T${preset.startTime}`), end_time: dayjs(`2000-01-01T${preset.endTime}`) }); }, [preset, form]);
  if (!preset) return null;
  const submit = async (values: Record<string, unknown>) => { const startTime = (values.start_time as Dayjs).format("HH:mm"); const endTime = (values.end_time as Dayjs).format("HH:mm"); if (minutesBetween(startTime, endTime) <= 0) { message.error("结束时间必须晚于开始时间，且不能超过次日 00:00"); return; } setSaving(true); try { await dailyScheduleApi.createSlot({ list_date: date, start_time: startTime, end_time: endTime }); await onSaved(); } catch (cause) { message.error(userFacingError(cause)); } finally { setSaving(false); } };
  return <AntModal open title="新增时间段" onCancel={onClose} footer={null} destroyOnHidden><Form form={form} className="form" layout="vertical" onFinish={(values) => void submit(values)}><div className="form-grid"><Form.Item name="start_time" label="开始时间" rules={[{ required: true }]}><TimePicker format="HH:mm" minuteStep={30} className="full-width" /></Form.Item><Form.Item name="end_time" label="结束时间" rules={[{ required: true }]}><TimePicker format="HH:mm" minuteStep={30} className="full-width" /></Form.Item></div><div className="form-footer"><Button onClick={onClose}>取消</Button><Button type="primary" htmlType="submit" loading={saving}>保存时间段</Button></div></Form></AntModal>;
}

function TimeSlotModal({ slot, onClose, onSaved, onDeleted }: { slot: DailyScheduleSlot | null; onClose: () => void; onSaved: () => Promise<void>; onDeleted: () => Promise<void> }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (slot) form.setFieldsValue({ start_time: dayjs(`2000-01-01T${slot.start_time}`), end_time: dayjs(`2000-01-01T${slot.end_time}`) });
  }, [slot, form]);
  if (!slot) return null;

  const submit = async (values: Record<string, unknown>) => {
    setSaving(true);
    try {
      await dailyScheduleApi.updateSlot({ id: slot.id, start_time: (values.start_time as Dayjs).format("HH:mm"), end_time: (values.end_time as Dayjs).format("HH:mm") });
      await onSaved();
      message.success("时间段已更新");
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

  return <AntModal open title={`编辑时间段 · ${slotLabel(slot)}`} onCancel={onClose} footer={null} destroyOnHidden><Form form={form} className="form" layout="vertical" onFinish={(values) => void submit(values)}><div className="form-grid"><Form.Item name="start_time" label="开始时间" rules={[{ required: true, message: "请选择开始时间" }]}><TimePicker format="HH:mm" minuteStep={30} className="full-width" /></Form.Item><Form.Item name="end_time" label="结束时间" dependencies={["start_time"]} rules={[{ required: true, message: "请选择结束时间" }, ({ getFieldValue }) => ({ validator(_, value) { const start = getFieldValue("start_time") as Dayjs | undefined; if (!value || !start || value.isAfter(start)) return Promise.resolve(); return Promise.reject(new Error("结束时间必须晚于开始时间")); } })]}><TimePicker format="HH:mm" minuteStep={30} className="full-width" /></Form.Item></div><div className="form-footer"><Button onClick={onClose}>取消</Button>{slot.action_id ? <Button danger disabled title="请先移除已安排的行动">删除时间段</Button> : <Popconfirm title="确定删除这个时间段吗？" onConfirm={() => void remove()} okText="删除" cancelText="取消"><Button danger loading={saving}>删除时间段</Button></Popconfirm>}<Button type="primary" htmlType="submit" loading={saving}>保存时间段</Button></div></Form></AntModal>;
}

function ActionPickerModal({ slot, slots, actions, onGuideToInbox, onClose, onStartPomodoro, onAssigned }: { slot: DailyScheduleSlot | null; slots: DailyScheduleSlot[]; actions: Action[]; onGuideToInbox: () => void; onClose: () => void; onStartPomodoro: (action: Action) => void; onAssigned: (slots: DailyScheduleSlot[]) => void }) {
  const [mode, setMode] = useState<"existing" | "new" | "recurring" | "new-recurring" | "edit-recurring">("existing");
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [query, setQuery] = useState("");
  const [recurringActions, setRecurringActions] = useState<RecurringAction[]>([]);
  const [recurringQuery, setRecurringQuery] = useState("");
  const [editingRecurringAction, setEditingRecurringAction] = useState<RecurringAction | null>(null);

  useEffect(() => {
    if (!slot) return;
    setMode("existing");
    setQuery("");
    setRecurringQuery("");
    setEditingRecurringAction(null);
    setViewing(Boolean(slot.action));
    void recurringActionsApi.list().then(setRecurringActions).catch((cause) => message.error(userFacingError(cause)));
  }, [slot]);
  if (!slot) return null;

  const selectableActions = actions.filter((action) => action.status === 0 && (action.event_id != null || action.project_id != null || action.is_delegated_follow_up === 1));
  const visibleActions = selectableActions.filter((action) => action.title.toLowerCase().includes(query.trim().toLowerCase()) || action.description?.toLowerCase().includes(query.trim().toLowerCase()));
  const visibleRecurringActions = recurringActions.filter((action) => action.title.toLowerCase().includes(recurringQuery.trim().toLowerCase()));

  const performAssign = async (targets: DailyScheduleSlot[], actionId: number) => {
    setSaving(true);
    try {
      const assigned = [];
      for (const target of targets) assigned.push(await dailyScheduleApi.assignAction(target.id, actionId));
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
    const previousAssigned = slots.slice(0, currentIndex).some((item) => item.action_id === action.id);
    const currentMinutes = minutesBetween(slot.start_time, slot.end_time);
    const requiredMinutes = Math.max(0, Math.round(action.estimated_hours * 60));
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
        AntModal.confirm({ title: "提示", content: "该行动耗时预计大于当前这段可安排时间", okText: "我已了解", cancelText: "取消", onOk: async () => { await performAssign([slot], action.id); } });
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
    const index = recurringActions.findIndex((action) => action.id === recurringActionId);
    const targetIndex = index + offset;
    if (index < 0 || targetIndex < 0 || targetIndex >= recurringActions.length || saving) return;
    const reordered = [...recurringActions];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    setSaving(true);
    try {
      setRecurringActions(await recurringActionsApi.reorder({ action_ids: reordered.map((action) => action.id) }));
    } catch (cause) {
      message.error(userFacingError(cause));
    } finally {
      setSaving(false);
    }
  };

  const createRecurring = async (payload: NewRecurringAction | UpdateRecurringAction) => {
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

  const updateRecurring = async (payload: NewRecurringAction | UpdateRecurringAction) => {
    setSaving(true);
    try {
      if (!("id" in payload)) throw new Error("重复行动信息已失效，请重新打开编辑");
      const updated = await recurringActionsApi.update(payload);
      setRecurringActions((current) => current.map((item) => item.id === updated.id ? updated : item));
      setEditingRecurringAction(null);
      setMode("recurring");
      message.success("重复行动已更新");
    } catch (cause) {
      message.error(userFacingError(cause));
    } finally {
      setSaving(false);
    }
  };

  if (viewing && slot.action) return <AntModal open title={`行动详情 · ${slotLabel(slot)}`} onCancel={onClose} footer={null} destroyOnHidden><ActionPreview action={slot.action} /><div className="form-footer"><Button onClick={() => setViewing(false)}>更换行动</Button><Button type="primary" onClick={() => slot.action && onStartPomodoro(slot.action)}>开始番茄钟</Button></div></AntModal>;
  return <AntModal open title={`安排行动 · ${slotLabel(slot)}`} onCancel={onClose} footer={null} destroyOnHidden>
    {(mode === "existing" || mode === "recurring" || mode === "new") && <Radio.Group className="daily-picker-radio" value={mode} onChange={(event) => setMode(event.target.value as "existing" | "recurring" | "new")} optionType="button" buttonStyle="solid"><Radio.Button value="existing">项目行动</Radio.Button><Radio.Button value="recurring">重复行动</Radio.Button><Radio.Button value="new">临时行动</Radio.Button></Radio.Group>}
    {mode === "existing" && (selectableActions.length === 0 ? <div className="daily-action-empty-guide"><div className="daily-action-empty-guide-icon"><ListChecks size={30} strokeWidth={1.8} /></div><Typography.Title level={4}>还没有可以直接安排的行动</Typography.Title><Typography.Paragraph>先把事情拆解成一步步能马上开始的行动，再依次安排到每天，会更容易将事情推进完成。</Typography.Paragraph><div className="daily-action-empty-guide-example"><span>例如</span><span>准备汇报</span><ArrowRight size={14} /><span>整理数据 → 写提纲 → 完成初稿</span></div><Button type="primary" icon={<ArrowRight size={15} />} iconPosition="end" onClick={onGuideToInbox}>去事件篮拆分活动</Button></div> : <><Input allowClear value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索行动标题关键词" /><div className="daily-action-picker-list">{visibleActions.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有符合条件的行动" /> : visibleActions.map((action, index) => <button className={`daily-action-picker-item ${action.id === slot.action_id ? "selected" : ""}`} type="button" key={action.id} onClick={() => void assign(action.id)} disabled={saving}><ActionPreview action={action} index={index + 1} scheduledToday={slots.some((item) => item.action_id === action.id)} /></button>)}</div></>)}
    {mode === "recurring" && <><div className="daily-picker-search-row"><Input allowClear value={recurringQuery} onChange={(event) => setRecurringQuery(event.target.value)} placeholder="搜索重复行动标题" /><Button icon={<Plus size={15} />} onClick={() => setMode("new-recurring")}>新增重复行动</Button></div><div className="daily-action-picker-list">{visibleRecurringActions.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={recurringActions.length === 0 ? "还没有重复行动" : "没有符合条件的重复行动"} /> : visibleRecurringActions.map((action, index) => { const actualIndex = recurringActions.findIndex((item) => item.id === action.id); return <div className="daily-recurring-picker-item" key={action.id}><button className="daily-action-picker-item" type="button" onClick={() => void assignRecurring(action.id)} disabled={saving}><RecurringActionPreview action={action} index={index + 1} /></button><div className="daily-recurring-order-actions"><Button type="text" size="small" aria-label="编辑重复行动" title="编辑" icon={<Pencil size={15} />} disabled={saving} onClick={(event) => { event.stopPropagation(); setEditingRecurringAction(action); setMode("edit-recurring"); }} /><Button type="text" size="small" aria-label="上移重复行动" title="上移" icon={<ChevronUp size={15} />} disabled={actualIndex === 0 || saving} onClick={(event) => { event.stopPropagation(); void moveRecurring(action.id, -1); }} /><Button type="text" size="small" aria-label="下移重复行动" title="下移" icon={<ChevronDown size={15} />} disabled={actualIndex === recurringActions.length - 1 || saving} onClick={(event) => { event.stopPropagation(); void moveRecurring(action.id, 1); }} /></div></div>; })}</div></>}
    {mode === "new" && <NewActionForm onSubmit={async (payload) => { try { const action = await actionsApi.create(payload); await assignAction(action); } catch (cause) { message.error(userFacingError(cause)); } }} />}
    {(mode === "new-recurring" || mode === "edit-recurring") && <NewRecurringActionForm action={editingRecurringAction} onSubmit={mode === "edit-recurring" ? updateRecurring : createRecurring} />}
    <div className="form-footer">{mode !== "new-recurring" && mode !== "edit-recurring" && <Button onClick={onClose}>取消</Button>}{mode === "new" && <Button type="primary" form="daily-new-action-form" htmlType="submit" loading={saving}>创建并安排</Button>}{(mode === "new-recurring" || mode === "edit-recurring") && <>{(mode === "new-recurring" || mode === "edit-recurring") && <Button onClick={() => { setEditingRecurringAction(null); setMode("recurring"); }}>取消</Button>}<Button type="primary" form="daily-new-recurring-action-form" htmlType="submit" loading={saving}>{mode === "edit-recurring" ? "保存修改" : "保存重复行动"}</Button></>}</div>
  </AntModal>;
}
function DailySlotModal({ slot, onClose, onSaved }: { slot: DailyScheduleSlot | null; onClose: () => void; onSaved: (slot: DailyScheduleSlot) => void }) {
  const [form] = Form.useForm(); const [saving, setSaving] = useState(false); const [completeAfterReview, setCompleteAfterReview] = useState(false);
  useEffect(() => {
    if (!slot) return;
    setCompleteAfterReview(false);
    const isNewReview = slot.actual_notes === undefined && slot.met_expectation === undefined && slot.focused === undefined;
    const defaultActualNotes = slot.action ? `${slot.action.project_title ? `${slot.action.project_title}-` : ""}${slot.action.title}` : "";
    form.setFieldsValue({
      actual_notes: isNewReview ? defaultActualNotes : slot.actual_notes,
      met_expectation: isNewReview ? 1 : slot.met_expectation,
      focused: isNewReview ? 1 : slot.focused,
    });
  }, [slot, form]);
  if (!slot) return null;
  const saveReview = async () => { try { setSaving(true); const values = await form.validateFields(["actual_notes", "met_expectation", "focused"]); let reviewed = await dailyScheduleApi.updateReview({ id: slot.id, actual_notes: String(values.actual_notes), met_expectation: Number(values.met_expectation) as 0 | 1, focused: Number(values.focused) as 0 | 1 }); track("完成每日复盘", { met_expectation: Number(values.met_expectation) === 1, focused: Number(values.focused) === 1 }); if (completeAfterReview && slot.action_id) { await actionsApi.complete(slot.action_id); const refreshed = await dailyScheduleApi.get(slot.list_date); reviewed = refreshed.slots.find((item) => item.id === slot.id) ?? reviewed; } onSaved(reviewed); onClose(); message.success(completeAfterReview ? "复盘已保存，行动已完成" : "复盘已保存"); } catch (cause) { if (cause && typeof cause === "object" && "errorFields" in cause) return; message.error(userFacingError(cause)); } finally { setSaving(false); setCompleteAfterReview(false); } };
  const restore = async () => { if (!slot.action_id) return; try { await actionsApi.restore(slot.action_id); const refreshed = await dailyScheduleApi.get(slot.list_date); onSaved(refreshed.slots.find((item) => item.id === slot.id) ?? slot); message.success("行动已恢复"); } catch (cause) { message.error(userFacingError(cause)); } };
  return <AntModal open title={`时间段详情 · ${slotLabel(slot)}`} onCancel={onClose} footer={null} destroyOnHidden><Form form={form} className="form daily-slot-form" layout="vertical">{slot.action ? <ActionPreview action={slot.action} /> : <div className="daily-action-preview-empty">当前时间段尚未安排行动</div>}<Form.Item name="actual_notes" label="实际工作情况" rules={[{ required: true, whitespace: true, message: "请填写实际工作情况" }]}><Input.TextArea autoSize={{ minRows: 3, maxRows: 5 }} /></Form.Item><div className="form-grid"><Form.Item name="met_expectation" label="是否达到预期" rules={[{ required: true, message: "请选择是否达到预期" }]}><Select options={[{ value: 1, label: "达到预期" }, { value: 0, label: "未达预期" }]} /></Form.Item><Form.Item name="focused" label="是否专注" rules={[{ required: true, message: "请选择是否专注" }]}><Select options={[{ value: 1, label: "专注" }, { value: 0, label: "未专注" }]} /></Form.Item></div><div className="daily-slot-actions"><Space>{slot.action?.status === 0 && <Checkbox checked={completeAfterReview} onChange={(event) => setCompleteAfterReview(event.target.checked)}>已完成行动</Checkbox>}{slot.action?.status === 1 && <Button icon={<RotateCcw size={14} />} onClick={() => void restore()}>恢复行动</Button>}</Space><Space><Button type="primary" onClick={() => void saveReview()} loading={saving}>保存复盘</Button></Space></div></Form></AntModal>;
}

function ActionPreview({ action, index, scheduledToday = false }: { action: Action; index?: number; scheduledToday?: boolean }) {
  const relationLabel = action.project_title ? `所属项目：${action.project_title}` : action.event_title ? `来源事件：${action.event_title}` : "";
  const projectLabel = relationLabel + (action.delegated_to ? ` · 委托给 ${action.delegated_to}` : "");
  const tooltipProps = { color: "#fff", classNames: { root: "daily-action-tooltip" }, styles: { container: { color: "#303133", backgroundColor: "#fff", boxShadow: "0 4px 12px rgba(0, 0, 0, .12)" } } };
  return <div className="daily-action-preview"><div className={`daily-action-preview-title ${action.status === 1 ? "completed-title" : ""}`}>{index !== undefined && <span className="card-index">{index}.</span>}<Tooltip title={action.title} {...tooltipProps}><span className="daily-action-preview-title-text">{action.title}</span></Tooltip>{scheduledToday && <Tag className="daily-action-scheduled-tag">当日已安排</Tag>}</div><div className="daily-action-preview-tags"><Tag color={priorityColor(action.priority)}>优先级 P{action.priority}</Tag><Tag color={action.estimated_hours <= 0.5 ? "blue" : action.estimated_hours <= 1 ? "cyan" : action.estimated_hours <= 1.5 ? "orange" : "red"}>{action.estimated_hours === 0.5 ? "30 分钟" : `${action.estimated_hours} 小时`}</Tag><Tag color={action.importance === 1 ? "orange" : "default"}>{action.importance === 1 ? "重要" : "不重要"}</Tag><Tag color={action.urgency === 1 ? "red" : "default"}>{action.urgency === 1 ? "紧急" : "不紧急"}</Tag><Tag color={action.status === 1 ? "green" : action.status === 2 ? "red" : "blue"}>{action.status === 1 ? "已完成" : action.status === 2 ? "已放弃" : "待办"}</Tag>{action.is_delegated_follow_up === 1 && <Tag color="gold">委托跟进</Tag>}{action.is_frog === 1 && <Tag color="green">青蛙</Tag>}</div>{(action.start_date || action.deadline) && <div className="daily-action-preview-dates">{action.start_date && <span>开始：{action.start_date}</span>}{action.deadline && <span>截止：{action.deadline}</span>}</div>}{projectLabel && <div className="daily-action-preview-project"><Tooltip title={projectLabel} {...tooltipProps}><span className="daily-action-preview-project-text">{projectLabel}</span></Tooltip></div>}{action.description && <Typography.Paragraph className="daily-action-preview-description">{action.description}</Typography.Paragraph>}</div>;
}

function RecurringActionPreview({ action, index }: { action: RecurringAction; index?: number }) {
  const frequencyLabel = `${action.frequency_unit === "daily" ? "每日" : action.frequency_unit === "weekly" ? "每周" : "每月"} ${action.frequency_count} 次`;
  return <div className="daily-action-preview"><div className="daily-action-preview-title">{index !== undefined && <span className="card-index">{index}.</span>}<span className="daily-action-preview-title-text">{action.title}</span></div><div className="daily-action-preview-tags"><Tag color={priorityColor(action.priority)}>优先级 P{action.priority}</Tag><Tag color={action.estimated_hours <= 0.5 ? "blue" : action.estimated_hours <= 1 ? "cyan" : action.estimated_hours <= 1.5 ? "orange" : "red"}>{action.estimated_hours === 0.5 ? "30 分钟" : `${action.estimated_hours} 小时`}</Tag><Tag color={action.importance === 1 ? "orange" : "default"}>{action.importance === 1 ? "重要" : "不重要"}</Tag><Tag color={action.urgency === 1 ? "red" : "default"}>{action.urgency === 1 ? "紧急" : "不紧急"}</Tag><Tag color="purple">{frequencyLabel}</Tag>{action.is_frog === 1 && <Tag color="green">青蛙</Tag>}</div></div>;
}

function NewRecurringActionForm({ action, onSubmit }: { action: RecurringAction | null; onSubmit: (payload: NewRecurringAction | UpdateRecurringAction) => Promise<void> }) {
  const [form] = Form.useForm();
  useEffect(() => {
    form.setFieldsValue(action ? {
      title: action.title, estimated_hours: action.estimated_hours, is_frog: action.is_frog === 1,
      importance: action.importance, urgency: action.urgency, frequency_unit: action.frequency_unit,
      frequency_count: action.frequency_count,
    } : { title: undefined, estimated_hours: 0.5, is_frog: false, importance: 1, urgency: 1, frequency_unit: "daily", frequency_count: 1 });
  }, [action, form]);
  return <Form id="daily-new-recurring-action-form" form={form} className="form daily-new-action-form" layout="vertical" onFinish={(values) => void onSubmit({ ...(action ? { id: action.id } : {}), title: String(values.title), estimated_hours: Number(values.estimated_hours), is_frog: values.is_frog ? 1 : 0, importance: Number(values.importance), urgency: Number(values.urgency), frequency_unit: values.frequency_unit, frequency_count: Number(values.frequency_count) })}><Form.Item name="title" label="行动标题" rules={[{ required: true, message: "请输入行动标题" }]}><Input autoFocus /></Form.Item><div className="form-grid action-modal-grid"><Form.Item name="estimated_hours" label="单次耗时" rules={[{ required: true, message: "请选择单次耗时" }]}><Select options={[{ value: 0.5, label: "30 分钟" }, { value: 1, label: "1 小时" }, { value: 1.5, label: "1.5 小时" }, { value: 2, label: "2 小时" }]} /></Form.Item><Form.Item name="frequency_unit" label="频率" rules={[{ required: true }]}><Select options={[{ value: "daily", label: "每日" }, { value: "weekly", label: "每周" }, { value: "monthly", label: "每月" }]} /></Form.Item><Form.Item name="frequency_count" label="次数" rules={[{ required: true, message: "请输入次数" }, { type: "number", min: 1, max: 99, message: "次数范围为 1～99" }]}><InputNumber min={1} max={99} precision={0} className="full-width" /></Form.Item></div><div className="form-grid action-priority-grid"><Form.Item name="importance" label="重要程度"><Select options={[{ value: 1, label: "重要" }, { value: 0, label: "不重要" }]} /></Form.Item><Form.Item name="urgency" label="紧急程度"><Select options={[{ value: 1, label: "紧急" }, { value: 0, label: "不紧急" }]} /></Form.Item></div><Form.Item name="is_frog" valuePropName="checked"><Checkbox>标记为青蛙 <FrogHelp /></Checkbox></Form.Item></Form>;
}

function NewActionForm({ onSubmit }: { onSubmit: (payload: NewAction) => Promise<void> }) {
  const [form] = Form.useForm();
  return <Form id="daily-new-action-form" form={form} className="form daily-new-action-form" layout="vertical" onFinish={(values) => void onSubmit({ title: String(values.title), estimated_hours: Number(values.estimated_hours), start_date: values.start_date ? (values.start_date as Dayjs).format("YYYY-MM-DD") : undefined, deadline: values.deadline ? (values.deadline as Dayjs).format("YYYY-MM-DD") : undefined, is_frog: values.is_frog ? 1 : 0, importance: Number(values.importance), urgency: Number(values.urgency) })}><Form.Item name="title" label="行动标题" rules={[{ required: true, message: "请输入行动标题" }]}><Input autoFocus /></Form.Item><div className="form-grid action-modal-grid"><Form.Item name="estimated_hours" label="预计耗时" initialValue={0.5} rules={[{ required: true }]}><Select options={[{ value: 0.5, label: "30 分钟" }, { value: 1, label: "1 小时" }, { value: 1.5, label: "1.5 小时" }, { value: 2, label: "2 小时" }]} /></Form.Item><Form.Item name="start_date" label="开始日期"><DatePicker className="full-width" format="YYYY-MM-DD" /></Form.Item><Form.Item name="deadline" label="截止日期"><DatePicker className="full-width" format="YYYY-MM-DD" /></Form.Item></div><div className="form-grid action-priority-grid"><Form.Item name="importance" label="重要程度" initialValue={1}><Select options={[{ value: 1, label: "重要" }, { value: 0, label: "不重要" }]} /></Form.Item><Form.Item name="urgency" label="紧急程度" initialValue={1}><Select options={[{ value: 1, label: "紧急" }, { value: 0, label: "不紧急" }]} /></Form.Item></div><Form.Item name="is_frog" valuePropName="checked"><Checkbox>标记为青蛙 <FrogHelp /></Checkbox></Form.Item></Form>;
}





















