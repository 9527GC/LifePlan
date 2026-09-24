import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import dayjs, { type Dayjs } from "dayjs";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Empty,
  Form,
  Input,
  List,
  Modal as AntModal,
  Popconfirm,
  Select,
  Space,
  Steps,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import {
  Check,
  Edit3,
  GripVertical,
  ListChecks,
  LoaderCircle,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { actionsApi, eventsApi } from "@/lib/api";
import type {
  Action,
  Event,
  ProcessActionStep,
  ProcessEvent,
  UpdateAction,
} from "@/types";
import { userFacingError } from "@/lib/errors";
import Modal from "@/components/ui/Modal";
import { track } from "@/lib/analytics";
import { sortByPriority } from "@/lib/prioritySort";

const statusLabels: Record<number, string> = {
  0: "未处理",
  1: "进行中",
  2: "已委托",
  3: "推迟",
  4: "已放弃",
  5: "已完成",
};
const statusColors: Record<number, string> = {
  0: "blue",
  1: "processing",
  2: "gold",
  3: "orange",
  4: "red",
  5: "green",
};
const hours = [
  { value: 0.5, label: "30 分钟" },
  { value: 1, label: "1 小时" },
  { value: 1.5, label: "1.5 小时" },
  { value: 2, label: "2 小时" },
];
const formatCreatedDate = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} 新增`;
};
const toDateString = (value: Dayjs | string | undefined) =>
  typeof value === "string" ? value : value?.format("YYYY-MM-DD");
const formatDuration = (value: number) =>
  value === 0 ? "未设置预计耗时" : value === 0.5 ? "30分钟" : `${value}小时`;
const compareActionDate = (left: Action, right: Action) => {
  if (
    left.start_date &&
    right.start_date &&
    left.start_date !== right.start_date
  )
    return left.start_date.localeCompare(right.start_date);
  if (left.start_date && !right.start_date) return -1;
  if (!left.start_date && right.start_date) return 1;
  return left.created_at - right.created_at || left.id - right.id;
};
const sortEventActions = (actions: Action[]) =>
  [...actions].sort((left, right) => {
    const leftOrder =
      (left.sort_order ?? 0) > 0 ? left.sort_order : Number.MAX_SAFE_INTEGER;
    const rightOrder =
      (right.sort_order ?? 0) > 0 ? right.sort_order : Number.MAX_SAFE_INTEGER;
    return leftOrder !== rightOrder
      ? leftOrder - rightOrder
      : compareActionDate(left, right);
  });
type ProcessMode = "self" | "delegate" | "delay" | "abandon";
type InboxTab =
  "pending" | "events" | "delegated" | "delayed" | "abandoned" | "completed";

export default function Inbox() {
  const [events, setEvents] = useState<Event[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [editingAction, setEditingAction] = useState<{
    event: Event;
    action?: Action;
  } | null>(null);
  const [expandedEventIds, setExpandedEventIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [filter, setFilter] = useState<InboxTab>("pending");
  const [newTitle, setNewTitle] = useState("");
  const [messageApi, messageContextHolder] = message.useMessage();
  const [editing, setEditing] = useState<Event | null>(null);
  const [processing, setProcessing] = useState<{
    event: Event;
    mode: ProcessMode;
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [guideNewEvent, setGuideNewEvent] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const load = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const [eventList, actionList] = await Promise.all([
        eventsApi.list(),
        actionsApi.list(),
      ]);
      setEvents(eventList);
      setActions(actionList);
      setError("");
    } catch (cause) {
      setError(userFacingError(cause));
    } finally {
      if (showLoading) setLoading(false);
    }
  };
  const toggleEventExpanded = (eventId: number) =>
    setExpandedEventIds((current) => {
      const next = new Set(current);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  const reorderEventActions = async (eventId: number, actionIds: number[]) => {
    const previous = actions;
    const orderById = new Map(
      actionIds.map((actionId, index) => [actionId, index + 1]),
    );
    setActions((current) =>
      current.map((action) =>
        orderById.has(action.id)
          ? {
              ...action,
              sort_order: orderById.get(action.id) ?? action.sort_order,
            }
          : action,
      ),
    );
    try {
      await actionsApi.reorderEvent({
        event_id: eventId,
        action_ids: actionIds,
      });
    } catch (cause) {
      setActions(previous);
      setError(userFacingError(cause));
      throw cause;
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    const state = location.state as { guideNewEvent?: boolean } | null;
    if (!state?.guideNewEvent) return;
    setFilter("pending");
    setGuideNewEvent(true);
    requestAnimationFrame(() =>
      document.querySelector<HTMLInputElement>(".quick-add input")?.focus(),
    );
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);
  const visibleEvents = useMemo(() => {
    const status: Record<InboxTab, number> = {
      pending: 0,
      events: 1,
      delegated: 2,
      delayed: 3,
      abandoned: 4,
      completed: 5,
    };
    const filtered = events.filter((event) => event.status === status[filter]);
    if (filter !== "events") return filtered;
    // 进行中事件按 P1、P2、P3、P4 排列；优先级数值越小越靠前。
    return sortByPriority(
      filtered.map((event) => ({
        ...event,
        priority: 4 - ((event.importance ?? 1) * 2 + (event.urgency ?? 0)),
      })),
    );
  }, [events, filter]);
  const counts = useMemo(
    () => ({
      pending: events.filter((event) => event.status === 0).length,
      delegated: events.filter((event) => event.status === 2).length,
      delayed: events.filter((event) => event.status === 3).length,
      abandoned: events.filter((event) => event.status === 4).length,
      completed: events.filter((event) => event.status === 5).length,
      events: events.filter((event) => event.status === 1).length,
    }),
    [events],
  );
  const addEvent = async () => {
    if (!newTitle.trim()) return;
    try {
      await eventsApi.create({ title: newTitle.trim() });
      track("创建事件");
      setNewTitle("");
      await load();
      message.success("事件已添加");
    } catch (cause) {
      setError(userFacingError(cause));
    }
  };
  const showEmptyTitleMessage = () => {
    messageApi.open({
      type: "info",
      content: "请先输入事件名称",
      className: "quick-add-empty-toast",
    });
  };
  const updateEvent = async (values: {
    title: string;
    target?: string;
    deadline?: Dayjs;
    importance?: number;
    urgency?: number;
  }) => {
    if (!editing) return;
    try {
      await eventsApi.update({
        id: editing.id,
        title: values.title.trim(),
        target: values.target?.trim() || undefined,
        deadline: toDateString(values.deadline),
        importance: Number(values.importance ?? 1),
        urgency: Number(values.urgency ?? 0),
      });
      setEditing(null);
      await load();
      message.success("事件已更新");
    } catch (cause) {
      setError(userFacingError(cause));
    }
  };
  const runProcess = async (payload: ProcessEvent) => {
    try {
      await eventsApi.process(payload);
      track("处理事件", {
        decision: payload.decision,
        quick_complete: Boolean(payload.quick_complete),
      });
      setProcessing(null);
      setFilter(
        payload.quick_complete
          ? "completed"
          : payload.decision === "self"
            ? "events"
            : payload.decision === "delegate"
              ? "delegated"
              : payload.decision === "delay"
                ? "delayed"
                : "abandoned",
      );
      await load();
      message.success(payload.quick_complete ? "事件已完成" : "事件处理完成");
    } catch (cause) {
      setError(userFacingError(cause));
    }
  };
  const remove = async (item: Event) => {
    try {
      await eventsApi.delete(item.id);
      await load();
      message.success("事件已删除");
    } catch (cause) {
      setError(userFacingError(cause));
    }
  };
  const complete = async (item: Event, closeProcessing = false) => {
    try {
      const result = await eventsApi.complete(item.id);
      if (closeProcessing) setProcessing(null);
      await load();
      message.success(
        result && result.points_awarded > 0
          ? `事件已完成，全部搞定 +${result.points_awarded} 积分`
          : "事件已完成",
      );
    } catch (cause) {
      setError(userFacingError(cause));
    }
  };
  const restore = async (item: Event) => {
    try {
      await eventsApi.restore(item.id);
      await load();
      message.success("事件已恢复");
    } catch (cause) {
      setError(userFacingError(cause));
    }
  };

  return (
    <div className="page">
      {messageContextHolder}
      <header className="page-header inbox-header">
        <div className="page-header-top">
          <div>
            <Typography.Title level={2} className="page-title">
              事件篮
            </Typography.Title>
            <Typography.Paragraph className="page-subtitle">
              先把脑中的事情放进来，再决定下一步怎么处理。
            </Typography.Paragraph>
          </div>
          <Form className="quick-add" onFinish={() => void addEvent()}>
            <Input
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder="记录一个新事件…"
              addonAfter={
                <span className="quick-add-button-wrapper">
                  <Button
                    type="primary"
                    htmlType="submit"
                    disabled={!newTitle.trim()}
                    icon={<Plus size={15} />}
                  >
                    新增事件
                  </Button>
                  {!newTitle.trim() && (
                    <button
                      className="quick-add-button-overlay"
                      type="button"
                      aria-label="请先输入事件名称"
                      onClick={showEmptyTitleMessage}
                    />
                  )}
                </span>
              }
            />
          </Form>
        </div>
      </header>
      <Tabs
        className="inbox-tabs"
        activeKey={filter}
        onChange={(key) => setFilter(key as InboxTab)}
        items={[
          { key: "pending", label: `待处理 ${counts.pending}` },
          { key: "events", label: `进行中 ${counts.events}` },
          { key: "delegated", label: `已委托 ${counts.delegated}` },
          { key: "delayed", label: `推迟 ${counts.delayed}` },
          { key: "abandoned", label: `已放弃 ${counts.abandoned}` },
          { key: "completed", label: `已完成 ${counts.completed}` },
        ]}
      />
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
      <div
        className={`record-list ${loading || visibleEvents.length === 0 ? "record-list-empty" : ""}`}
      >
        {loading ? (
          <div className="card empty">正在加载…</div>
        ) : visibleEvents.length === 0 ? (
          <div
            className={`card ${filter === "pending" ? "onboarding-empty" : "inbox-empty-state"}`}
          >
            <Empty
              className="empty"
              image={Empty.PRESENTED_IMAGE_DEFAULT}
              description={
                filter === "pending" ? (
                  <div>
                    <Typography.Title level={4}>
                      先把脑中的事情记下来
                    </Typography.Title>
                    <Typography.Paragraph type="secondary">
                      记录后再决定是自己做、委托、延后，还是放弃。
                    </Typography.Paragraph>
                    <Button
                      type="primary"
                      onClick={() =>
                        document
                          .querySelector<HTMLInputElement>(".quick-add input")
                          ?.focus()
                      }
                    >
                      记录第一件事
                    </Button>
                  </div>
                ) : (
                  "暂无事件"
                )
              }
            />
          </div>
        ) : (
          visibleEvents.map((item, index) => (
            <EventRow
              key={item.id}
              item={item}
              index={index + 1}
              onEdit={setEditing}
              onProcess={(mode) => setProcessing({ event: item, mode })}
              onDelete={() => void remove(item)}
              onRestore={() => void restore(item)}
              onComplete={() => void complete(item)}
              expanded={expandedEventIds.has(item.id)}
              onToggle={() => toggleEventExpanded(item.id)}
              actions={actions.filter((action) => action.event_id === item.id)}
              onAddAction={() => setEditingAction({ event: item })}
              onEditAction={(action) =>
                setEditingAction({ event: item, action })
              }
              onDeleteAction={async (action) => {
                await actionsApi.delete(action.id);
                await load(false);
                message.success("行动已删除");
              }}
              onReorder={(actionIds) => reorderEventActions(item.id, actionIds)}
            />
          ))
        )}
      </div>
      <Modal
        open={Boolean(editing)}
        title="编辑事件"
        onClose={() => setEditing(null)}
      >
        {editing && (
          <Form
            className="form"
            layout="vertical"
            initialValues={{
              title: editing.title,
              target: editing.target,
              deadline: editing.deadline ? dayjs(editing.deadline) : undefined,
              importance: editing.importance ?? 1,
              urgency: editing.urgency ?? 0,
            }}
            onFinish={(values) => void updateEvent(values)}
          >
            <Form.Item
              label="事件标题"
              name="title"
              rules={[{ required: true, message: "请输入事件标题" }]}
            >
              <Input autoFocus />
            </Form.Item>
            {editing.status !== 5 && (
              <>
                <Form.Item label="事件目标" name="target">
                  <Input.TextArea autoSize={{ minRows: 3, maxRows: 5 }} />
                </Form.Item>
                <Form.Item label="截止日期" name="deadline">
                  <DatePicker className="full-width" format="YYYY-MM-DD" />
                </Form.Item>
                <div className="form-grid">
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
              </>
            )}
            <div className="form-footer">
              <Button onClick={() => setEditing(null)}>取消</Button>
              <Button type="primary" htmlType="submit">
                保存
              </Button>
            </div>
          </Form>
        )}
      </Modal>
      <EventActionModal
        data={editingAction}
        onClose={() => setEditingAction(null)}
        onSaved={async () => {
          setEditingAction(null);
          await load(false);
        }}
      />
      <ProcessModal
        data={processing}
        onClose={() => setProcessing(null)}
        onSubmit={runProcess}
      />
      {guideNewEvent && (
        <div
          className="inbox-guide-overlay"
          role="dialog"
          aria-label="添加事件引导"
        >
          <div className="inbox-guide-callout">
            <Typography.Text>
              先在这里记录一个新事件，然后点击“去处理”，把它拆成一步步可直接执行的行动。
            </Typography.Text>
            <Button
              type="primary"
              onClick={() => {
                setGuideNewEvent(false);
                requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLInputElement>(".quick-add input")
                    ?.focus(),
                );
              }}
            >
              我知道了
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function EventRow({
  item,
  index,
  onEdit,
  onProcess,
  onDelete,
  onRestore,
  onComplete,
  expanded,
  onToggle,
  actions,
  onAddAction,
  onEditAction,
  onDeleteAction,
  onReorder,
}: {
  item: Event;
  index: number;
  onEdit: (event: Event) => void;
  onProcess: (mode: ProcessMode) => void;
  onDelete: () => void;
  onRestore: () => void;
  onComplete: () => void;
  expanded: boolean;
  onToggle: () => void;
  actions: Action[];
  onAddAction: () => void;
  onEditAction: (action: Action) => void;
  onDeleteAction: (action: Action) => Promise<void>;
  onReorder: (actionIds: number[]) => Promise<void>;
}) {
  const active = item.status === 0 || item.status === 3;
  const toggle = onToggle;
  const readOnly = item.status === 5;
  if (item.status === 1 || readOnly)
    return (
      <Card
        className="record-card event-card event-card-clickable"
        size="small"
        onClick={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest(
              "button, a, input, textarea, select, [role='button'], .event-actions-panel",
            )
          )
            return;
          toggle();
        }}
        title={
          <div className="event-card-header-shell">
            <div className="event-card-header">
              <Typography.Text strong className="event-card-title">
                <span className="card-index">{index}.</span>
                {item.title}
              </Typography.Text>
              <Tag
                className="event-status-tag"
                color={readOnly ? "green" : "blue"}
              >
                {readOnly ? "已完成" : "进行中"}
              </Tag>
              <div className="event-card-meta">
                <button
                  type="button"
                  className="event-action-summary"
                  aria-expanded={expanded}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle();
                  }}
                >
                  <ListChecks size={15} strokeWidth={1.8} aria-hidden="true" />
                  行动 {item.completed_action_count}/{item.action_count}
                </button>
                <span className="event-priority-group">
                  <span
                    className={`event-priority ${item.importance ? "event-priority-important" : "event-priority-muted"}`}
                  >
                    {item.importance ? "重要" : "不重要"}
                  </span>
                  <span
                    className={`event-priority ${item.urgency ? "event-priority-urgent" : "event-priority-muted"}`}
                  >
                    {item.urgency ? "紧急" : "不紧急"}
                  </span>
                </span>
              </div>
            </div>
            <Space
              className="event-card-extra"
              onClick={(event) => event.stopPropagation()}
              size={4}
              wrap
            >
              <Button
                size="small"
                type="text"
                icon={<Edit3 size={14} />}
                onClick={() => onEdit(item)}
              >
                编辑
              </Button>
              {!readOnly && (
                <>
                  {item.completed_action_count === item.action_count &&
                    item.action_count > 0 && (
                      <Button
                        size="small"
                        type="primary"
                        icon={<Check size={14} />}
                        onClick={onComplete}
                      >
                        完成
                      </Button>
                    )}
                  <Button
                    size="small"
                    danger
                    type="text"
                    onClick={() => onProcess("abandon")}
                  >
                    放弃
                  </Button>
                </>
              )}
              <Popconfirm
                title="删除事件会同时删除全部行动，确定继续吗？"
                onConfirm={onDelete}
                okText="确定"
                cancelText="取消"
              >
                <Button
                  size="small"
                  danger
                  type="text"
                  icon={<Trash2 size={14} />}
                />
              </Popconfirm>
            </Space>
          </div>
        }
      >
        {expanded && (
          <EventActionList
            event={item}
            actions={actions}
            readOnly={readOnly}
            onAdd={onAddAction}
            onEdit={onEditAction}
            onDelete={onDeleteAction}
            onReorder={onReorder}
          />
        )}
      </Card>
    );
  return (
    <Card
      className="record-card event-card"
      size="small"
      title={
        <Typography.Text strong className="row-title">
          <span className="card-index">{index}.</span>
          {item.title}
        </Typography.Text>
      }
      extra={
        <Tag color={statusColors[item.status]}>{statusLabels[item.status]}</Tag>
      }
    >
      <div className="event-card-body">
        <div className="row-meta">
          <span>{formatCreatedDate(item.created_at)}</span>
          {item.delegated_to && <span>委托给 {item.delegated_to}</span>}
          {item.delay_until && <span>推迟至 {item.delay_until}</span>}
          {item.action_count > 0 && (
            <span>
              {item.action_count} 条行动 · {item.pending_action_count} 条待办
            </span>
          )}
        </div>
        <Space className="card-actions" size={4} wrap>
          <Button
            size="small"
            type="text"
            icon={<Edit3 size={14} />}
            onClick={() => onEdit(item)}
          >
            编辑
          </Button>
          {item.status === 4 ? (
            <Button
              size="small"
              type="text"
              icon={<RotateCcw size={14} />}
              onClick={onRestore}
            >
              恢复
            </Button>
          ) : (
            active && (
              <>
                <Button
                  size="small"
                  type="primary"
                  onClick={() => onProcess("self")}
                >
                  去处理
                </Button>
                <Button size="small" onClick={() => onProcess("delegate")}>
                  委托
                </Button>
                <Button size="small" onClick={() => onProcess("delay")}>
                  推迟
                </Button>
                <Button
                  size="small"
                  danger
                  onClick={() => onProcess("abandon")}
                >
                  放弃
                </Button>
              </>
            )
          )}
          <Popconfirm
            title="删除事件会同时删除其全部行动，确定继续吗？"
            onConfirm={onDelete}
            okText="确定"
            cancelText="取消"
          >
            <Button
              size="small"
              type="text"
              danger
              icon={<Trash2 size={15} />}
            />
          </Popconfirm>
        </Space>
      </div>
    </Card>
  );
}

function EventActionList({
  event,
  actions,
  readOnly = false,
  onAdd,
  onEdit,
  onDelete,
  onReorder,
}: {
  event: Event;
  actions: Action[];
  readOnly?: boolean;
  onAdd: () => void;
  onEdit: (action: Action) => void;
  onDelete: (action: Action) => Promise<void>;
  onReorder: (actionIds: number[]) => Promise<void>;
}) {
  type DropPosition = "before" | "after";
  const [orderedActions, setOrderedActions] = useState<Action[]>(() =>
    sortEventActions(actions),
  );
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null);
  const [saving, setSaving] = useState(false);
  const orderedActionsRef = useRef(orderedActions);
  const draggingIdRef = useRef<number | null>(null);
  const dropTargetRef = useRef<{ id: number; position: DropPosition } | null>(
    null,
  );
  const canReorder = !readOnly && orderedActions.length > 1;
  const actionDateKey = (action: Action) => action.start_date ?? "9999-12-31";
  const canReorderAction = (action: Action) =>
    canReorder &&
    orderedActions.filter(
      (item) => actionDateKey(item) === actionDateKey(action),
    ).length > 1;
  const canDropOn = (source: Action, target: Action) =>
    source.id !== target.id && actionDateKey(source) === actionDateKey(target);

  useEffect(() => {
    const next = sortEventActions(actions);
    orderedActionsRef.current = next;
    setOrderedActions(next);
  }, [actions]);
  const clearDropFeedback = () => {
    setDraggingId(null);
    setDragOverId(null);
    setDropPosition(null);
  };
  const finishReorder = (targetId: number, position: DropPosition) => {
    const sourceId = draggingIdRef.current;
    const previous = orderedActionsRef.current;
    if (!sourceId || sourceId === targetId || saving) {
      clearDropFeedback();
      return;
    }
    const sourceIndex = previous.findIndex((action) => action.id === sourceId);
    const targetIndex = previous.findIndex((action) => action.id === targetId);
    if (
      sourceIndex < 0 ||
      targetIndex < 0 ||
      !canDropOn(previous[sourceIndex], previous[targetIndex])
    ) {
      clearDropFeedback();
      return;
    }
    const next = [...previous];
    const [moved] = next.splice(sourceIndex, 1);
    const targetIndexAfterMove = next.findIndex(
      (action) => action.id === targetId,
    );
    next.splice(
      targetIndexAfterMove + (position === "after" ? 1 : 0),
      0,
      moved,
    );
    orderedActionsRef.current = next;
    setOrderedActions(next);
    clearDropFeedback();
    setSaving(true);
    void onReorder(next.map((action) => action.id))
      .then(() =>
        message.success(
          `“${moved.title}”已移动到“${previous[targetIndex].title}”${position === "before" ? "之前" : "之后"}`,
        ),
      )
      .catch(() => {
        orderedActionsRef.current = previous;
        setOrderedActions(previous);
      })
      .finally(() => setSaving(false));
  };
  useEffect(() => {
    if (draggingId === null) return undefined;
    const handlePointerMove = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      // 拖动时元素会捕获指针，必须通过坐标查询实际悬停项，不能直接使用 event.target。
      const element = document
        .elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)
        ?.closest<HTMLElement>("[data-event-action-id]");
      const targetId = Number(element?.dataset.eventActionId);
      if (!element || !targetId || targetId === draggingIdRef.current) return;
      const source = orderedActionsRef.current.find(
        (action) => action.id === draggingIdRef.current,
      );
      const target = orderedActionsRef.current.find(
        (action) => action.id === targetId,
      );
      if (!source || !target || !canDropOn(source, target)) {
        dropTargetRef.current = null;
        setDragOverId(null);
        setDropPosition(null);
        return;
      }
      const bounds = element.getBoundingClientRect();
      const position: DropPosition =
        pointerEvent.clientY <= bounds.top + bounds.height / 2
          ? "before"
          : "after";
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
    window.addEventListener("pointermove", handlePointerMove, {
      passive: false,
    });
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [draggingId]);
  const startPointerDrag = (
    pointerEvent: ReactPointerEvent<HTMLElement>,
    actionId: number,
  ) => {
    if (
      !canReorderAction(
        orderedActions.find((action) => action.id === actionId) ?? actions[0],
      ) ||
      saving ||
      (pointerEvent.target instanceof Element &&
        pointerEvent.target.closest("button, a, input, textarea, select"))
    )
      return;
    pointerEvent.preventDefault();
    pointerEvent.currentTarget.setPointerCapture?.(pointerEvent.pointerId);
    draggingIdRef.current = actionId;
    dropTargetRef.current = null;
    setDraggingId(actionId);
    setDragOverId(null);
    setDropPosition(null);
  };
  const renderAction = (action: Action) => {
    const actionIndex = orderedActions.findIndex(
      (item) => item.id === action.id,
    );
    const isDropTarget = dragOverId === action.id && dropPosition !== null;
    const dropClass = isDropTarget ? `is-drag-over-${dropPosition}` : "";
    return (
      <List.Item
        data-event-action-id={action.id}
        className={`event-action-item ${canReorderAction(action) && !saving ? "is-reorderable" : ""} ${draggingId === action.id ? "is-dragging" : ""} ${dropClass}`}
        draggable={false}
        actions={
          readOnly
            ? undefined
            : [
                <Button
                  key="edit"
                  size="small"
                  type="text"
                  icon={<Edit3 size={13} />}
                  onClick={() => onEdit(action)}
                >
                  编辑
                </Button>,
                <Popconfirm
                  key="delete"
                  title="确定删除这个行动吗？"
                  onConfirm={() => onDelete(action)}
                  okText="确定"
                  cancelText="取消"
                >
                  <Button
                    size="small"
                    danger
                    type="text"
                    icon={<Trash2 size={14} />}
                  />
                </Popconfirm>,
              ]
        }
        onPointerDown={(pointerEvent) => {
          if (!readOnly) startPointerDrag(pointerEvent, action.id);
        }}
      >
        <List.Item.Meta
          avatar={
            readOnly ? (
              <span className="event-action-number">{actionIndex + 1}</span>
            ) : (
              <span
                className={`event-action-drag-handle ${canReorderAction(action) && !saving ? "is-enabled" : ""}`}
                role="button"
                aria-label={
                  canReorderAction(action)
                    ? "拖动调整同日行动顺序"
                    : "该日期暂无可调整的行动"
                }
                title={
                  canReorderAction(action) ? "拖动调整同日顺序" : undefined
                }
              >
                <GripVertical size={16} aria-hidden="true" />
              </span>
            )
          }
          title={
            <span
              className={`event-action-title ${action.status === 1 ? "completed-title" : ""}`}
            >
              {!readOnly && (
                <span
                  className="event-action-number"
                  aria-label={`第${actionIndex + 1}个行动`}
                >
                  {actionIndex + 1}
                </span>
              )}
              {action.title}
            </span>
          }
          description={
            <Space className="action-meta" wrap>
              <span className="action-start-meta">
                {action.start_date
                  ? `${action.start_date} 开始`
                  : "未设置开始日期"}
              </span>
              <span className="action-duration-meta">
                {formatDuration(action.estimated_hours)}
              </span>
              {action.deadline && (
                <span className="action-detail-meta">
                  截止 {action.deadline}
                </span>
              )}
              {action.description && (
                <span className="action-detail-meta">{action.description}</span>
              )}
            </Space>
          }
        />
        {isDropTarget && (
          <span className="event-action-drop-label">
            放到此行动{dropPosition === "before" ? "之前" : "之后"}
          </span>
        )}
      </List.Item>
    );
  };
  return (
    <div
      className={`event-actions-panel ${saving ? "is-saving" : ""}`}
      onDragLeave={(dragEvent) => {
        if (dragEvent.currentTarget === dragEvent.target) clearDropFeedback();
      }}
    >
      {event.target && (
        <>
          <div className="event-section-head">
            <Typography.Text strong>事件目标</Typography.Text>
          </div>
          <div className="event-target-panel">
            <Typography.Paragraph className="event-target-text">
              {event.target}
            </Typography.Paragraph>
          </div>
        </>
      )}
      <div className="event-actions-head">
        <Space size={8}>
          <Typography.Text strong>行动列表</Typography.Text>
          {canReorder && (
            <Typography.Text
              type="secondary"
              className="event-action-sort-hint"
            >
              {saving ? (
                <span className="event-action-saving">
                  <LoaderCircle size={13} aria-hidden="true" />
                  正在保存
                </span>
              ) : draggingId ? (
                "正在调整同日顺序"
              ) : (
                "仅支持同日排序"
              )}
            </Typography.Text>
          )}
        </Space>
        {!readOnly && (
          <Button
            size="small"
            type="primary"
            icon={<Plus size={14} />}
            onClick={onAdd}
          >
            添加行动
          </Button>
        )}
      </div>
      {orderedActions.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={event.is_quick_completed ? "2分钟小事直接完成" : "这个事件还没有行动"}
        />
      ) : (
        <List dataSource={orderedActions} renderItem={renderAction} />
      )}
    </div>
  );
}

function EventActionModal({
  data,
  onClose,
  onSaved,
}: {
  data: { event: Event; action?: Action } | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form] = Form.useForm();
  useEffect(() => {
    form.setFieldsValue(
      data?.action
        ? {
            title: data.action.title,
            description: data.action.description,
            estimated_hours: data.action.estimated_hours || undefined,
            start_date: data.action.start_date
              ? dayjs(data.action.start_date)
              : undefined,
            deadline: data.action.deadline
              ? dayjs(data.action.deadline)
              : undefined,
            is_frog: data.action.is_frog === 1,
          }
        : { is_frog: false },
    );
  }, [data, form]);
  if (!data) return null;
  const submit = async (values: Record<string, unknown>) => {
    const payload = {
      title: values.title as string,
      description: (values.description as string) || undefined,
      estimated_hours: Number(values.estimated_hours || 0),
      start_date: toDateString(values.start_date as Dayjs | string | undefined),
      deadline: toDateString(values.deadline as Dayjs | string | undefined),
      is_frog: values.is_frog ? 1 : 0,
      importance: data.event.importance ?? 1,
      urgency: data.event.urgency ?? 0,
    };
    try {
      if (data.action)
        await actionsApi.update({
          ...payload,
          id: data.action.id,
        } as UpdateAction);
      else await actionsApi.create({ ...payload, event_id: data.event.id });
      await onSaved();
      message.success(data.action ? "行动已更新" : "行动已添加");
    } catch (cause) {
      message.error(userFacingError(cause));
    }
  };
  return (
    <Modal open title={data.action ? "编辑行动" : "添加行动"} onClose={onClose}>
      <Form
        form={form}
        className="form"
        layout="vertical"
        onFinish={(values) => void submit(values)}
      >
        <Form.Item
          className="full"
          name="title"
          label="行动标题"
          rules={[{ required: true, message: "请输入行动标题" }]}
        >
          <Input autoFocus />
        </Form.Item>
        <div className="form-grid action-modal-grid">
          <Form.Item name="estimated_hours" label="预计耗时（选填）">
            <Select options={hours} />
          </Form.Item>
          <Form.Item name="start_date" label="开始日期（选填）">
            <DatePicker className="full-width" format="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="deadline" label="截止日期">
            <DatePicker className="full-width" format="YYYY-MM-DD" />
          </Form.Item>
        </div>
        <Form.Item name="description" label="描述">
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} />
        </Form.Item>
        <Form.Item name="is_frog" valuePropName="checked">
          <Checkbox>标记为青蛙</Checkbox>
        </Form.Item>
        <div className="form-footer">
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" htmlType="submit">
            保存
          </Button>
        </div>
      </Form>
    </Modal>
  );
}

function ProcessModal({
  data,
  onClose,
  onSubmit,
}: {
  data: { event: Event; mode: ProcessMode } | null;
  onClose: () => void;
  onSubmit: (payload: ProcessEvent) => Promise<void>;
}) {
  const [form] = Form.useForm();
  const [steps, setSteps] = useState<ProcessActionStep[]>([]);
  const [eventValues, setEventValues] = useState<Record<string, unknown>>({});
  const [step, setStep] = useState(0);
  const [validationError, setValidationError] = useState<{
    index: number;
    field: string;
  } | null>(null);
  const [quickComplete, setQuickComplete] = useState(false);
  const actionTitleRefs = useRef<Array<{ focus: () => void } | null>>([]);
  const focusActionIndex = useRef<number | null>(null);
  useEffect(() => {
    if (data) {
      const initialEventValues = {
        title: data.event.title,
        importance: "1",
        urgency: "0",
      };
      form.setFieldsValue(initialEventValues);
      setEventValues(initialEventValues);
      setSteps([
        {
          title: `完成：${data.event.title}`,
          start_date: "",
          estimated_hours: 0,
        },
      ]);
      setStep(0);
      setValidationError(null);
      setQuickComplete(false);
    }
  }, [data, form]);
  useEffect(() => {
    if (focusActionIndex.current === null) return;
    const index = focusActionIndex.current;
    focusActionIndex.current = null;
    requestAnimationFrame(() => actionTitleRefs.current[index]?.focus());
  }, [steps]);
  if (!data) return null;
  const { event, mode } = data;
  const title =
    mode === "self"
      ? "拆解行动"
      : mode === "delegate"
        ? "委托跟进"
        : mode === "delay"
          ? "推迟处理"
          : "放弃事件";
  const addActionAfter = (index: number) => {
    const previous = steps[index];
    const nextIndex = index + 1;
    setSteps((current) => [
      ...current.slice(0, nextIndex),
      { title: "", start_date: previous?.start_date, estimated_hours: 0 },
      ...current.slice(nextIndex),
    ]);
    setValidationError(null);
    focusActionIndex.current = nextIndex;
  };
  const handleFormKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (mode !== "self" || step !== 1 || event.key !== "Enter") return;
    const row = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-action-step-index]",
    );
    if (!row) return;
    event.preventDefault();
    event.stopPropagation();
    addActionAfter(Number(row.dataset.actionStepIndex));
  };
  const updateStep = (
    index: number,
    key: keyof ProcessActionStep,
    value: string | number,
  ) => {
    setValidationError((current) =>
      current?.index === index && current.field === key ? null : current,
    );
    setSteps((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item,
      ),
    );
  };
  const submit = async (values: Record<string, unknown>) => {
    if (mode === "self" && step === 0) {
      if (!(values.title as string)?.trim()) return;
      if (quickComplete) {
        await onSubmit({
          event_id: event.id,
          decision: mode,
          quick_complete: true,
          title: values.title as string,
          target: values.target as string,
          start_date: toDateString(
            values.start_date as Dayjs | string | undefined,
          ),
          deadline: toDateString(values.deadline as Dayjs | string | undefined),
          importance: Number(values.importance),
          urgency: Number(values.urgency),
          action_steps: [],
        });
        return;
      }
      setEventValues(values);
      setStep(1);
      return;
    }
    if (mode === "self") {
      const invalidIndex = steps.findIndex((item) => !item.title?.trim());
      if (invalidIndex >= 0) {
        setValidationError({ index: invalidIndex, field: "title" });
        return;
      }
    }
    const savedEventValues = mode === "self" ? eventValues : {};
    await onSubmit({
      event_id: event.id,
      decision: mode,
      title: (savedEventValues.title ?? values.title) as string,
      target: (savedEventValues.target ?? values.target) as string,
      start_date: toDateString(
        (savedEventValues.start_date ?? values.start_date) as
          Dayjs | string | undefined,
      ),
      deadline: toDateString(
        (savedEventValues.deadline ?? values.deadline) as
          Dayjs | string | undefined,
      ),
      importance: Number(savedEventValues.importance ?? values.importance),
      urgency: Number(savedEventValues.urgency ?? values.urgency),
      action_steps: steps,
      delegated_to: values.delegated_to as string,
      follow_up_date: toDateString(
        values.follow_up_date as Dayjs | string | undefined,
      ),
      delay_until: toDateString(
        values.delay_until as Dayjs | string | undefined,
      ),
      delay_note: values.delay_note as string,
      abandon_reason: values.abandon_reason as string,
    });
  };
  const dateField = (name: string, label: string, required = false) => (
    <Form.Item
      name={name}
      label={label}
      rules={
        required ? [{ required: true, message: `请选择${label}` }] : undefined
      }
    >
      <DatePicker className="full-width" format="YYYY-MM-DD" />
    </Form.Item>
  );
  return (
    <AntModal
      open
      title={title}
      onCancel={onClose}
      footer={null}
      width={640}
      destroyOnHidden
      className="process-action-modal"
      wrapClassName="process-action-modal-wrap"
      styles={{ body: { display: "flex", minHeight: 0, overflow: "hidden" } }}
    >
      <Form
        form={form}
        className="form"
        layout="vertical"
        onKeyDown={handleFormKeyDown}
        onFinish={(values) => void submit(values)}
      >
        <div className="process-action-scroll-area">
          {mode === "self" ? (
            <>
              <Steps
                current={step}
                items={[{ title: "梳理事件" }, { title: "拆解行动" }]}
                className="process-steps"
              />
              {step === 0 ? (
                <div className="form-grid">
                  <Form.Item
                    className="full"
                    name="title"
                    label="事件标题"
                    rules={[{ required: true, message: "请输入事件标题" }]}
                  >
                    <Input autoFocus />
                  </Form.Item>
                  <Form.Item className="full" name="target" label="事件目标">
                    <Input.TextArea
                      placeholder="选填"
                      autoSize={{ minRows: 3, maxRows: 5 }}
                    />
                  </Form.Item>
                  <Form.Item className="full" name="deadline" label="截止日期">
                    <DatePicker className="full-width" format="YYYY-MM-DD" />
                  </Form.Item>
                  <Form.Item name="importance" label="重要程度">
                    <Select
                      options={[
                        { value: "1", label: "重要" },
                        { value: "0", label: "不重要" },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name="urgency" label="紧急程度">
                    <Select
                      options={[
                        { value: "1", label: "紧急" },
                        { value: "0", label: "不紧急" },
                      ]}
                    />
                  </Form.Item>
                </div>
              ) : (
                <div className="action-steps">
                  <Typography.Text type="secondary">
                    把事件拆成具体、可执行的行动，按回车键可快速添加。
                  </Typography.Text>
                  <div className="action-step-header">
                    <span className="action-step-header-title">行动标题 *</span>
                    <span className="action-step-header-date">
                      开始日期（选填）
                    </span>
                    <span className="action-step-header-duration">
                      预计耗时（选填）
                    </span>
                    <span />
                  </div>
                  {steps.map((item, index) => (
                    <div key={index} className="action-step-wrap">
                      <div
                        className="action-step-row"
                        data-action-step-index={index}
                      >
                        <span className="action-step-number">{index + 1}</span>
                        <Input
                          ref={(element) => {
                            actionTitleRefs.current[index] = element;
                          }}
                          className="action-step-title"
                          aria-label="行动标题"
                          value={item.title}
                          onChange={(e) =>
                            updateStep(index, "title", e.target.value)
                          }
                          placeholder="填写行动标题"
                        />
                        <DatePicker
                          className="action-step-date"
                          aria-label="开始日期"
                          value={
                            item.start_date ? dayjs(item.start_date) : null
                          }
                          format="YYYY-MM-DD"
                          onChange={(value) =>
                            updateStep(
                              index,
                              "start_date",
                              value?.format("YYYY-MM-DD") ?? "",
                            )
                          }
                        />
                        <Select
                          className="action-step-duration"
                          aria-label="预计耗时"
                          value={item.estimated_hours || undefined}
                          options={hours}
                          onChange={(value) =>
                            updateStep(index, "estimated_hours", value)
                          }
                          placeholder="选择耗时"
                        />
                        {steps.length > 1 && (
                          <Button
                            type="text"
                            danger
                            aria-label="删除行动"
                            icon={<Trash2 size={15} />}
                            onClick={() =>
                              setSteps((current) =>
                                current.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
                              )
                            }
                          />
                        )}
                      </div>
                      {validationError?.index === index && (
                        <Tag color="error">请填写行动标题。</Tag>
                      )}
                    </div>
                  ))}
                  <Button
                    type="dashed"
                    icon={<Plus size={14} />}
                    onClick={() =>
                      setSteps((current) => [
                        ...current,
                        {
                          title: "",
                          start_date: current[current.length - 1]?.start_date,
                          estimated_hours: 0,
                        },
                      ])
                    }
                  >
                    添加下一步行动
                  </Button>
                </div>
              )}
            </>
          ) : mode === "delegate" ? (
            <div className="form-grid">
              <Form.Item
                name="delegated_to"
                label="委托对象"
                rules={[{ required: true, message: "请输入委托对象" }]}
              >
                <Input />
              </Form.Item>
              {dateField("follow_up_date", "跟进日期", true)}
            </div>
          ) : mode === "delay" ? (
            <div className="form-grid">
              {dateField("delay_until", "重新处理日期")}
              <Form.Item className="full" name="delay_note" label="备注">
                <Input.TextArea autoSize={{ minRows: 3, maxRows: 5 }} />
              </Form.Item>
            </div>
          ) : (
            <Form.Item
              name="abandon_reason"
              label="放弃原因"
              rules={[{ required: true, message: "请输入放弃原因" }]}
            >
              <Input.TextArea autoFocus autoSize={{ minRows: 3, maxRows: 5 }} />
            </Form.Item>
          )}
        </div>
        <div className="form-footer">
          {mode === "self" && step === 0 && (
            <Checkbox
              checked={quickComplete}
              onChange={(event) => setQuickComplete(event.target.checked)}
            >
              2分钟小事直接完成
            </Checkbox>
          )}
          <div className="form-footer-actions">
            <Button
              onClick={
                step === 1 && mode === "self" ? () => setStep(0) : onClose
              }
            >
              {step === 1 && mode === "self" ? "上一步" : "取消"}
            </Button>
            <Button
              type="primary"
              danger={mode === "abandon"}
              htmlType="submit"
            >
              {mode === "self" ? (step === 0 ? "下一步" : "保存") : "确认"}
            </Button>
          </div>
        </div>
      </Form>
    </AntModal>
  );
}
