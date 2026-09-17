import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import dayjs, { type Dayjs } from "dayjs";
import { Alert, Button, Card, Checkbox, DatePicker, Empty, Form, Input, List, Modal as AntModal, Popconfirm, Select, Space, Steps, Tabs, Tag, Typography, message } from "antd";
import { Check, ChevronDown, Edit3, ListChecks, Plus, RotateCcw, Trash2 } from "lucide-react";
import { actionsApi, eventsApi, projectsApi } from "@/lib/api";
import Projects from "@/pages/Projects";
import type { Event, ProcessActionStep, ProcessEvent } from "@/types";
import { userFacingError } from "@/lib/errors";
import Modal from "@/components/ui/Modal";
import { track } from "@/lib/analytics";

const statusLabels: Record<number, string> = { 0: "未处理", 1: "进行中", 2: "已委托", 3: "推迟", 4: "已放弃", 5: "已完成" };
const statusColors: Record<number, string> = { 0: "blue", 1: "processing", 2: "gold", 3: "orange", 4: "red", 5: "green" };
const hours = [{ value: 0.5, label: "30 分钟" }, { value: 1, label: "1 小时" }, { value: 1.5, label: "1.5 小时" }, { value: 2, label: "2 小时" }];
const formatCreatedDate = (timestamp: number) => { const date = new Date(timestamp); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} 新增`; };
const toDateString = (value: Dayjs | string | undefined) => typeof value === "string" ? value : value?.format("YYYY-MM-DD");
type ProcessMode = "self" | "delegate" | "delay" | "abandon";
type InboxTab = "pending" | "projects" | "delegated" | "delayed" | "abandoned" | "completed";

export default function Inbox() {
  const [events, setEvents] = useState<Event[]>([]);
  const [filter, setFilter] = useState<InboxTab>("pending");
  const [newTitle, setNewTitle] = useState("");
  const [messageApi, messageContextHolder] = message.useMessage();
  const [editing, setEditing] = useState<Event | null>(null);
  const [processing, setProcessing] = useState<{ event: Event; mode: ProcessMode } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [guideNewEvent, setGuideNewEvent] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const load = async () => { setLoading(true); try { setEvents(await eventsApi.list()); setError(""); } catch (cause) { setError(userFacingError(cause)); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const state = location.state as { guideNewEvent?: boolean } | null;
    if (!state?.guideNewEvent) return;
    setFilter("pending");
    setGuideNewEvent(true);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".quick-add input")?.focus());
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);
  const visibleEvents = useMemo(() => { const status: Record<Exclude<InboxTab, "projects">, number> = { pending: 0, delegated: 2, delayed: 3, abandoned: 4, completed: 5 }; return events.filter((event) => filter !== "projects" && event.status === status[filter]); }, [events, filter]);
  const counts = useMemo(() => ({ pending: events.filter((event) => event.status === 0).length, delegated: events.filter((event) => event.status === 2).length, delayed: events.filter((event) => event.status === 3).length, abandoned: events.filter((event) => event.status === 4).length, completed: events.filter((event) => event.status === 5).length, projects: events.filter((event) => event.status === 1).length }), [events]);
  const addEvent = async () => { if (!newTitle.trim()) return; try { await eventsApi.create({ title: newTitle.trim() }); track("创建事件"); setNewTitle(""); await load(); message.success("事件已添加"); } catch (cause) { setError(userFacingError(cause)); } };
  const showEmptyTitleMessage = () => { messageApi.open({ type: "info", content: "请先输入事件名称", className: "quick-add-empty-toast" }); };
  const updateTitle = async (values: { title: string }) => { if (!editing) return; try { await eventsApi.update({ id: editing.id, title: values.title.trim() }); setEditing(null); await load(); message.success("事件已更新"); } catch (cause) { setError(userFacingError(cause)); } };
  const runProcess = async (payload: ProcessEvent) => { try { await eventsApi.process(payload); track("事件转项目", { decision: payload.decision }); setProcessing(null); setFilter(payload.decision === "self" ? "projects" : payload.decision === "delegate" ? "delegated" : payload.decision === "delay" ? "delayed" : "abandoned"); await load(); message.success("事件处理完成"); } catch (cause) { setError(userFacingError(cause)); } };
  const remove = async (item: Event) => { try { await eventsApi.delete(item.id); await load(); message.success("事件已删除"); } catch (cause) { setError(userFacingError(cause)); } };
  const complete = async (item: Event, closeProcessing = false) => { try { await eventsApi.complete(item.id); if (closeProcessing) setProcessing(null); await load(); message.success("事件已完成"); } catch (cause) { setError(userFacingError(cause)); } };
  const restore = async (item: Event) => { try { await eventsApi.restore(item.id); await load(); message.success("事件已恢复"); } catch (cause) { setError(userFacingError(cause)); } };

  return <div className="page">{messageContextHolder}
    <header className="page-header inbox-header">
      <div className="page-header-top">
        <div>
          <Typography.Title level={2} className="page-title">事件篮</Typography.Title>
          <Typography.Paragraph className="page-subtitle">先把脑中的事情放进来，再决定下一步怎么处理。</Typography.Paragraph>
        </div>
        <Form className="quick-add" onFinish={() => void addEvent()}>
          <Input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="记录一个新事件…" addonAfter={<span className="quick-add-button-wrapper"><Button type="primary" htmlType="submit" disabled={!newTitle.trim()} icon={<Plus size={15} />}>新增事件</Button>{!newTitle.trim() && <button className="quick-add-button-overlay" type="button" aria-label="请先输入事件名称" onClick={showEmptyTitleMessage} />}</span>} />
        </Form>
      </div>
    </header>
    <Tabs className="inbox-tabs" activeKey={filter} onChange={(key) => setFilter(key as InboxTab)} items={[{ key: "pending", label: `待处理 ${counts.pending}` }, { key: "projects", label: `进行中 ${counts.projects}` }, { key: "delegated", label: `已委托 ${counts.delegated}` }, { key: "delayed", label: `推迟 ${counts.delayed}` }, { key: "abandoned", label: `已放弃 ${counts.abandoned}` }, { key: "completed", label: `已完成 ${counts.completed}` }]} />
    {error && <Alert className="page-alert" type="error" showIcon message={error} closable onClose={() => setError("")} />}
    {filter === "projects" ? <Projects embedded onChanged={load} /> : <div className={`record-list ${loading || visibleEvents.length === 0 ? "record-list-empty" : ""}`}>{loading ? <div className="card empty">正在加载…</div> : visibleEvents.length === 0 ? <div className={`card ${filter === "pending" ? "onboarding-empty" : "inbox-empty-state"}`}><Empty className="empty" image={Empty.PRESENTED_IMAGE_DEFAULT} description={filter === "pending" ? <div><Typography.Title level={4}>先把脑中的事情记下来</Typography.Title><Typography.Paragraph type="secondary">记录后再决定是自己做、委托、延后，还是放弃。</Typography.Paragraph><Button type="primary" onClick={() => document.querySelector<HTMLInputElement>(".quick-add input")?.focus()}>记录第一件事</Button></div> : "暂无事件"} /></div> : visibleEvents.map((item, index) => <EventRow key={item.id} item={item} index={index + 1} onEdit={setEditing} onProcess={(mode) => setProcessing({ event: item, mode })} onDelete={() => void remove(item)} onRestore={() => void restore(item)} onComplete={() => void complete(item)} />)}</div>}
    <Modal open={Boolean(editing)} title="编辑事件" onClose={() => setEditing(null)}>{editing && <Form className="form" layout="vertical" initialValues={{ title: editing.title }} onFinish={(values) => void updateTitle(values)}><Form.Item label="事件标题" name="title" rules={[{ required: true, message: "请输入事件标题" }]}><Input autoFocus /></Form.Item><div className="form-footer"><Button onClick={() => setEditing(null)}>取消</Button><Button type="primary" htmlType="submit">保存</Button></div></Form>}</Modal>
    <ProcessModal data={processing} onClose={() => setProcessing(null)} onSubmit={runProcess} onQuickComplete={async () => { if (processing) await complete(processing.event, true); }} />
    {guideNewEvent && <div className="inbox-guide-overlay" role="dialog" aria-label="添加事件引导">
      <div className="inbox-guide-callout">
        <Typography.Text>先在这里记录一个新事件，然后点击“自己做”，把它拆成一步步可直接执行的行动。</Typography.Text>
        <Button type="primary" onClick={() => { setGuideNewEvent(false); requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".quick-add input")?.focus()); }}>我知道了</Button>
      </div>
    </div>}
  </div>;
}

function EventRow({ item, index, onEdit, onProcess, onDelete, onRestore, onComplete }: { item: Event; index: number; onEdit: (event: Event) => void; onProcess: (mode: ProcessMode) => void; onDelete: () => void; onRestore: () => void; onComplete: () => void }) {
  const active = item.status === 0 || item.status === 3;
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState<{ target?: string; actions: { id: number; title: string; status: number; start_date?: string; estimated_hours: number; deadline?: string; completed_at?: number }[] } | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const toggleDetails = async () => {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (details || item.status !== 5) return;
    setDetailsLoading(true);
    try {
      const [projects, actions] = await Promise.all([projectsApi.list(), actionsApi.list()]);
      const project = projects.find((candidate) => candidate.id === item.project_id || candidate.event_id === item.id);
      setDetails({ target: project?.target, actions: actions.filter((action) => action.event_id === item.id || action.project_id === project?.id).sort((a, b) => a.sort_order - b.sort_order).map((action) => ({ id: action.id, title: action.title, status: action.status, start_date: action.start_date, estimated_hours: action.estimated_hours, deadline: action.deadline, completed_at: action.completed_at })) });
    } finally { setDetailsLoading(false); }
  };
  if (item.status === 5) return <Card className="record-card project-card completed-event-card" size="small" onClick={(event) => { if (event.target instanceof Element && event.target.closest("button, a, input, textarea, select, [role='button'], .project-actions-panel")) return; void toggleDetails(); }} title={<div className="project-card-header-shell"><div className="project-card-header"><Typography.Text strong className="project-card-title"><span className="card-index">{index}.</span>{item.title}</Typography.Text><Tag className="project-status-tag" color="green">已完成</Tag><div className="project-card-meta"><button type="button" className="project-action-summary" aria-expanded={expanded} onClick={(event) => { event.stopPropagation(); void toggleDetails(); }}><ListChecks size={15} strokeWidth={1.8} aria-hidden="true" />行动 {item.completed_action_count}/{item.action_count}</button><span className="completed-event-created-meta">{formatCreatedDate(item.created_at)}</span></div></div><Space className="project-card-extra" onClick={(event) => event.stopPropagation()} size={4} wrap><Button size="small" type="text" icon={<Edit3 size={14} />} onClick={() => onEdit(item)}>编辑</Button><Popconfirm title={item.project_id ? "删除事件会同时删除来源项目及其行动，确定继续吗？" : "确定删除这个事件吗？"} onConfirm={onDelete} okText="确定" cancelText="取消"><Button size="small" danger type="text" icon={<Trash2 size={14} />} /></Popconfirm></Space></div>}>{expanded && <div className="project-actions-panel event-details-panel">{detailsLoading ? <Typography.Text type="secondary">正在加载详情…</Typography.Text> : <>{details?.target && <><div className="project-section-head"><Typography.Text strong>项目目标</Typography.Text></div><div className="project-target-panel"><Typography.Paragraph className="project-target-text">{details.target}</Typography.Paragraph></div></>}<div className="project-actions-head"><Space size={8}><Typography.Text strong>行动列表</Typography.Text><Typography.Text type="secondary">仅支持按日期查看</Typography.Text></Space></div>{details?.actions.length ? <List className="event-detail-actions" dataSource={details.actions} renderItem={(action, actionIndex) => <List.Item className="project-action-item event-detail-action-row"><List.Item.Meta avatar={<span className="project-action-drag-handle"><span className="project-action-number">{actionIndex + 1}</span></span>} title={<span className={`project-action-title ${action.status === 1 ? "completed-title" : ""}`}>{action.title}</span>} description={<Space className="action-meta" wrap><span className="action-start-meta">{action.start_date ? `${action.start_date} 开始` : "未设置开始日期"}</span><span className="action-duration-meta">{!action.estimated_hours ? "未设置预计耗时" : action.estimated_hours === 0.5 ? "30分钟" : `${action.estimated_hours}小时`}</span>{action.completed_at && <span className="action-detail-meta">{formatCreatedDate(action.completed_at).replace(" 新增", " 完成")}</span>}{action.deadline && <span className="action-detail-meta">截止 {action.deadline}</span>}</Space>} /><div className="event-detail-action-status"><Tag color="green">已完成</Tag></div></List.Item>} /> : <Typography.Text type="secondary">暂无行动</Typography.Text>}</>}</div>}</Card>;
  return <Card className="record-card event-card" size="small" title={<Typography.Text strong className="row-title"><span className="card-index">{index}.</span>{item.title}</Typography.Text>} extra={<Tag color={statusColors[item.status]}>{statusLabels[item.status]}</Tag>}><div className="event-card-body"><div className="row-meta"><span>{formatCreatedDate(item.created_at)}</span>{item.project_title && <span>项目：{item.project_title}</span>}{item.delegated_to && <span>委托给 {item.delegated_to}</span>}{item.delay_until && <span>推迟至 {item.delay_until}</span>}{item.status === 2 && item.follow_up_date ? <span>{item.follow_up_date} 跟进</span> : item.action_count > 0 && <span>{item.action_count} 条行动 · {item.pending_action_count} 条待办</span>}</div>{false && <button type="button" className="project-action-summary event-details-toggle" aria-expanded={expanded} onClick={() => void toggleDetails()}><ChevronDown size={15} strokeWidth={1.8} className={expanded ? "event-details-chevron expanded" : "event-details-chevron"} aria-hidden="true" />{expanded ? "收起目标和行动" : "查看目标和行动"}</button>}{expanded && <div className="project-actions-panel event-details-panel">{detailsLoading ? <Typography.Text type="secondary">正在加载详情…</Typography.Text> : <>{details?.target && <><div className="project-section-head"><Typography.Text strong>项目目标</Typography.Text></div><div className="project-target-panel"><Typography.Paragraph className="project-target-text">{details.target}</Typography.Paragraph></div></>}<div className="project-actions-head"><Typography.Text strong>行动列表</Typography.Text><Typography.Text type="secondary">仅支持按日期查看</Typography.Text></div>{details?.actions.length ? <List className="event-detail-actions" dataSource={details.actions} renderItem={(action, index) => <List.Item className="project-action-item event-detail-action-row"><List.Item.Meta avatar={<span className="project-action-number">{index + 1}</span>} title={<span className={`project-action-title ${action.status === 1 ? "completed-title" : ""}`}>{action.title}</span>} description={<Space className="action-meta" wrap><span>{action.start_date ? `${action.start_date} 开始` : "未设置开始日期"}</span><span>{!action.estimated_hours ? "未设置预计耗时" : action.estimated_hours === 0.5 ? "30分钟" : `${action.estimated_hours}小时`}</span>{action.deadline && <span>截止 {action.deadline}</span>}</Space>} /><Tag color={action.status === 1 ? "green" : action.status === 2 ? "red" : "blue"}>{action.status === 1 ? "已完成" : action.status === 2 ? "已放弃" : "待办"}</Tag></List.Item>} /> : <Typography.Text type="secondary">暂无行动</Typography.Text>}</>}</div>}<Space className="card-actions" size={4} wrap><Button size="small" type="text" icon={<Edit3 size={14} />} onClick={() => onEdit(item)}>编辑</Button>{item.status === 4 ? <Button size="small" type="text" icon={<RotateCcw size={14} />} onClick={onRestore}>恢复</Button> : active ? <><Button size="small" type="primary" onClick={() => onProcess("self")}>自己做</Button><Button size="small" onClick={() => onProcess("delegate")}>委托</Button><Button size="small" onClick={() => onProcess("delay")}>推迟</Button><Button size="small" danger onClick={() => onProcess("abandon")}>放弃</Button>{item.status === 0 && item.completed_action_count === item.action_count && item.action_count > 0 && <Button size="small" type="primary" icon={<Check size={14} />} onClick={onComplete}>完成</Button>}</> : null}<Popconfirm title={item.project_id ? "删除事件会同时删除来源项目及其行动，确定继续吗？" : "确定删除这个事件吗？"} onConfirm={onDelete} okText="确定" cancelText="取消"><Button size="small" type="text" danger aria-label="删除" icon={<Trash2 size={15} />} /></Popconfirm></Space></div></Card>;
}

function ProcessModal({ data, onClose, onSubmit, onQuickComplete }: { data: { event: Event; mode: ProcessMode } | null; onClose: () => void; onSubmit: (payload: ProcessEvent) => Promise<void>; onQuickComplete: () => Promise<void> }) {
  const [form] = Form.useForm();
  const [steps, setSteps] = useState<ProcessActionStep[]>([]);
  const [projectValues, setProjectValues] = useState<Record<string, unknown>>({});
  const [step, setStep] = useState(0);
  const [validationError, setValidationError] = useState<{ index: number; field: string } | null>(null);
  const [quickComplete, setQuickComplete] = useState(false);
  const actionTitleRefs = useRef<Array<{ focus: () => void } | null>>([]);
  const focusActionIndex = useRef<number | null>(null);
  useEffect(() => { if (data) { const initialProjectValues = { project_title: data.event.title, importance: "1", urgency: "0" }; form.setFieldsValue(initialProjectValues); setProjectValues(initialProjectValues); setSteps([{ title: `完成：${data.event.title}`, start_date: "", estimated_hours: 0 }]); setStep(0); setValidationError(null); setQuickComplete(false); } }, [data, form]);
  useEffect(() => {
    if (focusActionIndex.current === null) return;
    const index = focusActionIndex.current;
    focusActionIndex.current = null;
    requestAnimationFrame(() => actionTitleRefs.current[index]?.focus());
  }, [steps]);
  if (!data) return null;
  const { event, mode } = data;
  const title = mode === "self" ? "拆解行动" : mode === "delegate" ? "委托跟进" : mode === "delay" ? "推迟处理" : "放弃事件";
  const addActionAfter = (index: number) => {
    const previous = steps[index];
    const nextIndex = index + 1;
    setSteps((current) => [...current.slice(0, nextIndex), { title: "", start_date: previous?.start_date, estimated_hours: 0 }, ...current.slice(nextIndex)]);
    setValidationError(null);
    focusActionIndex.current = nextIndex;
  };
  const handleFormKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (mode !== "self" || step !== 1 || event.key !== "Enter") return;
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-action-step-index]");
    if (!row) return;
    event.preventDefault();
    event.stopPropagation();
    addActionAfter(Number(row.dataset.actionStepIndex));
  };
  const updateStep = (index: number, key: keyof ProcessActionStep, value: string | number) => { setValidationError((current) => current?.index === index && current.field === key ? null : current); setSteps((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item)); };
  const submit = async (values: Record<string, unknown>) => {
    if (mode === "self" && step === 0) { if (!(values.project_title as string)?.trim()) return; if (quickComplete) { await onQuickComplete(); return; } setProjectValues(values); setStep(1); return; }
    if (mode === "self") { const invalidIndex = steps.findIndex((item) => !item.title?.trim()); if (invalidIndex >= 0) { setValidationError({ index: invalidIndex, field: "title" }); return; } }
    const savedProjectValues = mode === "self" ? projectValues : {};
    await onSubmit({ event_id: event.id, decision: mode, project_title: (savedProjectValues.project_title ?? values.project_title) as string, target: (savedProjectValues.target ?? values.target) as string, start_date: toDateString((savedProjectValues.start_date ?? values.start_date) as Dayjs | string | undefined), deadline: toDateString((savedProjectValues.deadline ?? values.deadline) as Dayjs | string | undefined), importance: Number(savedProjectValues.importance ?? values.importance), urgency: Number(savedProjectValues.urgency ?? values.urgency), action_steps: steps, delegated_to: values.delegated_to as string, follow_up_date: toDateString(values.follow_up_date as Dayjs | string | undefined), delay_until: toDateString(values.delay_until as Dayjs | string | undefined), delay_note: values.delay_note as string, abandon_reason: values.abandon_reason as string });
  };
  const dateField = (name: string, label: string, required = false) => <Form.Item name={name} label={label} rules={required ? [{ required: true, message: `请选择${label}` }] : undefined}><DatePicker className="full-width" format="YYYY-MM-DD" /></Form.Item>;
  return <AntModal open title={title} onCancel={onClose} footer={null} width={640} destroyOnHidden className="process-action-modal" wrapClassName="process-action-modal-wrap" styles={{ body: { display: "flex", minHeight: 0, overflow: "hidden" } }}>
    <Form form={form} className="form" layout="vertical" onKeyDown={handleFormKeyDown} onFinish={(values) => void submit(values)}>
      <div className="process-action-scroll-area">{mode === "self" ? <><Steps current={step} items={[{ title: "梳理事件" }, { title: "拆解行动" }]} className="process-steps" />{step === 0 ? <div className="form-grid"><Form.Item className="full" name="project_title" label="事件标题" rules={[{ required: true, message: "请输入事件标题" }]}><Input autoFocus /></Form.Item><Form.Item name="importance" label="重要程度"><Select options={[{ value: "1", label: "重要" }, { value: "0", label: "不重要" }]} /></Form.Item><Form.Item name="urgency" label="紧急程度"><Select options={[{ value: "1", label: "紧急" }, { value: "0", label: "不紧急" }]} /></Form.Item><Form.Item className="full" name="target" label="事件目标"><Input.TextArea placeholder="选填" autoSize={{ minRows: 3, maxRows: 5 }} /></Form.Item></div> : <div className="action-steps"><Typography.Text type="secondary">把项目拆成具体、可执行的行动，按回车键可快速添加。</Typography.Text><div className="action-step-header"><span className="action-step-header-title">行动标题 *</span><span className="action-step-header-date">开始日期（选填）</span><span className="action-step-header-duration">预计耗时（选填）</span><span /></div>{steps.map((item, index) => <div key={index} className="action-step-wrap"><div className="action-step-row" data-action-step-index={index}><span className="action-step-number">{index + 1}</span><Input ref={(element) => { actionTitleRefs.current[index] = element; }} className="action-step-title" aria-label="行动标题" value={item.title} onChange={(e) => updateStep(index, "title", e.target.value)} placeholder="填写行动标题" /><DatePicker className="action-step-date" aria-label="开始日期" value={item.start_date ? dayjs(item.start_date) : null} format="YYYY-MM-DD" onChange={(value) => updateStep(index, "start_date", value?.format("YYYY-MM-DD") ?? "")} /><Select className="action-step-duration" aria-label="预计耗时" value={item.estimated_hours || undefined} options={hours} onChange={(value) => updateStep(index, "estimated_hours", value)} placeholder="选择耗时" />{steps.length > 1 && <Button type="text" danger aria-label="删除行动" icon={<Trash2 size={15} />} onClick={() => setSteps((current) => current.filter((_, itemIndex) => itemIndex !== index))} />}</div>{validationError?.index === index && <Tag color="error">请填写行动标题。</Tag>}</div>)}<Button type="dashed" icon={<Plus size={14} />} onClick={() => setSteps((current) => [...current, { title: "", start_date: current[current.length - 1]?.start_date, estimated_hours: 0 }])}>添加下一步行动</Button></div>}</> : mode === "delegate" ? <div className="form-grid"><Form.Item name="delegated_to" label="委托对象" rules={[{ required: true, message: "请输入委托对象" }]}><Input /></Form.Item>{dateField("follow_up_date", "跟进日期", true)}</div> : mode === "delay" ? <div className="form-grid">{dateField("delay_until", "重新处理日期")}<Form.Item className="full" name="delay_note" label="备注"><Input.TextArea autoSize={{ minRows: 3, maxRows: 5 }} /></Form.Item></div> : <Form.Item name="abandon_reason" label="放弃原因" rules={[{ required: true, message: "请输入放弃原因" }]}><Input.TextArea autoFocus autoSize={{ minRows: 3, maxRows: 5 }} /></Form.Item>}
      </div><div className="form-footer">{mode === "self" && step === 0 && <Checkbox checked={quickComplete} onChange={(event) => setQuickComplete(event.target.checked)}>2分钟小事直接完成</Checkbox>}<div className="form-footer-actions"><Button onClick={step === 1 && mode === "self" ? () => setStep(0) : onClose}>{step === 1 && mode === "self" ? "上一步" : "取消"}</Button><Button type="primary" danger={mode === "abandon"} htmlType="submit">{mode === "self" ? step === 0 ? "下一步" : "保存" : "确认"}</Button></div></div>
    </Form>
  </AntModal>;
}

