import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { Alert, Button, Card, DatePicker, Empty, Form, Input, List, Popconfirm, Select, Space, Tag, Typography, Checkbox, message } from "antd";
import { Check, Edit3, GripVertical, ListChecks, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { actionsApi, projectsApi } from "@/lib/api";
import type { Action, Project, UpdateAction, UpdateProject } from "@/types";
import { userFacingError } from "@/lib/errors";
import Modal from "@/components/ui/Modal";
import FrogHelp from "@/components/ui/FrogHelp";
import { track } from "@/lib/analytics";

const hours = [{ value: 0.5, label: "30 分钟" }, { value: 1, label: "1 小时" }, { value: 1.5, label: "1.5 小时" }, { value: 2, label: "2 小时" }];
const formatDate = (value?: Dayjs | string) => typeof value === "string" ? value : value?.format("YYYY-MM-DD");
const formatDuration = (value: number) => value === 0.5 ? "30分钟" : `${value}小时`;

const compareActionDate = (left: Action, right: Action) => {
  if (left.start_date && right.start_date && left.start_date !== right.start_date) return left.start_date.localeCompare(right.start_date);
  if (left.start_date && !right.start_date) return -1;
  if (!left.start_date && right.start_date) return 1;
  return left.created_at - right.created_at || left.id - right.id;
};

const actionDateKey = (action: Action) => action.start_date ?? "9999-12-31";

const sortProjectActions = (actions: Action[]) => {
  return [...actions].sort((left, right) => {
    const dateOrder = actionDateKey(left).localeCompare(actionDateKey(right));
    if (dateOrder !== 0) return dateOrder;
    const leftOrder = (left.sort_order ?? 0) > 0 ? left.sort_order : Number.MAX_SAFE_INTEGER;
    const rightOrder = (right.sort_order ?? 0) > 0 ? right.sort_order : Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return compareActionDate(left, right);
  });
};

export default function Projects({ embedded = false, onChanged }: { embedded?: boolean; onChanged?: () => void | Promise<void> }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [editing, setEditing] = useState<Project | null>(null);
  const [editingAction, setEditingAction] = useState<Action | null | undefined>(undefined);
  const [actionProject, setActionProject] = useState<Project | null>(null);
  const [abandoning, setAbandoning] = useState<Project | null>(null);
  const [error, setError] = useState("");
  const load = async () => { try { const [projectList, actionList] = await Promise.all([projectsApi.list(), actionsApi.list()]); setProjects(projectList); setActions(actionList); setError(""); setExpanded((current) => current.length === 0 && projectList.length > 0 ? [String(projectList[0].id)] : current); } catch (cause) { setError(userFacingError(cause)); } };
  useEffect(() => { void load(); }, []);
  const visible = useMemo(() => projects.filter((item) => item.status === 0), [projects]);
  const actionsByProject = useMemo(() => { const grouped = new Map<number, Action[]>(); actions.forEach((action) => { if (action.project_id === undefined) return; grouped.set(action.project_id, [...(grouped.get(action.project_id) ?? []), action]); }); return grouped; }, [actions]);
  const reorderActions = async (projectId: number, actionIds: number[]) => {
    const previous = actions;
    const orderById = new Map(actionIds.map((actionId, index) => [actionId, index + 1]));
    setActions((current) => current.map((action) => orderById.has(action.id) ? { ...action, sort_order: orderById.get(action.id) ?? action.sort_order } : action));
    try {
      await actionsApi.reorder({ project_id: projectId, action_ids: actionIds });
    } catch (cause) {
      setActions(previous);
      setError(userFacingError(cause));
      throw cause;
    }
  };
  const deleteProject = async (item: Project) => { try { await projectsApi.delete(item.id); await load(); await onChanged?.(); message.success("项目已删除"); } catch (cause) { setError(userFacingError(cause)); } };
  const completeProject = async (item: Project) => { try { await projectsApi.complete(item.id); track("完成项目"); await load(); await onChanged?.(); message.success("项目已完成"); } catch (cause) { setError(userFacingError(cause)); } };
  const deleteAction = async (item: Action) => { try { await actionsApi.delete(item.id); await load(); await onChanged?.(); message.success("行动已删除"); } catch (cause) { setError(userFacingError(cause)); } };

  return <div className={embedded ? "projects-embedded" : "page"}>{!embedded && <header className="page-header"><div><Typography.Title level={2} className="page-title">项目</Typography.Title><Typography.Paragraph className="page-subtitle">从事件转化而来的可执行结果，拆成一条条行动。</Typography.Paragraph></div></header>}
    {!embedded && <div className="toolbar project-toolbar"><Typography.Text type="secondary">共 {visible.length} 个项目</Typography.Text></div>}
    {error && <Alert className="page-alert" type="error" showIcon message={error} closable onClose={() => setError("")} />}
    <div className={`record-list ${visible.length === 0 ? "record-list-empty" : ""}`}>{visible.length === 0 ? <div className="card projects-empty-state"><Empty className="empty" description="还没有项目" /></div> : visible.map((item, index) => { const key = String(item.id); const isExpanded = expanded.includes(key); const toggleExpanded = () => setExpanded((current) => isExpanded ? current.filter((value) => value !== key) : [...current, key]); return <Card key={key} className="record-card project-card project-card-clickable" size="small" onClick={(event) => { const target = event.target; if (target instanceof Element && target.closest("button, a, input, textarea, select, [role='button'], .project-actions-panel")) return; toggleExpanded(); }} title={<div className="project-card-header-shell"><ProjectHeader project={item} index={index + 1} expanded={isExpanded} onToggle={toggleExpanded} /><ProjectExtra project={item} onEdit={() => setEditing(item)} onComplete={() => void completeProject(item)} onAbandon={() => setAbandoning(item)} onDelete={() => void deleteProject(item)} /></div>}>{isExpanded && <ProjectActionList project={item} actions={actionsByProject.get(item.id) ?? []} onAdd={() => { setActionProject(item); setEditingAction(null); }} onEdit={(action) => { setActionProject(item); setEditingAction(action); }} onDelete={(action) => void deleteAction(action)} onReorder={(actionIds) => reorderActions(item.id, actionIds)} />}</Card>; })}</div>
    <ProjectModal project={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />
    <ProjectActionModal project={actionProject} action={editingAction} onClose={() => { setActionProject(null); setEditingAction(undefined); }} onSaved={async () => { setActionProject(null); setEditingAction(undefined); await load(); }} />
    <AbandonModal project={abandoning} onClose={() => setAbandoning(null)} onSaved={async (reason) => { if (abandoning) { try { await projectsApi.abandon(abandoning.id, reason); setAbandoning(null); await load(); message.success("项目已放弃"); } catch (cause) { setError(userFacingError(cause)); } } }} />
  </div>;
}

function ProjectHeader({ project, index, expanded, onToggle }: { project: Project; index: number; expanded: boolean; onToggle: () => void }) { return <div className="project-card-header"><Typography.Text strong className="project-card-title"><span className="card-index">{index}.</span>{project.title}</Typography.Text><Tag className="project-status-tag" color={project.status === 1 ? "green" : project.status === 2 ? "red" : "blue"}>{project.status === 0 ? "进行中" : project.status === 1 ? "已完成" : "已放弃"}</Tag><div className="project-card-meta"><button type="button" className="project-action-summary" aria-expanded={expanded} onClick={(event) => { event.stopPropagation(); onToggle(); }}><ListChecks size={15} strokeWidth={1.8} aria-hidden="true" />行动 {project.completed_action_count}/{project.action_count}</button><span className="project-priority-group"><span className={`project-priority ${project.importance ? "project-priority-important" : "project-priority-muted"}`}>{project.importance ? "重要" : "不重要"}</span><span className={`project-priority ${project.urgency ? "project-priority-urgent" : "project-priority-muted"}`}>{project.urgency ? "紧急" : "不紧急"}</span></span></div></div>; }
function ProjectExtra({ project, onEdit, onComplete, onAbandon, onDelete }: { project: Project; onEdit: () => void; onComplete: () => void; onAbandon: () => void; onDelete: () => void }) { return <Space className="project-card-extra" onClick={(event) => event.stopPropagation()} size={4} wrap><Button size="small" type="text" icon={<Edit3 size={14} />} onClick={onEdit}>编辑</Button>{project.status === 0 && project.completed_action_count === project.action_count && project.action_count > 0 && <Button size="small" type="primary" icon={<Check size={14} />} onClick={onComplete}>完成</Button>}{project.status === 0 && <Button size="small" danger type="text" onClick={onAbandon}>放弃</Button>}<Popconfirm title="删除项目会同时删除来源事件和全部项目行动，确定继续吗？" onConfirm={onDelete} okText="确定" cancelText="取消"><Button size="small" danger type="text" icon={<Trash2 size={14} />} /></Popconfirm></Space>; }

function ProjectActionList({ project, actions, onAdd, onEdit, onDelete, onReorder }: { project: Project; actions: Action[]; onAdd: () => void; onEdit: (action: Action) => void; onDelete: (action: Action) => void; onReorder: (actionIds: number[]) => Promise<void> }) {
  type DropPosition = "before" | "after";
  const [orderedActions, setOrderedActions] = useState<Action[]>(() => sortProjectActions(actions));
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null);
  const [saving, setSaving] = useState(false);
  const orderedActionsRef = useRef(orderedActions);
  const draggingIdRef = useRef<number | null>(null);
  const dropTargetRef = useRef<{ id: number; position: DropPosition } | null>(null);
  const canReorder = project.status === 0 && orderedActions.length > 1;
  const canReorderAction = (action: Action) => canReorder && orderedActions.filter((item) => actionDateKey(item) === actionDateKey(action)).length > 1;
  const canDropOn = (source: Action, target: Action) => source.id !== target.id && actionDateKey(source) === actionDateKey(target);
  useEffect(() => { const next = sortProjectActions(actions); orderedActionsRef.current = next; setOrderedActions(next); }, [actions]);
  const clearDropFeedback = () => { setDraggingId(null); setDragOverId(null); setDropPosition(null); };
  const finishReorder = (targetId: number, position: DropPosition) => {
    const sourceId = draggingIdRef.current;
    const previous = orderedActionsRef.current;
    if (!sourceId || sourceId === targetId || saving) { clearDropFeedback(); return; }
    const sourceIndex = previous.findIndex((action) => action.id === sourceId);
    const targetIndex = previous.findIndex((action) => action.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) { clearDropFeedback(); return; }
    if (!canDropOn(previous[sourceIndex], previous[targetIndex])) { clearDropFeedback(); return; }
    const next = [...previous];
    const [moved] = next.splice(sourceIndex, 1);
    const targetIndexAfterMove = next.findIndex((action) => action.id === targetId);
    next.splice(targetIndexAfterMove + (position === "after" ? 1 : 0), 0, moved);
    orderedActionsRef.current = next;
    setOrderedActions(next);
    clearDropFeedback();
    setSaving(true);
    void onReorder(next.map((action) => action.id)).then(() => message.success(`“${moved.title}”已移动到“${previous[targetIndex].title}”${position === "before" ? "之前" : "之后"}`)).catch(() => { setOrderedActions(previous); }).finally(() => setSaving(false));
  };
  useEffect(() => {
    if (draggingId === null) return undefined;
    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-action-id]");
      const targetId = Number(element?.dataset.actionId);
       if (!element || !targetId || targetId === draggingIdRef.current) return;
       const source = orderedActionsRef.current.find((action) => action.id === draggingIdRef.current);
       const target = orderedActionsRef.current.find((action) => action.id === targetId);
       if (!source || !target || !canDropOn(source, target)) {
         dropTargetRef.current = null;
         setDragOverId(null);
         setDropPosition(null);
         return;
       }
      const bounds = element.getBoundingClientRect();
      const position: DropPosition = event.clientY <= bounds.top + bounds.height / 2 ? "before" : "after";
      dropTargetRef.current = { id: targetId, position };
      setDragOverId(targetId);
      setDropPosition(position);
    };
    const handlePointerUp = () => {
      const target = dropTargetRef.current;
      dropTargetRef.current = null;
      if (target) finishReorder(target.id, target.position);
      else clearDropFeedback();
    };
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [draggingId]);
  const startPointerDrag = (event: ReactPointerEvent<HTMLElement>, actionId: number) => {
    if (!canReorderAction(orderedActions.find((action) => action.id === actionId) ?? actions[0]) || saving || event.target instanceof Element && event.target.closest("button, a, input, textarea, select")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    draggingIdRef.current = actionId;
    dropTargetRef.current = null;
    setDraggingId(actionId);
    setDragOverId(null);
    setDropPosition(null);
  };
  const renderAction = (action: Action) => {
    const isDropTarget = dragOverId === action.id && dropPosition !== null;
    const dropClass = isDropTarget ? `is-drag-over-${dropPosition}` : "";
    return (
      <List.Item
        data-action-id={action.id}
         className={`project-action-item ${canReorderAction(action) && !saving ? "is-reorderable" : ""} ${draggingId === action.id ? "is-dragging" : ""} ${dropClass}`}
        draggable={false}
        actions={[
          <Button key="edit" size="small" type="text" icon={<Edit3 size={13} />} onClick={() => onEdit(action)}>编辑</Button>,
          <Popconfirm key="delete" title="确定删除这个行动吗？" onConfirm={() => onDelete(action)} okText="确定" cancelText="取消">
            <Button size="small" danger type="text" icon={<Trash2 size={14} />} />
          </Popconfirm>,
        ]}
        onPointerDown={(event) => startPointerDrag(event, action.id)}
      >
        <List.Item.Meta
           avatar={<span className={`project-action-drag-handle ${canReorderAction(action) && !saving ? "is-enabled" : ""}`} role="button" aria-label={canReorderAction(action) ? "拖动调整同日行动顺序" : "该日期暂无可调整的行动"} title={canReorderAction(action) ? "拖动调整同日顺序" : undefined}><GripVertical size={16} aria-hidden="true" /></span>}
          title={<span className={action.status === 1 ? "completed-title" : ""}>{action.title}</span>}
          description={<Space className="action-meta" wrap>
            <span className="action-start-meta">{action.start_date ? `${action.start_date} 开始` : "未设置开始日期"}</span>
            <span className="action-duration-meta">{formatDuration(action.estimated_hours)}</span>
            {action.deadline && <span className="action-detail-meta">截止 {action.deadline}</span>}
            {action.description && <span className="action-detail-meta">{action.description}</span>}
          </Space>}
        />
        {isDropTarget && <span className="project-action-drop-label">放到此行动{dropPosition === "before" ? "之前" : "之后"}</span>}
      </List.Item>
    );
  };
  return <div className={`project-actions-panel ${saving ? "is-saving" : ""}`} onDragLeave={(event) => { if (event.currentTarget === event.target) clearDropFeedback(); }}>
    {project.target && <><div className="project-section-head"><Typography.Text strong>项目目标</Typography.Text></div><div className="project-target-panel"><Typography.Paragraph className="project-target-text">{project.target}</Typography.Paragraph></div></>}
    <div className="project-actions-head"><Space size={8}><Typography.Text strong>行动列表</Typography.Text>{canReorder && <Typography.Text type="secondary" className="project-action-sort-hint">{saving ? <span className="project-action-saving"><LoaderCircle size={13} aria-hidden="true" />正在保存</span> : draggingId ? "正在调整同日顺序" : "仅支持同日排序"}</Typography.Text>}</Space>{project.status === 0 && <Button size="small" type="primary" icon={<Plus size={14} />} onClick={onAdd}>添加行动</Button>}</div>
    {orderedActions.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这个项目还没有行动" /> : <List dataSource={orderedActions} renderItem={renderAction} />}
  </div>;
}

function ProjectActionModal({ project, action, onClose, onSaved }: { project: Project | null; action: Action | null | undefined; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form] = Form.useForm();
  useEffect(() => { if (project && action !== undefined) form.setFieldsValue(action ? { title: action.title, description: action.description, estimated_hours: action.estimated_hours, start_date: action.start_date ? dayjs(action.start_date) : undefined, deadline: action.deadline ? dayjs(action.deadline) : undefined, is_frog: action.is_frog === 1 } : { estimated_hours: 1, is_frog: false }); }, [project, action, form]);
  if (!project || action === undefined) return null;
  const submit = async (values: Record<string, unknown>) => { const base = { title: values.title as string, description: values.description as string || undefined, estimated_hours: Number(values.estimated_hours), start_date: formatDate(values.start_date as Dayjs | undefined), deadline: formatDate(values.deadline as Dayjs | undefined), is_frog: values.is_frog ? 1 : 0, importance: project.importance, urgency: project.urgency }; try { if (action) await actionsApi.update({ ...base, id: action.id } as UpdateAction); else { await actionsApi.create({ ...base, project_id: project.id }); track("创建项目行动", { estimated_hours: base.estimated_hours, is_frog: base.is_frog === 1 }); } await onSaved(); message.success(action ? "行动已更新" : "行动已添加"); } catch (cause) { message.error(userFacingError(cause)); } };
  return <Modal open title={action ? "编辑行动" : "添加行动"} onClose={onClose}><Form form={form} className="form" layout="vertical" onFinish={(values) => void submit(values)}><Form.Item className="full" name="title" label="行动标题" rules={[{ required: true, message: "请输入行动标题" }]}><Input autoFocus /></Form.Item><div className="form-grid action-modal-grid"><Form.Item name="estimated_hours" label="预计耗时" rules={[{ required: true, message: "请选择预计耗时" }]}><Select options={hours} /></Form.Item><Form.Item name="start_date" label="开始日期" rules={[{ required: true, message: "请选择开始日期" }]}><DatePicker className="full-width" format="YYYY-MM-DD" /></Form.Item><Form.Item name="deadline" label="截止日期"><DatePicker className="full-width" format="YYYY-MM-DD" /></Form.Item></div><Form.Item name="is_frog" valuePropName="checked"><Checkbox>标记为青蛙 <FrogHelp /></Checkbox></Form.Item><div className="form-footer"><Button onClick={onClose}>取消</Button><Button type="primary" htmlType="submit">保存</Button></div></Form></Modal>;
}

function ProjectModal({ project, onClose, onSaved }: { project: Project | null; onClose: () => void; onSaved: () => Promise<void> }) { const [form] = Form.useForm(); useEffect(() => { if (project) form.setFieldsValue({ ...project, start_date: project.start_date ? dayjs(project.start_date) : undefined, deadline: project.deadline ? dayjs(project.deadline) : undefined }); }, [project, form]); if (!project) return null; const submit = async (values: Record<string, unknown>) => { try { await projectsApi.update({ id: project.id, title: values.title as string, target: values.target as string || undefined, start_date: formatDate(values.start_date as Dayjs | undefined), deadline: formatDate(values.deadline as Dayjs | undefined), importance: Number(values.importance), urgency: Number(values.urgency) } as UpdateProject); await onSaved(); message.success("项目已更新"); } catch (cause) { message.error(userFacingError(cause)); } }; return <Modal open title="编辑项目" onClose={onClose}><Form form={form} className="form" layout="vertical" onFinish={(values) => void submit(values)}><Form.Item className="full" name="title" label="项目标题" rules={[{ required: true, message: "请输入项目标题" }]}><Input autoFocus /></Form.Item><Form.Item className="full" name="target" label="项目目标"><Input.TextArea autoSize={{ minRows: 3, maxRows: 5 }} /></Form.Item><div className="form-grid"><Form.Item name="start_date" label="开始日期"><DatePicker className="full-width" format="YYYY-MM-DD" /></Form.Item><Form.Item name="deadline" label="截止日期"><DatePicker className="full-width" format="YYYY-MM-DD" /></Form.Item><Form.Item name="importance" label="重要程度"><Select options={[{ value: 1, label: "重要" }, { value: 0, label: "不重要" }]} /></Form.Item><Form.Item name="urgency" label="紧急程度"><Select options={[{ value: 1, label: "紧急" }, { value: 0, label: "不紧急" }]} /></Form.Item></div><div className="form-footer"><Button onClick={onClose}>取消</Button><Button type="primary" htmlType="submit">保存</Button></div></Form></Modal>; }
function AbandonModal({ project, onClose, onSaved }: { project: Project | null; onClose: () => void; onSaved: (reason: string) => Promise<void> }) { if (!project) return null; return <Modal open title="放弃项目" onClose={onClose}><Form className="form" onFinish={(values: { reason: string }) => void onSaved(values.reason)} layout="vertical"><Form.Item name="reason" label="放弃原因" rules={[{ required: true, whitespace: true, message: "请输入放弃原因" }]}><Input.TextArea autoFocus autoSize={{ minRows: 3, maxRows: 5 }} /></Form.Item><div className="form-footer"><Button onClick={onClose}>取消</Button><Button type="primary" danger htmlType="submit">确认放弃</Button></div></Form></Modal>; }












