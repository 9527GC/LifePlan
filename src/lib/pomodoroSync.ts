import { emit, listen } from "@tauri-apps/api/event";
import { isTauriRuntime, POMODORO_CHANGED_EVENT } from "@/lib/pomodoroWindow";
import type { PomodoroCompletion, PomodoroWindowMode } from "@/lib/pomodoroSession";

export type PomodoroSyncMessage =
  | { type: "status-changed" }
  | { type: "window-mode"; mode: PomodoroWindowMode }
  | { type: "completed"; completion: PomodoroCompletion }
  | { type: "open-review"; actionId?: number };

export const notifyPomodoroChanged = async (message: PomodoroSyncMessage = { type: "status-changed" }) => {
  if (!isTauriRuntime()) return;
  await emit(POMODORO_CHANGED_EVENT, message).catch(() => undefined);
};

export const listenPomodoroChanged = (handler: (message: PomodoroSyncMessage) => void) => {
  if (!isTauriRuntime()) return Promise.resolve(() => undefined);
  return listen<PomodoroSyncMessage>(POMODORO_CHANGED_EVENT, ({ payload }) => handler(payload));
};