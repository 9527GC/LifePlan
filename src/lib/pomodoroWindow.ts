import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

type TauriRuntimeWindow = Window & { __TAURI_INTERNALS__?: unknown };

type OpenFloatingPomodoroWindowResult = {
  window: WebviewWindow;
  isNew: boolean;
  waitUntilReady: () => Promise<void>;
};

export const POMODORO_FLOATING_WINDOW_LABEL = "pomodoro-floating";
export const POMODORO_CHANGED_EVENT = "lifeplan:pomodoro-changed";
export const POMODORO_FLOATING_WINDOW_READY_EVENT = "lifeplan:pomodoro-floating-window-ready";
export const POMODORO_FLOATING_WINDOW_DEFAULT_SIZE = { width: 280, height: 300 } as const;
export const POMODORO_FLOATING_WINDOW_MIN_SIZE = { width: 220, height: 240 } as const;

export const isTauriRuntime = () => typeof window !== "undefined" && Boolean((window as TauriRuntimeWindow).__TAURI_INTERNALS__);

export const setFloatingPomodoroMode = async (enabled: boolean) => {
  if (!isTauriRuntime()) return;
  await invoke("set_floating_pomodoro_mode", { enabled });
};

export const isPomodoroFloatingWindowOpen = async () => {
  if (!isTauriRuntime()) return false;
  return Boolean(await WebviewWindow.getByLabel(POMODORO_FLOATING_WINDOW_LABEL));
};

export const openPomodoroFloatingWindow = async (): Promise<OpenFloatingPomodoroWindowResult | undefined> => {
  if (!isTauriRuntime()) return undefined;

  const existing = await WebviewWindow.getByLabel(POMODORO_FLOATING_WINDOW_LABEL);
  if (existing) {
    if (await existing.isMinimized()) await existing.unminimize();
    await existing.setSkipTaskbar(true);
    return {
      window: existing,
      isNew: false,
      waitUntilReady: async () => undefined,
    };
  }

  let unlistenReady: UnlistenFn | undefined;
  let settleReady: (() => void) | undefined;
  let rejectReady: ((reason?: unknown) => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    settleReady = resolve;
    rejectReady = reject;
  });

  // 先订阅再创建窗口，避免悬浮窗口完成初始化后主窗口错过就绪通知。
  unlistenReady = await listen(POMODORO_FLOATING_WINDOW_READY_EVENT, () => settleReady?.());

  try {
    await new Promise<void>((resolve, reject) => {
      // 使用当前主窗口的来源，兼容开发模式与打包后的 Tauri 资源协议。
      const floatingUrl = new URL("/#/pomodoro-floating", window.location.href).toString();
      const popup = new WebviewWindow(POMODORO_FLOATING_WINDOW_LABEL, {
        url: floatingUrl,
        title: "番茄钟",
        width: POMODORO_FLOATING_WINDOW_DEFAULT_SIZE.width,
        height: POMODORO_FLOATING_WINDOW_DEFAULT_SIZE.height,
        minWidth: POMODORO_FLOATING_WINDOW_MIN_SIZE.width,
        minHeight: POMODORO_FLOATING_WINDOW_MIN_SIZE.height,
        resizable: true,
        decorations: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        // 先保持不可见，等待悬浮窗口恢复上次的尺寸和位置后再显示，
        // 避免 Windows 先在默认位置绘制一帧、再跳转到已保存位置造成明显闪烁。
        visible: false,
      });
      void popup.once("tauri://created", () => resolve());
      void popup.once("tauri://error", (event) => reject(event.payload));
    });
  } catch (cause) {
    unlistenReady();
    rejectReady?.(cause);
    throw cause;
  }

  const floatingWindow = (await WebviewWindow.getByLabel(POMODORO_FLOATING_WINDOW_LABEL)) ?? undefined;
  if (!floatingWindow) {
    unlistenReady();
    rejectReady?.(new Error("无法获取已创建的悬浮番茄钟"));
    return undefined;
  }
  await floatingWindow.setSkipTaskbar(true);

  return {
    window: floatingWindow,
    isNew: true,
    waitUntilReady: async () => {
      const timeoutId = window.setTimeout(() => rejectReady?.(new Error("悬浮番茄钟初始化超时")), 8000);
      try {
        await ready;
      } finally {
        window.clearTimeout(timeoutId);
        unlistenReady?.();
      }
    },
  };
};

export const showMainWindow = async () => {
  if (!isTauriRuntime()) return;
  const main = await WebviewWindow.getByLabel("main");
  if (!main) return;
  if (await main.isMinimized()) await main.unminimize();
  await setFloatingPomodoroMode(false);
  await main.show();
  await main.setFocus();
};
