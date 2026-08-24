import { useEffect, useMemo, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { Alert, Button, Card, DatePicker, Empty, Form, Input, Modal as AntModal, Popconfirm, Select, Space, Steps, Tabs, Tag, Typography, message } from "antd";
import { Check, Edit3, Plus, RotateCcw, Trash2 } from "lucide-react";
import { eventsApi } from "@/lib/api";
import Projects from "@/pages/Projects";
import type { Event, ProcessActionStep, ProcessEvent } from "@/types";
import Modal from "@/components/ui/Modal";

const statusLabels: Record<number, string> = { 0: "未处理", 1: "进行中", 2: "已委托", 3: "延迟", 4: "已放弃", 5: "已完成" };
const statusColors: Record<number, string> = { 0: "blue", 1: "processing", 2: "gold", 3: "orange", 4: "red", 5: "green" };
const hours = [{ value: 0.5, label: "30 分钟" }, { value: 1, label: "1 小时" }, { value: 1.5, label: "1.5 小时" }, { value: 2, label: "2 小时" }];
const cleanError = (cause: unknown) => String(cause).replace(/^Error: /, "");
const formatCreatedDate = (timestamp: number) => { const date = new Date(timestamp); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} 新增`; };
const toDateString = (value: Dayjs | string | undefined) => typeof value === "string" ? value : value?.format("YYYY-MM-DD");
type ProcessMode = "self" | "delegate" | "delay" | "abandon";
type InboxTab = "pending" | "projects" | "delegated" | "delayed" | "abandoned" | "completed";

export default function Inbox() {
  const [events, setEvents] = useState<Event[]>([]);
  const [filter, setFilter] = useState<InboxTab>("pending");
  const [newTitle, setNewTitle] = useState("");
  const [editing, setEditing] = useState<Event | null>(null);
  const [processing, setProcessing] = useState<{ event: Event; mode: ProcessMode } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => { setLoading(true); try { setEvents(await eventsApi.list()); setError(""); } catch (cause) { setError(cleanError(cause)); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const visibleEvents = useMemo(() => { const status: Record<Exclude<InboxTab, "projects">, number> = { pending: 0, delegated: 2, delayed: 3, abandoned: 4, completed: 5 }; return events.filter((event) => filter !== "projects" && event.status === status[filter]); }, [events, filter]);
  const counts = useMemo(() => ({ pending: events.filter((event) => event.status === 0).length, delegated: events.filter((event) => event.status === 2).length, delayed: events.filter((event) => event.status === 3).length, abandoned: events.filter((event) => event.status === 4).length, completed: events.filter((event) => event.status === 5).length, projects: events.filter((event) => event.status === 1).length }), [events]);
  const addEvent = async () => { if (!newTitle.trim()) return; try { await eventsApi.create({ title: newTitle.trim() }); setNewTitle(""); await load(); message.success("事件已添加"); } catch (cause) { setError(cleanError(cause)); } };
  const updateTitle = async (values: { title: string }) => { if (!editing) return; try { await eventsApi.update({ id: editing.id, title: values.title.trim() }); setEditing(null); await load(); message.success("事件已更新"); } catch (cause) { setError(cleanError(cause)); } };
  const runProcess = async (payload: ProcessEvent) => { try { await eventsApi.process(payload); setProcessing(null); setFilter(payload.decision === "self" ? "projects" : payload.decision === "delegate" ? "delegated" : payload.decision === "delay" ? "delayed" : "abandoned"); await load(); message.success("事件处理完成"); } catch (cause) { setError(cleanError(cause)); } };
  const remove = async (item: Event) => { try { await eventsApi.delete(item.id); await load(); message.success("事件已删除"); } catch (cause) { setError(cleanError(cause)); } };
  const complete = async (item: Event) => { try { await eventsApi.complete(item.id); await load(); message.success("事件已完成"); } catch (cause) { setError(cleanError(cause)); } };
  const restore = async (item: Event) => { try { await eventsApi.restore(item.id); await load(); message.success("事件已恢复"); } catch (cause) { setError(cleanError(cause)); } };

  return <div className="page">
    <header className="page-header inbox-header">
      <div className="page-header-top">
        <Typography.Title level={2} className="page-title">事件篮</Typography.Title>
        <Form className="quick-add" onFinish={() => void addEvent()}>
          <Input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="记录一个新事件…" addonAfter={<Button type="primary" htmlType="submit" disabled={!newTitle.trim()} icon={<Plus size={15} />}>新增事件</Button>} />
        </Form>
      </div>
      <Typography.Paragraph className="page-subtitle">先把脑中的事情放进来，再决定下一步怎么处理。</Typography.Paragraph>
    </header>
    <Tabs className="inbox-tabs" activeKey={filter} onChange={(key) => setFilter(key as InboxTab)} items={[{ key: "pending", label: `待处理 ${counts.pending}` }, { key: "projects", label: `进行中 ${counts.projects}` }, { key: "delegated", label: `已委托 ${counts.delegated}` }, { key: "delayed", label: `延迟 ${counts.delayed}` }, { key: "abandoned", label: `已放弃 ${counts.abandoned}` }, { key: "completed", label: `已完成 ${counts.completed}` }]} />
    {error && <Alert className="page-alert" type="error" showIcon message={error} closable onClose={() => setError("")} />}
    {filter === "projects" ? <Projects embedded onChanged={load} /> : <div className="record-list">{loading ? <div className="card empty">正在加载…</div> : visibleEvents.length === 0 ? <div className="card"><Empty className="empty" description={<span>这里还没有事件<br /><Typography.Text type="secondary">把任何待办念头先记录下来吧。</Typography.Text></span>} /></div> : visibleEvents.map((item, index) => <EventRow key={item.id} item={item} index={index + 1} onEdit={setEditing} onProcess={(mode) => setProcessing({ event: item, mode })} onDelete={() => void remove(item)} onRestore={() => void restore(item)} onComplete={() => void complete(item)} />)}</div>}
    <Modal open={Boolean(editing)} title="编辑事件" onClose={() => setEditing(null)}>{editing && <Form className="form" layout="vertical" initialValues={{ title: editing.title }} onFinish={(values) => void updateTitle(values)}><Form.Item label="事件标题" name="title" rules={[{ required: true, message: "请输入事件标题" }]}><Input autoFocus /></Form.Item><div className="form-footer"><Button onClick={() => setEditing(null)}>取消</Button><Button type="primary" htmlType="submit">保存</Button></div></Form>}</Modal>
    <ProcessModal data={processing} onClose={() => setProcessing(null)} onSubmit={runProcess} />
  </div>;
}

function EventRow({ item, index, onEdit, onProcess, onDelete, onRestore, onComplete }: { item: Event; index: number; onEdit: (event: Event) => void; onProcess: (mode: ProcessMode) => void; onDelete: () => void; onRestore: () => void; onComplete: () => void }) {
  const active = item.status === 0 || item.status === 3;
  return <Card className="record-card event-card" size="small" title={<Typography.Text strong className="row-title"><span className="card-index">{index}.</span>{item.title}</Typography.Text>} extra={<Tag color={statusColors[item.status]}>{statusLabels[item.status]}</Tag>}><div className="event-card-body"><div className="row-meta"><span>{formatCreatedDate(item.created_at)}</span>{item.project_title && <span>项目：{item.project_title}</span>}{item.delegated_to && <span>委托给 {item.delegated_to}</span>}{item.delay_until && <span>延迟至 {item.delay_until}</span>}{item.action_count > 0 && <span>{item.action_count} 条行动 · {item.pending_action_count} 条待办</span>}</div><Space className="card-actions" size={4} wrap><Button size="small" type="text" icon={<Edit3 size={14} />} onClick={() => onEdit(item)}>编辑</Button>{item.status === 4 ? <Button size="small" type="text" icon={<RotateCcw size={14} />} onClick={onRestore}>恢复</Button> : active ? <><Button size="small" type="primary" onClick={() => onProcess("self")}>自己做</Button><Button size="small" onClick={() => onProcess("delegate")}>委托</Button><Button size="small" onClick={() => onProcess("delay")}>延迟</Button><Button size="small" danger onClick={() => onProcess("abandon")}>放弃</Button>{item.status === 0 && item.completed_action_count === item.action_count && item.action_count > 0 && <Button size="small" type="primary" icon={<Check size={14} />} onClick={onComplete}>完成</Button>}</> : null}<Popconfirm title={item.project_id ? "删除事件会同时删除来源项目及其行动，确定继续吗？" : "确定删除这个事件吗？"} onConfirm={onDelete} okText="确定" cancelText="取消"><Button size="small" type="text" danger aria-label="删除" icon={<Trash2 size={15} />} /></Popconfirm></Space></div></Card>;
}

function ProcessModal({ data, onClose, onSubmit }: { data: { event: Event; mode: ProcessMode } | null; onClose: () => void; onSubmit: (payload: ProcessEvent) => Promise<void> }) {
  const [form] = Form.useForm();
  const [steps, setSteps] = useState<ProcessActionStep[]>([]);
  const [projectValues, setProjectValues] = useState<Record<string, unknown>>({});
  const [step, setStep] = useState(0);
  const [validationError, setValidationError] = useState<{ index: number; field: string } | null>(null);
  useEffect(() => { if (data) { const initialProjectValues = { project_title: data.event.title, importance: "1", urgency: "1" }; form.setFieldsValue(initialProjectValues); setProjectValues(initialProjectValues); setSteps([{ title: `完成：${data.event.title}`, estimated_hours: 1 }]); setStep(0); setValidationError(null); } }, [data, form]);
  if (!data) return null;
  const { event, mode } = data;
  const title = mode === "self" ? "转为项目" : mode === "delegate" ? "委托跟进" : mode === "delay" ? "延迟处理" : "放弃事件";
  const updateStep = (index: number, key: keyof ProcessActionStep, value: string | number) => { setValidationError((current) => current?.index === index && current.field === key ? null : current); setSteps((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item)); };
  const submit = async (values: Record<string, unknown>) => {
    if (mode === "self" && step === 0) { if (!(values.project_title as string)?.trim()) return; setProjectValues(values); setStep(1); return; }
    if (mode === "self") { const invalidIndex = steps.findIndex((item) => !item.title?.trim() || !item.start_date || !item.estimated_hours); if (invalidIndex >= 0) { const item = steps[invalidIndex]; setValidationError({ index: invalidIndex, field: !item.title?.trim() ? "title" : !item.start_date ? "start_date" : "estimated_hours" }); return; } }
    const savedProjectValues = mode === "self" ? projectValues : {};
    await onSubmit({ event_id: event.id, decision: mode, project_title: (savedProjectValues.project_title ?? values.project_title) as string, target: (savedProjectValues.target ?? values.target) as string, start_date: toDateString((savedProjectValues.start_date ?? values.start_date) as Dayjs | string | undefined), deadline: toDateString((savedProjectValues.deadline ?? values.deadline) as Dayjs | string | undefined), importance: Number(savedProjectValues.importance ?? values.importance), urgency: Number(savedProjectValues.urgency ?? values.urgency), action_steps: steps, delegated_to: values.delegated_to as string, follow_up_date: toDateString(values.follow_up_date as Dayjs | string | undefined), follow_up_note: values.follow_up_note as string, action_title: values.action_title as string, delay_until: toDateString(values.delay_until as Dayjs | string | undefined), delay_note: values.delay_note as string, abandon_reason: values.abandon_reason as string });
  };
  const dateField = (name: string, label: string, required = false) => <Form.Item name={name} label={label} rules={required ? [{ required: true, message: `请选择${label}` }] : undefined}><DatePicker className="full-width" format="YYYY-MM-DD" /></Form.Item>;
  return <AntModal open title={title} onCancel={onClose} footer={null} width={640} destroyOnHidden>
    <Form form={form} className="form" layout="vertical" onFinish={(values) => void submit(values)}>
      {mode === "self" ? <><Steps current={step} items={[{ title: "创建项目" }, { title: "拆解行动" }]} className="process-steps" />{step === 0 ? <div className="form-grid"><Form.Item className="full" name="project_title" label="项目标题" rules={[{ required: true, message: "请输入项目标题" }]}><Input autoFocus /></Form.Item><Form.Item className="full" name="target" label="项目目标"><Input.TextArea autoSize={{ minRows: 3, maxRows: 5 }} /></Form.Item>{dateField("start_date", "开始日期")}{dateField("deadline", "截止日期")}<Form.Item name="importance" label="重要程度"><Select options={[{ value: "1", label: "重要" }, { value: "0", label: "不重要" }]} /></Form.Item><Form.Item name="urgency" label="紧急程度"><Select options={[{ value: "1", label: "紧急" }, { value: "0", label: "不紧急" }]} /></Form.Item></div> : <div className="action-steps"><Typography.Text type="secondary">把项目拆成具体、可执行的行动，至少填写一条。</Typography.Text><div className="action-step-header"><span className="action-step-header-title">行动标题 *</span><span className="action-step-header-date">开始日期 *</span><span className="action-step-header-duration">预计耗时 *</span><span /></div>{steps.map((item, index) => <div key={index} className="action-step-wrap"><div className="action-step-row"><span className="action-step-number">{index + 1}</span><Input className="action-step-title" aria-label="行动标题" value={item.title} onChange={(e) => updateStep(index, "title", e.target.value)} placeholder="填写行动标题" /><DatePicker className="action-step-date" aria-label="开始日期" value={item.start_date ? dayjs(item.start_date) : null} format="YYYY-MM-DD" onChange={(value) => updateStep(index, "start_date", value?.format("YYYY-MM-DD") ?? "")} /><Select className="action-step-duration" aria-label="预计耗时" value={item.estimated_hours || undefined} options={hours} onChange={(value) => updateStep(index, "estimated_hours", value)} placeholder="选择耗时" />{steps.length > 1 && <Button type="text" danger aria-label="删除行动" icon={<Trash2 size={15} />} onClick={() => setSteps((current) => current.filter((_, itemIndex) => itemIndex !== index))} />}</div>{validationError?.index === index && <Tag color="error">请填写{validationError.field === "title" ? "行动标题" : validationError.field === "start_date" ? "开始日期" : "预计耗时"}。</Tag>}</div>)}<Button type="dashed" icon={<Plus size={14} />} onClick={() => setSteps((current) => [...current, { title: "", estimated_hours: 0.5 }])}>添加下一步行动</Button></div>}</> : mode === "delegate" ? <div className="form-grid"><Form.Item name="delegated_to" label="委托对象" rules={[{ required: true, message: "请输入委托对象" }]}><Input /></Form.Item>{dateField("follow_up_date", "跟进日期", true)}<Form.Item name="action_title" label="跟进行动标题" rules={[{ required: true, message: "请输入跟进行动标题" }]}><Input /></Form.Item><Form.Item className="full" name="follow_up_note" label="跟进说明"><Input.TextArea autoSize={{ minRows: 3, maxRows: 5 }} /></Form.Item></div> : mode === "delay" ? <div className="form-grid">{dateField("delay_until", "重新处理日期")}<Form.Item className="full" name="delay_note" label="备注"><Input.TextArea autoSize={{ minRows: 3, maxRows: 5 }} /></Form.Item></div> : <Form.Item name="abandon_reason" label="放弃原因" rules={[{ required: true, message: "请输入放弃原因" }]}><Input.TextArea autoFocus autoSize={{ minRows: 3, maxRows: 5 }} /></Form.Item>}
      <div className="form-footer"><Button onClick={step === 1 && mode === "self" ? () => setStep(0) : onClose}>{step === 1 && mode === "self" ? "上一步" : "取消"}</Button><Button type="primary" danger={mode === "abandon"} htmlType="submit">{mode === "self" ? step === 0 ? "下一步" : "创建项目" : "确认"}</Button></div>
    </Form>
  </AntModal>;
}
