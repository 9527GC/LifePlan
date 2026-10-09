import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Card, Empty, Form, Input, Modal, Pagination, Select, Space, Tag, Tooltip, Typography, message } from "antd";
import { Gift, PanelTopClose, Play, TimerReset } from "lucide-react";
import { actionsApi, dailyScheduleApi, pomodoroApi } from "@/lib/api";
import type { Action, PomodoroRecord, PomodoroStatus } from "@/types";
import { userFacingError } from "@/lib/errors";
import { track } from "@/lib/analytics";
import { isPomodoroFloatingWindowOpen, openPomodoroFloatingWindow, setFloatingPomodoroMode, showMainWindow } from "@/lib/pomodoroWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listenPomodoroChanged, notifyPomodoroChanged } from "@/lib/pomodoroSync";
import { clearPomodoroCompletion, consumePomodoroReviewRequest, getPomodoroCompletion, getPomodoroWindowMode, savePomodoroCompletion, setPomodoroWindowMode } from "@/lib/pomodoroSession";

type PomodoroPhase = "work" | "rest";
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
const WORK_SECONDS = 25 * 60;
const REST_SECONDS = 5 * 60;
const BLOCK_SECONDS = WORK_SECONDS + REST_SECONDS;
const durations = [1, 2, 3, 4, 5, 6].map((rounds) => ({
  value: rounds * BLOCK_SECONDS,
  label: `${rounds * 30}分钟(休息${rounds}次)`,
}));

const formatSeconds = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
const durationLabel = (seconds: number) => durations.find((item) => item.value === seconds)?.label ?? `${Math.round(seconds / 60)}分钟`;
const statusText = (status: number) => status === 1 ? "已完成" : status === 0 ? "已放弃" : status === 2 ? "已中断" : "进行中";
const localDate = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; };
type PomodoroPrefill = { actionId?: number; plannedSeconds?: number; requestedAt?: number };

const consumePomodoroPrefill = (): PomodoroPrefill | null => {
  const raw = sessionStorage.getItem("lifeplan-pomodoro-prefill");
  if (!raw) return null;
  sessionStorage.removeItem("lifeplan-pomodoro-prefill");
  try {
    const prefill = JSON.parse(raw) as PomodoroPrefill;
    return {
      actionId: Number.isFinite(prefill.actionId) ? prefill.actionId : undefined,
      plannedSeconds: Number.isFinite(prefill.plannedSeconds) ? prefill.plannedSeconds : undefined,
      requestedAt: Number.isFinite(prefill.requestedAt) ? prefill.requestedAt : Date.now(),
    };
  } catch {
    return null;
  }
};

const getStoredCompletionResult = () => {
  const completion = getPomodoroCompletion();
  return completion ? { points: completion.points, actionId: completion.actionId } : null;
};

const withPomodoroRequestTimeout = async <T,>(request: Promise<T>, action: string): Promise<T> => {
  let timer: number | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(`${action}超时，请重试`)), 8000);
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
};

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
  const [prefill] = useState(consumePomodoroPrefill);
  const prefillRequestedAtRef = useRef(prefill?.requestedAt ?? 0);
  const [status, setStatus] = useState<PomodoroStatus>({ total_points: 0 });
  const [records, setRecords] = useState<PomodoroRecord[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [selectedAction, setSelectedAction] = useState<number | undefined>(prefill?.actionId);
  const [plannedSeconds, setPlannedSeconds] = useState(prefill?.plannedSeconds ?? BLOCK_SECONDS);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [interruptOpen, setInterruptOpen] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [completionResult, setCompletionResult] = useState<{ points: number; actionId?: number } | null>(() => {
    if (prefill) {
      // 从行动发起新的番茄钟时，常规窗口必须直接进入该行动的待开始状态。
      clearPomodoroCompletion();
      return null;
    }
    return getStoredCompletionResult();
  });
  const [reviewNavigating, setReviewNavigating] = useState(false);
  const [windowMode, setWindowMode] = useState(getPomodoroWindowMode);
  const [windowModeReady, setWindowModeReady] = useState(false);
  const [recordsPage, setRecordsPage] = useState(1);
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const finishingRef = useRef(false);
  const floatingSwitchingRef = useRef(false);
  const loadRevisionRef = useRef(0);
  const awardedBlocksRef = useRef({ recordId: 0, blocks: 0, awarding: false });
  const recordsPageSize = 10;

  const active = status.active;
  const activeElapsed = active ? Math.max(0, Math.floor((Date.now() - active.start_time) / 1000)) : 0;
  const phaseInfo = getPhaseInfo(active?.planned_seconds ?? plannedSeconds, active ? Math.max(elapsedSeconds, activeElapsed) : 0);
  const progress = active ? Math.max(0, Math.min(100, (phaseInfo.remaining / phaseInfo.total) * 100)) : 0;
  const historyRecords = records.filter((item) => item.status !== 0);
  const visibleRecords = historyRecords.slice((recordsPage - 1) * recordsPageSize, recordsPage * recordsPageSize);

  const finish = async (finishStatus: 0 | 1 | 2, interruptType?: 0 | 1 | 2, reason?: string): Promise<boolean> => {
    if (finishStatus === 1) prepareCompletionSound();
    if (!active || finishingRef.current) return false;
    const elapsedAtFinish = Math.max(elapsedSeconds, Math.floor((Date.now() - active.start_time) / 1000));
    const plannedBlocks = Math.max(1, Math.floor(active.planned_seconds / BLOCK_SECONDS));
    const completionBlocks = Math.min(plannedBlocks, Math.max(1, Math.ceil(Math.min(elapsedAtFinish, active.planned_seconds) / BLOCK_SECONDS)));
    finishingRef.current = true;
    try {
      const next = await withPomodoroRequestTimeout(
        pomodoroApi.finish(active.id, finishStatus, interruptType, reason),
        finishStatus === 2 ? "中断番茄钟" : "结束番茄钟",
      );
      // 作废中断前已发出的状态读取，避免它在新专注启动后写回旧的空闲状态。
      loadRevisionRef.current += 1;
      setStatus(next);
      setElapsedSeconds(0);
      setError("");
      // 计时状态已经落库，无需等待记录列表刷新；否则列表请求异常会让“中断”看似一直卡住。
      void pomodoroApi.records().then(setRecords).catch(() => undefined);
      if (finishStatus === 1) {
        const completion = { recordId: active.id, points: completionBlocks, actionId: active.action_id ?? undefined, completedAt: Date.now() };
        savePomodoroCompletion(completion);
        playCompletionSound();
        setPlannedSeconds(BLOCK_SECONDS);
        setCompletionResult({ points: completion.points, actionId: completion.actionId });
        notifyPomodoroChanged({ type: "completed", completion });
      } else {
        notifyPomodoroChanged();
      }
      return true;
    } catch (cause) {
      // 中断请求可能和另一窗口的状态同步同时发生；失败时重新读取服务端状态，
      // 防止页面仍显示“可开始”，实际却留有进行中的番茄钟。
      await syncPomodoroState();
      setError(userFacingError(cause));
      return false;
    } finally {
      finishingRef.current = false;
    }
  };

  const load = async (showLoading = true) => {
    const revision = ++loadRevisionRef.current;
    if (showLoading) setLoading(true);
    try {
      const [next, nextRecords, nextActions, todaySchedule] = await Promise.all([
        pomodoroApi.status(),
        pomodoroApi.records(),
        actionsApi.list(),
        dailyScheduleApi.get(localDate()),
      ]);
      if (revision !== loadRevisionRef.current) return;
      const scheduledActionIds = new Set(todaySchedule.slots.flatMap((slot) => slot.action_id ? [slot.action_id] : []));
      const nextElapsed = next.active ? Math.max(0, Math.floor((Date.now() - next.active.start_time) / 1000)) : 0;
      setStatus(next);
      setRecords(nextRecords);
      setActions(nextActions.filter((item) => scheduledActionIds.has(item.id)));
      setElapsedSeconds(nextElapsed);
      // 从复盘页返回时，组件会重新挂载；优先用已持久化的完成结果恢复成功页，
      // 避免异步加载状态完成前把番茄钟误展示为默认状态。
      setCompletionResult(next.active ? null : getStoredCompletionResult());
      setError("");
    } catch (cause) {
      if (revision === loadRevisionRef.current) setError(userFacingError(cause));
    } finally {
      if (showLoading && revision === loadRevisionRef.current) setLoading(false);
    }
  };

  const syncPomodoroState = async () => {
    const revision = ++loadRevisionRef.current;
    try {
      const [next, nextRecords] = await Promise.all([pomodoroApi.status(), pomodoroApi.records()]);
      if (revision !== loadRevisionRef.current) return;
      setStatus(next);
      setRecords(nextRecords);
      setElapsedSeconds(next.active ? Math.max(0, Math.floor((Date.now() - next.active.start_time) / 1000)) : 0);
      setCompletionResult(next.active ? null : getStoredCompletionResult());
    } catch {
      // 保留触发请求的原始错误，避免同步失败覆盖更有帮助的错误提示。
    }
  };

  const reconcileWindowMode = async () => {
    let nextMode = getPomodoroWindowMode();
    if (nextMode === "floating" && !await isPomodoroFloatingWindowOpen()) {
      // 窗口模式属于当前进程的运行时状态。应用重启或悬浮窗异常销毁后，
      // localStorage 可能仍保留 floating，此时必须让常规窗口重新接管计时结算。
      nextMode = "main";
      setPomodoroWindowMode(nextMode);
    }
    setWindowMode(nextMode);
    setWindowModeReady(true);
  };

  useEffect(() => {
    let disposed = false;
    const initialize = async () => {
      try {
        await reconcileWindowMode();
      } catch {
        // 无法确认悬浮窗存在时采用主窗口兜底，避免番茄钟到期后无人结算。
        setPomodoroWindowMode("main");
        if (!disposed) setWindowMode("main");
      } finally {
        if (!disposed) {
          setWindowModeReady(true);
          void load();
        }
      }
    };
    void initialize();
    return () => { disposed = true; };
  }, []);
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
    const resetFloatingCompletion = () => {
      // 悬浮窗口跳转复盘时，主窗口仍可能保留 completed 事件写入的内存状态。
      // 同时清除内存和持久化结果，确保回到番茄钟时显示默认状态。
      clearPomodoroCompletion();
      setCompletionResult(null);
    };
    const openReview = (actionId?: number) => {
      consumePomodoroReviewRequest();
      resetFloatingCompletion();
      navigate("/daily-list", actionId ? { state: { reviewActionId: actionId } } : undefined);
    };
    const consumeReviewRequest = () => {
      const request = consumePomodoroReviewRequest();
      if (!request) return;
      resetFloatingCompletion();
      navigate("/daily-list", request.actionId ? { state: { reviewActionId: request.actionId } } : undefined);
    };
    const handleFocus = () => {
      consumeReviewRequest();
      void reconcileWindowMode();
      void syncPomodoroState();
    };
    let unlisten: (() => void) | undefined;
    window.addEventListener("focus", handleFocus);
    void listenPomodoroChanged((message) => {
      if (message.type === "window-mode") setWindowMode(message.mode);
      if (message.type === "completed" && message.completion.completedAt >= prefillRequestedAtRef.current) {
        setCompletionResult({ points: message.completion.points, actionId: message.completion.actionId });
      }
      if (message.type === "open-review") openReview(message.actionId);
      if (message.type !== "open-review") void load();
    }).then((cleanup) => { unlisten = cleanup; });
    return () => {
      window.removeEventListener("focus", handleFocus);
      unlisten?.();
    };
  }, [navigate]);

  useEffect(() => {
    if (!active) {
      awardedBlocksRef.current = { recordId: 0, blocks: 0, awarding: false };
      return;
    }
    awardedBlocksRef.current = windowMode === "main"
      ? { recordId: active.id, blocks: active.points_awarded, awarding: false }
      : { recordId: 0, blocks: 0, awarding: false };
    const timer = window.setInterval(() => {
      const nextElapsed = Math.max(0, Math.floor((Date.now() - active.start_time) / 1000));
      // 两个 Webview 都需要重绘倒计时；仅当前计时主窗口负责完成和积分结算，避免重复请求。
      setElapsedSeconds(nextElapsed);
      if (!windowModeReady || windowMode !== "main") return;
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
          notifyPomodoroChanged();
          if (addedPoints > 0) {
            message.info({ content: `完成 ${addedPoints} 个30分钟专注，获得 ${addedPoints} 积分`, duration: 2 });
          }
        })
        .catch((cause) => setError(userFacingError(cause)))
        .finally(() => { awardedBlocksRef.current.awarding = false; });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [active?.id, active?.start_time, active?.planned_seconds, windowMode, windowModeReady]);

  const goToReview = async () => {
    if (reviewNavigating) return;
    setReviewNavigating(true);
    try {
      const actionId = completionResult?.actionId;
      // 进入复盘即结束当前成功页；返回番茄钟时应重新显示可开始的默认状态。
      clearPomodoroCompletion();
      setCompletionResult(null);
      navigate("/daily-list", actionId ? { state: { reviewActionId: actionId } } : undefined);
    } finally {
      setReviewNavigating(false);
    }
  };

  const beginFocus = async (seconds: number, actionId?: number) => {
    if (starting) return;
    prepareCompletionSound();
    setStarting(true);
    try {
      const next = await withPomodoroRequestTimeout(pomodoroApi.start(actionId, seconds), "启动番茄钟");
      loadRevisionRef.current += 1;
      clearPomodoroCompletion();
      setCompletionResult(null);
      setStatus((current) => ({ ...current, active: next }));
      setElapsedSeconds(0);
      setError("");
      notifyPomodoroChanged();
      track("启动番茄钟", { planned_seconds: seconds, has_action: actionId !== undefined });
    } catch (cause) {
      // 后端拒绝启动通常意味着另一窗口仍有活动计时；立即同步，让页面回到真实状态而非看似卡住。
      await syncPomodoroState();
      setError(userFacingError(cause));
    } finally {
      setStarting(false);
    }
  };

  const configureNewFocus = () => {
    clearPomodoroCompletion();
    setSelectedAction(undefined);
    setCompletionResult(null);
    setPlannedSeconds(BLOCK_SECONDS);
    setElapsedSeconds(0);
    notifyPomodoroChanged();
  };

  const start = async () => {
    await beginFocus(plannedSeconds, selectedAction);
  };

  const submitInterrupt = async (values: { interruptType: number; reason?: string }) => {
    // 先关闭弹窗和遮罩。即使原生命令异常未返回，也不能让透明遮罩拦截整页按钮。
    setInterruptOpen(false);
    form.resetFields();
    setInterrupting(true);
    try {
      await finish(2, Number(values.interruptType) as 0 | 1 | 2, values.reason);
    } finally {
      setInterrupting(false);
    }
  };

  const stateText = !active ? "准备开始" : phaseInfo.phase === "work" ? active.action_title || "自由专注" : "休息 5 分钟";
  const historyDuration = (seconds: number) => durationLabel(seconds);

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
    </header>
    {error && <Alert className="page-alert" type="error" showIcon message={error} closable onClose={() => setError("")} />}
    {loading ? <div className="card empty">正在加载…</div> : <div className="pomodoro-grid">
      <Card className="pomodoro-card" bordered={false}>
        {active && <Tooltip title="打开悬浮置顶番茄钟">
          <Button type="text" className="pomodoro-floating-toggle" aria-label="打开悬浮置顶番茄钟" icon={<PanelTopClose size={18} />} onClick={() => void (async () => {
            if (floatingSwitchingRef.current) return;
            floatingSwitchingRef.current = true;
            setPomodoroWindowMode("floating");
            setWindowMode("floating");
            notifyPomodoroChanged({ type: "window-mode", mode: "floating" });
            let openedFloatingWindow: Awaited<ReturnType<typeof openPomodoroFloatingWindow>>;
            try {
              openedFloatingWindow = await openPomodoroFloatingWindow();
              if (!openedFloatingWindow) throw new Error("无法打开悬浮番茄钟");
              // 原生窗口创建成功后立即隐藏主窗口，不让按钮 loading 状态暴露在切换过程中。
              // 悬浮窗口仍保持隐藏，直到其自行完成几何恢复并发出 ready 事件。
              await getCurrentWindow().hide();
              await setFloatingPomodoroMode(true);
              await openedFloatingWindow.waitUntilReady();
              await openedFloatingWindow.window.show();
              await openedFloatingWindow.window.setFocus();
            } catch (cause) {
              // 首次创建但未能完成初始化时，清理隐藏的窗口，避免下次打开复用失效实例。
              if (openedFloatingWindow?.isNew) await openedFloatingWindow.window.close().catch(() => undefined);
              setPomodoroWindowMode("main");
              setWindowMode("main");
              notifyPomodoroChanged({ type: "window-mode", mode: "main" });
              // 主窗口可能已隐藏；失败时必须恢复，避免应用处于没有可见窗口的状态。
              await showMainWindow().catch(() => undefined);
              setError(userFacingError(cause));
            } finally {
              floatingSwitchingRef.current = false;
            }
          })()} />
        </Tooltip>}
        {completionResult ? <div className="pomodoro-completion" role="status">
          <div className="pomodoro-completion-icon" aria-hidden="true">🎉</div>
          <Typography.Title level={3}>恭喜完成专注</Typography.Title>
          <Typography.Paragraph>本次获得 <strong>{completionResult.points}</strong> 积分</Typography.Paragraph>
          <div className="pomodoro-completion-actions">
            <Button size="middle" loading={reviewNavigating} onClick={() => void goToReview()}>去复盘</Button>
            <Button type="primary" size="middle" disabled={starting} onClick={configureNewFocus}>设置新专注</Button>
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
            <Button className="pomodoro-start-button" type="primary" size="large" icon={<Play size={17} />} loading={starting} disabled={starting} onClick={() => void start()}>开始专注</Button>
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
    {interruptOpen && <Modal title="记录番茄中断" open destroyOnHidden onCancel={() => { setInterruptOpen(false); form.resetFields(); }} okText="保存" cancelText="取消" confirmLoading={interrupting} onOk={() => void form.submit()}><Form form={form} layout="vertical" onFinish={(values) => void submitInterrupt(values)}><Form.Item name="interruptType" label="打断类型" initialValue={0} rules={[{ required: true }]}><Select options={[{ value: 0, label: "内部分心" }, { value: 1, label: "外部干扰" }, { value: 2, label: "紧急事务" }]} /></Form.Item><Form.Item name="reason" label="打断原因"><Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} /></Form.Item></Form></Modal>}
  </div>;
}
