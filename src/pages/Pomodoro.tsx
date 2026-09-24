import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Card, Empty, Form, Input, Modal, Pagination, Select, Space, Tag, Tooltip, Typography, message } from "antd";
import { getCurrentWindow, LogicalSize, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { Gift, PanelTopClose, PanelTopOpen, Play, TimerReset } from "lucide-react";
import { actionsApi, dailyScheduleApi, pomodoroApi } from "@/lib/api";
import type { Action, PomodoroRecord, PomodoroStatus } from "@/types";
import { userFacingError } from "@/lib/errors";
import { track } from "@/lib/analytics";
import { loadFloatingPosition, loadFloatingSize, saveFloatingMode, saveFloatingPosition, saveFloatingSize } from "@/lib/windowPreferences";

type PomodoroPhase = "work" | "rest";
type WindowSnapshot = { size: PhysicalSize; position: PhysicalPosition };
type TauriRuntimeWindow = Window & { __TAURI_INTERNALS__?: unknown };
type AudioRuntimeWindow = Window & { webkitAudioContext?: typeof AudioContext };

let completionAudioContext: AudioContext | null = null;

const getCompletionAudioContext = () => {
  if (typeof window === "undefined") return null;
  const AudioContextClass = window.AudioContext ?? (window as AudioRuntimeWindow).webkitAudioContext;
  if (!AudioContextClass) return null;
  completionAudioContext ??= new AudioContextClass();
  return completionAudioContext;
};

const prepareCompletionSound = () => {
  const context = getCompletionAudioContext();
  if (context) void context.resume().catch(() => undefined);
};

const playCompletionSound = () => {
  const context = getCompletionAudioContext();
  if (!context) return;

  const play = () => {
    const master = context.createGain();
    const startTime = context.currentTime;
    master.gain.setValueAtTime(0.0001, startTime);
    master.gain.exponentialRampToValueAtTime(0.35, startTime + 0.08);
    master.gain.exponentialRampToValueAtTime(0.0001, startTime + 3);
    master.connect(context.destination);

    const notes = [
      { frequency: 523.25, start: 0, duration: 0.65 },
      { frequency: 659.25, start: 0.22, duration: 0.65 },
      { frequency: 783.99, start: 0.44, duration: 0.8 },
      { frequency: 1046.5, start: 0.78, duration: 1.1 },
      { frequency: 783.99, start: 1.35, duration: 0.75 },
      { frequency: 1046.5, start: 1.7, duration: 1.2 },
    ];

    notes.forEach(({ frequency, start, duration }) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const noteStart = startTime + start;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, noteStart);
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(0.28, noteStart + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + duration);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + duration + 0.05);
    });
  };

  if (context.state === "suspended") {
    void context.resume().then(play).catch(() => undefined);
  } else {
    play();
  }
};
const isTauriRuntime = () => typeof window !== "undefined" && Boolean((window as TauriRuntimeWindow).__TAURI_INTERNALS__);
const WORK_SECONDS = 25 * 60;
const REST_SECONDS = 5 * 60;
const BLOCK_SECONDS = WORK_SECONDS + REST_SECONDS;
const FLOATING_SIZE_SAVE_DELAY = 180;
const durations = [1, 2, 3, 4, 5, 6].map((rounds) => ({
  value: rounds * BLOCK_SECONDS,
  label: `${rounds * 30}分钟(休息${rounds}次)`,
}));

const formatSeconds = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
const durationLabel = (seconds: number) => durations.find((item) => item.value === seconds)?.label ?? `${Math.round(seconds / 60)}分钟`;
const statusText = (status: number) => status === 1 ? "已完成" : status === 0 ? "已放弃" : status === 2 ? "已中断" : "进行中";
const localDate = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; };

const getPhaseInfo = (plannedSeconds: number, elapsedSeconds: number) => {
  const elapsed = Math.max(0, Math.min(plannedSeconds, elapsedSeconds));
  const isScheduledSession = plannedSeconds >= BLOCK_SECONDS && plannedSeconds % BLOCK_SECONDS === 0;
  if (!isScheduledSession) {
    return {
      phase: "work" as PomodoroPhase,
      remaining: Math.max(0, plannedSeconds - elapsed),
      total: plannedSeconds,
      round: 1,
      rounds: 1,
    };
  }

  const cycleElapsed = elapsed % BLOCK_SECONDS;
  const isRest = cycleElapsed >= WORK_SECONDS;
  const total = isRest ? REST_SECONDS : WORK_SECONDS;
  const phaseElapsed = isRest ? cycleElapsed - WORK_SECONDS : cycleElapsed;
  return {
    phase: isRest ? "rest" as PomodoroPhase : "work" as PomodoroPhase,
    remaining: Math.max(0, total - phaseElapsed),
    total,
    round: Math.min(Math.floor(elapsed / BLOCK_SECONDS) + 1, plannedSeconds / BLOCK_SECONDS),
    rounds: plannedSeconds / BLOCK_SECONDS,
  };
};

export default function Pomodoro() {
  const [status, setStatus] = useState<PomodoroStatus>({ total_points: 0 });
  const [records, setRecords] = useState<PomodoroRecord[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [selectedAction, setSelectedAction] = useState<number>();
  const [plannedSeconds, setPlannedSeconds] = useState(BLOCK_SECONDS);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [interruptOpen, setInterruptOpen] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [completionResult, setCompletionResult] = useState<{ points: number; actionId?: number } | null>(null);
  const [isFloating, setIsFloating] = useState(false);
  const [floatingBusy, setFloatingBusy] = useState(false);
  const [reviewNavigating, setReviewNavigating] = useState(false);
  const [form] = Form.useForm();
  const [recordsPage, setRecordsPage] = useState(1);
  const navigate = useNavigate();
  const finishingRef = useRef(false);
  const floatingRef = useRef(false);
  const floatingSnapshotRef = useRef<WindowSnapshot | null>(null);
  const floatingScaleFactorRef = useRef(1);
  const pendingFloatingSizeRef = useRef<PhysicalSize | null>(null);
  const floatingSizeSaveTimerRef = useRef<number | null>(null);
  const awardedBlocksRef = useRef({ recordId: 0, blocks: 0, awarding: false });
  const recordsPageSize = 10;

  const active = status.active;
  const activeElapsed = active ? Math.max(0, Math.floor((Date.now() - active.start_time) / 1000)) : 0;
  const phaseInfo = getPhaseInfo(active?.planned_seconds ?? plannedSeconds, active ? Math.max(elapsedSeconds, activeElapsed) : 0);
  const progress = active ? Math.max(0, Math.min(100, (phaseInfo.remaining / phaseInfo.total) * 100)) : 0;
  const historyRecords = records.filter((item) => item.status !== 0);
  const visibleRecords = historyRecords.slice((recordsPage - 1) * recordsPageSize, recordsPage * recordsPageSize);

  const setFloatingUi = (next: boolean) => {
    floatingRef.current = next;
    setIsFloating(next);
  };

  const flushFloatingSize = () => {
    if (floatingSizeSaveTimerRef.current !== null) {
      window.clearTimeout(floatingSizeSaveTimerRef.current);
      floatingSizeSaveTimerRef.current = null;
    }
    const size = pendingFloatingSizeRef.current;
    pendingFloatingSizeRef.current = null;
    if (!size) return;
    saveFloatingSize({
      width: Math.round(size.width / floatingScaleFactorRef.current),
      height: Math.round(size.height / floatingScaleFactorRef.current),
    });
  };

  const scheduleFloatingSizeSave = (size: PhysicalSize) => {
    pendingFloatingSizeRef.current = size;
    if (floatingSizeSaveTimerRef.current !== null) window.clearTimeout(floatingSizeSaveTimerRef.current);
    // 调整窗口时会高频触发事件，只在停下后写入最终尺寸，避免阻塞原生拖拽。
    floatingSizeSaveTimerRef.current = window.setTimeout(flushFloatingSize, FLOATING_SIZE_SAVE_DELAY);
  };

  const restoreNativeWindow = async (updateUi = true) => {
    // 退出前写入最终尺寸；随后关闭悬浮状态，避免恢复过程的移动事件覆盖悬浮位置。
    flushFloatingSize();
    floatingRef.current = false;
    saveFloatingMode(false);
    if (isTauriRuntime()) {
      const appWindow = getCurrentWindow();
      const snapshot = floatingSnapshotRef.current;
      await appWindow.setAlwaysOnTop(false);
      await appWindow.setMaxSize(null);
      await appWindow.setMinSize(new LogicalSize(1050, 650));
      // 窗口始终使用自研标题栏，退出悬浮模式时不能恢复系统标题栏。
      await appWindow.setDecorations(false);
      await appWindow.setResizable(true);
      if (snapshot) {
        await appWindow.setSize(new PhysicalSize(snapshot.size.width, snapshot.size.height));
        await appWindow.setPosition(new PhysicalPosition(snapshot.position.x, snapshot.position.y));
      }
      await appWindow.setFocus();
    }
    floatingSnapshotRef.current = null;
    if (updateUi) setFloatingUi(false);
  };

  const enterFloatingMode = async () => {
    saveFloatingMode(true);
    if (isTauriRuntime()) {
      const appWindow = getCurrentWindow();
      const [size, position, scaleFactor] = await Promise.all([appWindow.innerSize(), appWindow.outerPosition(), appWindow.scaleFactor()]);
      floatingSnapshotRef.current = { size, position };
      floatingScaleFactorRef.current = scaleFactor;
      await appWindow.setMinSize(new LogicalSize(240, 240));
      await appWindow.setMaxSize(new LogicalSize(320, 320));
      await appWindow.setResizable(true);
      await appWindow.setDecorations(false);
      const savedSize = loadFloatingSize();
      const width = savedSize ? Math.max(240, Math.min(320, savedSize.width)) : 320;
      const height = savedSize ? Math.max(240, Math.min(320, savedSize.height)) : 320;
      await appWindow.setSize(new LogicalSize(width, height));
      const savedPosition = loadFloatingPosition();
      if (savedPosition) await appWindow.setPosition(new PhysicalPosition(savedPosition.x, savedPosition.y));
      await appWindow.setAlwaysOnTop(true);
      await appWindow.setFocus();
    }
    setFloatingUi(true);
  };

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const appWindow = getCurrentWindow();
    let unlistenMove: (() => void) | undefined;
    let unlistenResize: (() => void) | undefined;
    let unlistenScaleChanged: (() => void) | undefined;
    void appWindow.onMoved(({ payload }) => {
      if (floatingRef.current) saveFloatingPosition({ x: payload.x, y: payload.y });
    }).then((cleanup) => { unlistenMove = cleanup; });
    void appWindow.onResized(({ payload }) => {
      if (floatingRef.current) scheduleFloatingSizeSave(payload);
    }).then((cleanup) => { unlistenResize = cleanup; });
    void appWindow.onScaleChanged(({ payload }) => {
      floatingScaleFactorRef.current = payload.scaleFactor;
      if (floatingRef.current) scheduleFloatingSizeSave(payload.size);
    }).then((cleanup) => { unlistenScaleChanged = cleanup; });
    return () => {
      flushFloatingSize();
      unlistenMove?.();
      unlistenResize?.();
      unlistenScaleChanged?.();
    };
  }, []);
  const toggleFloatingMode = async () => {
    if (floatingBusy) return;
    setFloatingBusy(true);
    try {
      if (floatingRef.current) {
        await restoreNativeWindow();
      } else {
        await enterFloatingMode();
      }
    } catch (cause) {
      if (!floatingRef.current && floatingSnapshotRef.current) {
        await restoreNativeWindow(false).catch(() => undefined);
      }
      setError(userFacingError(cause));
    } finally {
      setFloatingBusy(false);
    }
  };

  const finish = async (finishStatus: 0 | 1 | 2, interruptType?: 0 | 1 | 2, reason?: string) => {
    if (finishStatus === 1) prepareCompletionSound();
    if (!active || finishingRef.current) return;
    const elapsedAtFinish = Math.max(elapsedSeconds, Math.floor((Date.now() - active.start_time) / 1000));
    const plannedBlocks = Math.max(1, Math.floor(active.planned_seconds / BLOCK_SECONDS));
    const completionBlocks = Math.min(plannedBlocks, Math.max(1, Math.ceil(Math.min(elapsedAtFinish, active.planned_seconds) / BLOCK_SECONDS)));
    finishingRef.current = true;
    try {
      const next = await pomodoroApi.finish(active.id, finishStatus, interruptType, reason);
      setStatus(next);
      setRecords(await pomodoroApi.records());
      setElapsedSeconds(0);
      if (finishStatus === 1) {
        playCompletionSound();
        setPlannedSeconds(BLOCK_SECONDS);
        setCompletionResult({ points: completionBlocks, actionId: active.action_id });
      }
    } catch (cause) {
      setError(userFacingError(cause));
    } finally {
      finishingRef.current = false;
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const [next, nextRecords, nextActions, todaySchedule] = await Promise.all([
        pomodoroApi.status(),
        pomodoroApi.records(),
        actionsApi.list(),
        dailyScheduleApi.get(localDate()),
      ]);
      const scheduledActionIds = new Set(todaySchedule.slots.flatMap((slot) => slot.action_id ? [slot.action_id] : []));
      const nextElapsed = next.active ? Math.max(0, Math.floor((Date.now() - next.active.start_time) / 1000)) : 0;
      setStatus(next);
      setRecords(nextRecords);
      setActions(nextActions.filter((item) => scheduledActionIds.has(item.id)));
      setElapsedSeconds(nextElapsed);
      setError("");
    } catch (cause) {
      setError(userFacingError(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const raw = sessionStorage.getItem("lifeplan-pomodoro-prefill");
    if (!raw) return;
    sessionStorage.removeItem("lifeplan-pomodoro-prefill");
    try {
      const prefill = JSON.parse(raw) as { actionId?: number; plannedSeconds?: number };
      if (prefill.actionId) setSelectedAction(prefill.actionId);
      if (prefill.plannedSeconds) setPlannedSeconds(prefill.plannedSeconds);
    } catch { /* 忽略无效的临时预设 */ }
  }, []);
  useEffect(() => {
    document.body.classList.toggle("pomodoro-floating-mode", isFloating);
    return () => document.body.classList.remove("pomodoro-floating-mode");
  }, [isFloating]);
  useEffect(() => () => {
    if (floatingRef.current) void restoreNativeWindow(false).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!active) {
      awardedBlocksRef.current = { recordId: 0, blocks: 0, awarding: false };
      return;
    }
    awardedBlocksRef.current = { recordId: active.id, blocks: active.points_awarded, awarding: false };
    const timer = window.setInterval(() => {
      const nextElapsed = Math.max(0, Math.floor((Date.now() - active.start_time) / 1000));
      setElapsedSeconds(nextElapsed);
      if (nextElapsed >= active.planned_seconds) {
        void finish(1);
        return;
      }
      const completedBlocks = Math.floor(nextElapsed / BLOCK_SECONDS);
      const awardState = awardedBlocksRef.current;
      if (completedBlocks <= awardState.blocks || awardState.awarding) return;
      awardState.awarding = true;
      void pomodoroApi.award(active.id)
        .then(async (next) => {
          const previousBlocks = awardState.blocks;
          const nextBlocks = next.active?.points_awarded ?? completedBlocks;
          const addedPoints = Math.max(0, nextBlocks - previousBlocks);
          awardedBlocksRef.current.blocks = nextBlocks;
          setStatus(next);
          setRecords(await pomodoroApi.records());
          if (addedPoints > 0 && !floatingRef.current) {
            message.info({ content: `完成 ${addedPoints} 个30分钟专注，获得 ${addedPoints} 积分`, duration: 2 });
          }
        })
        .catch((cause) => setError(userFacingError(cause)))
        .finally(() => { awardedBlocksRef.current.awarding = false; });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [active?.id, active?.start_time]);

  const goToReview = async () => {
    if (reviewNavigating) return;
    setReviewNavigating(true);
    try {
      const wasFloating = floatingRef.current || Boolean(floatingSnapshotRef.current);
      if (wasFloating) {
        // 先立即移除悬浮模式样式，再等待原生窗口恢复，避免路由切换时页面仍按小窗口布局渲染。
        setFloatingUi(false);
        await restoreNativeWindow();
        // 即使悬浮前的尺寸快照异常，也要在跳转前强制恢复到正常窗口尺寸。
        if (isTauriRuntime()) {
          const appWindow = getCurrentWindow();
          await appWindow.setSize(new LogicalSize(1000, 650));
          await appWindow.setFocus();
        }
        // 确保 Tauri 完成窗口尺寸/位置更新后再渲染今日事页面。
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }
      const actionId = completionResult?.actionId;
      navigate("/daily-list", actionId ? { state: { reviewActionId: actionId } } : undefined);
    } finally {
      setReviewNavigating(false);
    }
  };

  const startNewFocus = async () => {
    prepareCompletionSound();
    setCompletionResult(null);
    setPlannedSeconds(BLOCK_SECONDS);
    setElapsedSeconds(0);
    try {
      const next = await pomodoroApi.start(selectedAction, BLOCK_SECONDS);
      setStatus((current) => ({ ...current, active: next })); track("启动番茄钟", { planned_seconds: BLOCK_SECONDS, has_action: selectedAction !== undefined });
    } catch (cause) {
      setError(userFacingError(cause));
    }
  };

  const start = async () => {
    prepareCompletionSound();
    try {
      const next = await pomodoroApi.start(selectedAction, plannedSeconds);
      setStatus((current) => ({ ...current, active: next })); track("启动番茄钟", { planned_seconds: BLOCK_SECONDS, has_action: selectedAction !== undefined });
      setElapsedSeconds(0);
    } catch (cause) {
      setError(userFacingError(cause));
    }
  };

  const submitInterrupt = async (values: { interruptType: number; reason?: string }) => {
    setInterrupting(true);
    try {
      await finish(2, Number(values.interruptType) as 0 | 1 | 2, values.reason);
      setInterruptOpen(false);
      form.resetFields();
    } finally {
      setInterrupting(false);
    }
  };

  const stateText = !active ? "准备开始" : phaseInfo.phase === "work" ? "工作专注" : "休息 5 分钟";
  const historyDuration = (seconds: number) => durationLabel(seconds);
  const FloatingIcon = isFloating ? PanelTopOpen : PanelTopClose;

  return <div className="page pomodoro-page">
    <header className="page-header pomodoro-page-header">
      <div>
        <Typography.Title level={2} className="page-title">番茄钟</Typography.Title>
        <Typography.Paragraph className="page-subtitle">用一段不被打扰的专注，换取可见的进步。</Typography.Paragraph>
      </div>
      <div className="pomodoro-header-actions">
        <div
          className="rewards-balance pomodoro-rewards-link"
          role="button"
          tabIndex={0}
          aria-label="查看积分汇总"
          onClick={() => navigate("/rewards")}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              navigate("/rewards");
            }
          }}
        >
          <Gift size={20} />{status.total_points}<span>积分</span>
        </div>
      </div>
      {isFloating && <div className="pomodoro-drag-handle" data-tauri-drag-region="true" onMouseDown={(event) => { if (event.button === 0) { event.preventDefault(); void getCurrentWindow().startDragging(); } }} role="button" tabIndex={-1} aria-label="拖动窗口"><span className="pomodoro-drag-dots"><i /><i /><i /><i /><i /><i /></span></div>}
    </header>
    {isFloating && <div className="pomodoro-resize-layer" aria-hidden="true">
      {(['North', 'South', 'East', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest'] as const).map((direction) => <div key={direction} className={`pomodoro-resize-handle pomodoro-resize-${direction.toLowerCase()}`} onPointerDown={(event) => { if (event.isPrimary && event.button === 0) { event.preventDefault(); event.stopPropagation(); void getCurrentWindow().startResizeDragging(direction); } }} />)}
    </div>}
    {error && <Alert className="page-alert" type="error" showIcon message={error} closable onClose={() => setError("")} />}
    {loading ? <div className="card empty">正在加载…</div> : <div className="pomodoro-grid">
      <Card className="pomodoro-card" bordered={false}>
        {active && <Tooltip title={isFloating ? "展开全部" : "悬浮置顶"}>
          <Button type="text" className="pomodoro-floating-toggle" aria-label={isFloating ? "展开全部" : "悬浮置顶"} loading={floatingBusy} icon={<FloatingIcon size={18} />} onClick={() => void toggleFloatingMode()} />
        </Tooltip>}
        {completionResult ? <div className="pomodoro-completion" role="status">
          <div className="pomodoro-completion-icon" aria-hidden="true">🎉</div>
          <Typography.Title level={3}>恭喜你完成了 {completionResult.points} 个专注</Typography.Title>
          <Typography.Paragraph>坚持到底，本次获得了 <strong>{completionResult.points}</strong> 积分</Typography.Paragraph>
          <div className="pomodoro-completion-actions">
            <Button size="large" loading={reviewNavigating} onClick={() => void goToReview()}>去复盘</Button>
            <Button type="primary" size="large" icon={<Play size={17} />} onClick={() => void startNewFocus()}>开启新专注</Button>
          </div>
        </div> : <>
          <div className={`pomodoro-ring pomodoro-ring-${phaseInfo.phase}`} style={{ "--pomodoro-progress": `${progress}%` } as React.CSSProperties}>
            <div className="pomodoro-time">{formatSeconds(active ? phaseInfo.remaining : WORK_SECONDS)}</div>
            <div className="pomodoro-state">{stateText}</div>
            {active && <div className="pomodoro-phase-meta">第 {phaseInfo.round} 次工作 · 共 {phaseInfo.rounds} 次</div>}
          </div>
          {!active ? <div className="pomodoro-controls">
            <div className="pomodoro-control-field"><span className="pomodoro-control-label">专注行动</span><Select size="large" className="full-width" placeholder="关联今日行动（可选）" allowClear value={selectedAction} onChange={setSelectedAction} options={actions.map((item) => ({ value: item.id, label: item.title }))} /></div>
            <div className="pomodoro-control-field"><span className="pomodoro-control-label">专注时长</span><Select size="large" className="full-width" value={plannedSeconds} onChange={(value) => { setPlannedSeconds(value); setElapsedSeconds(0); }} options={durations} /></div>
            <Button className="pomodoro-start-button" type="primary" size="large" icon={<Play size={17} />} onClick={() => void start()}>开始专注</Button>
          </div> : <>
            <Space className="pomodoro-active-controls" size="middle"><Button type="primary" size="large" icon={<Play size={16} />} onClick={() => void finish(1)}>立即完成</Button><Button size="large" danger icon={<TimerReset size={16} />} onClick={() => setInterruptOpen(true)}>放弃并中断</Button></Space>
          </>}
          <div className="pomodoro-tip">{active ? `本次${durationLabel(active.planned_seconds)}，每轮工作 25 分钟后休息 5 分钟。` : `完成一次${durationLabel(plannedSeconds)}，可获得 1 积分。`}</div>
        </>}
      </Card>
      <Card title="专注记录" bordered={false} className="pomodoro-history">
        <div className="pomodoro-history-list">{historyRecords.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有番茄记录" /> : visibleRecords.map((item) => <div className="pomodoro-history-item" key={item.id}><div><Typography.Text strong>{item.action_title || "自由专注"}</Typography.Text><div className="pomodoro-history-meta">{new Date(item.start_time).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} · {historyDuration(item.planned_seconds)}</div></div><Space><Tag color={item.status === 1 ? "green" : item.status === 2 ? "orange" : "blue"}>{statusText(item.status)}</Tag>{item.points_awarded > 0 && <Tag color="gold">+{item.points_awarded} 分</Tag>}</Space></div>)}</div>
        {historyRecords.length > recordsPageSize && <Pagination size="small" current={recordsPage} pageSize={recordsPageSize} total={historyRecords.length} showSizeChanger={false} onChange={setRecordsPage} />}
      </Card>
    </div>}
    <Modal title="记录番茄中断" open={interruptOpen} onCancel={() => setInterruptOpen(false)} okText="保存" cancelText="取消" confirmLoading={interrupting} onOk={() => void form.submit()}><Form form={form} layout="vertical" onFinish={(values) => void submitInterrupt(values)}><Form.Item name="interruptType" label="打断类型" initialValue={0} rules={[{ required: true }]}><Select options={[{ value: 0, label: "内部分心" }, { value: 1, label: "外部干扰" }, { value: 2, label: "紧急事务" }]} /></Form.Item><Form.Item name="reason" label="打断原因"><Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} /></Form.Item></Form></Modal>
  </div>;
}






