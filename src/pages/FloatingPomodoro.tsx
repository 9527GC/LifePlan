import { useEffect, useRef, useState } from "react";
import { Alert, Button, Tooltip } from "antd";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow, availableMonitors, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { PanelTopClose } from "lucide-react";
import { pomodoroApi } from "@/lib/api";
import type { PomodoroRecord, PomodoroStatus } from "@/types";
import { userFacingError } from "@/lib/errors";
import { getPhaseInfo, formatSeconds } from "@/lib/pomodoroPresentation";
import { loadFloatingWindowGeometry, saveFloatingWindowGeometry } from "@/lib/windowPreferences";
import { listenPomodoroChanged, notifyPomodoroChanged } from "@/lib/pomodoroSync";
import { POMODORO_FLOATING_WINDOW_READY_EVENT, showMainWindow } from "@/lib/pomodoroWindow";
import { clearPomodoroCompletion, getPomodoroCompletion, savePomodoroCompletion, savePomodoroReviewRequest, setPomodoroWindowMode } from "@/lib/pomodoroSession";

const MIN_WIDTH = 260;
const MIN_HEIGHT = 280;
const GEOMETRY_SAVE_DELAY = 180;

export default function FloatingPomodoro() {
  const [status, setStatus] = useState<PomodoroStatus>({ total_points: 0 });
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState("");
  const [completionResult, setCompletionResult] = useState<{ points: number; actionId?: number } | null>(null);
  // 悬浮 Webview 创建时可能错过创建前发出的窗口模式事件，因此它默认接管计时结算。
  const [windowMode, setWindowMode] = useState<"main" | "floating">("floating");
  const previousActiveRef = useRef<PomodoroRecord | undefined>(undefined);
  const hasLoadedRef = useRef(false);
  const finishingRef = useRef(false);
  const pendingSizeRef = useRef<PhysicalSize | undefined>(undefined);
  const pendingPositionRef = useRef<PhysicalPosition | undefined>(undefined);
  const saveTimerRef = useRef<number | undefined>(undefined);

  const active = status.active;
  const activeElapsed = active ? Math.max(0, Math.floor((Date.now() - active.start_time) / 1000)) : 0;
  const phaseInfo = getPhaseInfo(active?.planned_seconds ?? 0, active ? Math.max(elapsedSeconds, activeElapsed) : 0);
  const progress = active && phaseInfo.total > 0 ? Math.max(0, Math.min(100, (phaseInfo.remaining / phaseInfo.total) * 100)) : 0;

  const load = async () => {
    try {
      const next = await pomodoroApi.status();
      const previousActive = previousActiveRef.current;
      if (!next.active) {
        const completion = getPomodoroCompletion();
        if (completion) {
          setCompletionResult({ points: completion.points, actionId: completion.actionId });
        } else if (hasLoadedRef.current && previousActive) {
          const records = await pomodoroApi.records(20);
          const finishedRecord = records.find((item) => item.id === previousActive.id);
          if (finishedRecord?.status === 1) {
            setCompletionResult({ points: finishedRecord.points_awarded, actionId: finishedRecord.action_id ?? undefined });
          }
        }
      }
      previousActiveRef.current = next.active;
      hasLoadedRef.current = true;
      if (next.active) setCompletionResult(null);
      setStatus(next);
      setElapsedSeconds(next.active ? Math.max(0, Math.floor((Date.now() - next.active.start_time) / 1000)) : 0);
      setError("");
    } catch (cause) {
      setError(userFacingError(cause));
    }
  };

  useEffect(() => { void load(); }, []);

  const finishActivePomodoro = async () => {
    if (!active || finishingRef.current) return;
    finishingRef.current = true;
    try {
      const next = await pomodoroApi.finish(active.id, 1);
      const records = await pomodoroApi.records(20);
      const finishedRecord = records.find((item) => item.id === active.id);
      setStatus(next);
      setElapsedSeconds(0);
      previousActiveRef.current = undefined;
      const completion = {
        recordId: active.id,
        points: finishedRecord?.points_awarded ?? Math.max(1, Math.ceil(active.planned_seconds / 1800)),
        actionId: active.action_id ?? undefined,
        completedAt: Date.now(),
      };
      savePomodoroCompletion(completion);
      setCompletionResult({ points: completion.points, actionId: completion.actionId });
      notifyPomodoroChanged({ type: "completed", completion });
    } catch (cause) {
      // 即使发生竞态，也优先读取已经由另一个窗口写入的完成结果，避免悬浮窗停在 00:00。
      const completion = getPomodoroCompletion();
      if (completion) {
        setCompletionResult({ points: completion.points, actionId: completion.actionId });
        void load();
      } else {
        setError(userFacingError(cause));
      }
    } finally {
      finishingRef.current = false;
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!active) return;
      const nextElapsed = Math.max(0, Math.floor((Date.now() - active.start_time) / 1000));
      // 悬浮窗和常规窗口同时显示时，两边都持续刷新；仅悬浮窗接管时才完成计时。
      setElapsedSeconds(nextElapsed);
      if (windowMode === "floating" && nextElapsed >= active.planned_seconds) void finishActivePomodoro();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [active?.id, active?.start_time, active?.planned_seconds, windowMode]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const handleFocus = () => void load();
    window.addEventListener("focus", handleFocus);
    void listenPomodoroChanged((message) => {
      if (message.type === "window-mode") setWindowMode(message.mode);
      if (message.type === "completed") setCompletionResult({ points: message.completion.points, actionId: message.completion.actionId });
      if (message.type !== "open-review") void load();
    }).then((cleanup) => { unlisten = cleanup; });
    return () => {
      window.removeEventListener("focus", handleFocus);
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlistenResize: (() => void) | undefined;
    let unlistenMove: (() => void) | undefined;

    const flushGeometry = async () => {
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = undefined;
      }
      const size = pendingSizeRef.current ?? await appWindow.innerSize();
      const position = pendingPositionRef.current ?? await appWindow.outerPosition();
      pendingSizeRef.current = undefined;
      pendingPositionRef.current = undefined;
      if (!disposed) saveFloatingWindowGeometry({ width: size.width, height: size.height, x: position.x, y: position.y });
    };

    const scheduleSave = () => {
      if (saveTimerRef.current !== undefined) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => void flushGeometry(), GEOMETRY_SAVE_DELAY);
    };

    const restore = async () => {
      try {
        const saved = loadFloatingWindowGeometry();
        if (saved) {
          const scaleFactor = await appWindow.scaleFactor();
          const size = {
            width: Math.max(Math.ceil(MIN_WIDTH * scaleFactor), saved.width),
            height: Math.max(Math.ceil(MIN_HEIGHT * scaleFactor), saved.height),
          };
          await appWindow.setSize(new PhysicalSize(size.width, size.height));
          const monitors = await availableMonitors();
          const visible = monitors.some((monitor) => {
            const left = Math.max(saved.x, monitor.position.x);
            const top = Math.max(saved.y, monitor.position.y);
            const right = Math.min(saved.x + size.width, monitor.position.x + monitor.size.width);
            const bottom = Math.min(saved.y + size.height, monitor.position.y + monitor.size.height);
            return right - left >= 80 && bottom - top >= 80;
          });
          if (visible) await appWindow.setPosition(new PhysicalPosition(saved.x, saved.y));
          else await appWindow.center();
        }
      } catch (cause) {
        // 窗口位置恢复失败不应阻止窗口显示，否则主窗口会一直等待就绪事件直至超时。
        setError(userFacingError(cause));
      }
      if (disposed) return;

      // 无论尺寸/位置恢复是否可用，都必须先通知主窗口。监听窗口移动和缩放只是偏好保存，
      // 不能参与“悬浮窗口已可显示”的关键路径。
      await emitTo("main", POMODORO_FLOATING_WINDOW_READY_EVENT).catch((cause) => {
        setError(userFacingError(cause));
      });
      if (disposed) return;

      unlistenResize = await appWindow.onResized(({ payload }) => { pendingSizeRef.current = payload; scheduleSave(); }).catch(() => undefined);
      unlistenMove = await appWindow.onMoved(({ payload }) => { pendingPositionRef.current = payload; scheduleSave(); }).catch(() => undefined);
    };

    void restore();
    return () => {
      disposed = true;
      void flushGeometry();
      unlistenResize?.();
      unlistenMove?.();
    };
  }, []);

  const closeFloatingWindow = async () => {
    try {
      setPomodoroWindowMode("main");
      notifyPomodoroChanged({ type: "window-mode", mode: "main" });
      await showMainWindow();
      await getCurrentWindow().close();
    } catch (cause) {
      setError(userFacingError(cause));
    }
  };

  const goToReview = async () => {
    savePomodoroReviewRequest(completionResult?.actionId);
    // 悬浮窗口结束本轮专注并跳转复盘后，回到常规番茄钟应进入可重新开始的默认状态。
    clearPomodoroCompletion();
    notifyPomodoroChanged({ type: "open-review", actionId: completionResult?.actionId });
    await closeFloatingWindow();
  };

  const startNewFocus = async () => {
    try {
      const next = await pomodoroApi.start(undefined, 1800);
      clearPomodoroCompletion();
      setCompletionResult(null);
      setStatus((current) => ({ ...current, active: next }));
      setElapsedSeconds(0);
      notifyPomodoroChanged();
    } catch (cause) {
      setError(userFacingError(cause));
    }
  };

  return <main className="pomodoro-floating-window">
    <div
      className="pomodoro-floating-drag-handle"
      data-tauri-drag-region="true"
      onMouseDown={(event) => {
        if (event.button === 0) {
          event.preventDefault();
          void getCurrentWindow().startDragging();
        }
      }}
      role="button"
      tabIndex={-1}
      aria-label="拖动番茄钟窗口"
    >
      <span className="pomodoro-drag-dots"><i /><i /><i /><i /><i /><i /></span>
    </div>
    <header className="pomodoro-floating-titlebar">
      <div className="pomodoro-floating-window-actions">
        <Tooltip title="关闭悬浮番茄钟">
          <Button type="text" size="small" aria-label="关闭悬浮番茄钟" icon={<PanelTopClose size={18} />} onClick={() => void closeFloatingWindow()} />
        </Tooltip>
      </div>
    </header>
    {error && <Alert className="pomodoro-floating-error" type="error" showIcon message={error} closable onClose={() => setError("")} />}
    <section className="pomodoro-floating-content">
      {completionResult ? <div className="pomodoro-floating-completion" role="status">
        <div className="pomodoro-floating-completion-icon" aria-hidden="true">🎉</div>
        <strong>恭喜完成专注</strong>
        <span>本次获得 {completionResult.points} 积分</span>
        <div className="pomodoro-floating-completion-actions">
          <Button size="middle" onClick={() => void goToReview()}>去复盘</Button>
          <Button type="primary" size="middle" onClick={() => void startNewFocus()}>继续专注</Button>
        </div>
      </div> : active ? <>
        <div className={`pomodoro-ring pomodoro-ring-${phaseInfo.phase}`} style={{ "--pomodoro-progress": `${progress}%` } as React.CSSProperties}>
          <div className="pomodoro-time">{formatSeconds(phaseInfo.remaining)}</div>
          <div
            className={`pomodoro-floating-action pomodoro-floating-action-in-ring${phaseInfo.phase === "rest" ? " pomodoro-floating-rest-label" : ""}`}
            title={phaseInfo.phase === "rest" ? "休息 5 分钟" : active.action_title || "自由专注"}
          >
            {phaseInfo.phase === "rest" ? "休息 5 分钟" : active.action_title || "自由专注"}
          </div>
          <div className="pomodoro-phase-meta">第 {phaseInfo.round} 次专注 · 共 {phaseInfo.rounds} 次</div>
        </div>

      </> : <div className="pomodoro-floating-empty">当前没有进行中的番茄钟</div>}
    </section>
  </main>;
}
