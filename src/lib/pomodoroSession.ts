export type PomodoroWindowMode = "main" | "floating";

export type PomodoroCompletion = {
  recordId: number;
  points: number;
  actionId?: number;
  completedAt: number;
};

const WINDOW_MODE_KEY = "lifeplan-pomodoro-window-mode";
const COMPLETION_KEY = "lifeplan-pomodoro-completion";
const REVIEW_REQUEST_KEY = "lifeplan-pomodoro-review-request";

export const getPomodoroWindowMode = (): PomodoroWindowMode =>
  localStorage.getItem(WINDOW_MODE_KEY) === "floating" ? "floating" : "main";

export const setPomodoroWindowMode = (mode: PomodoroWindowMode) => {
  localStorage.setItem(WINDOW_MODE_KEY, mode);
};

export const getPomodoroCompletion = (): PomodoroCompletion | null => {
  const raw = localStorage.getItem(COMPLETION_KEY);
  if (!raw) return null;
  try {
    const completion = JSON.parse(raw) as PomodoroCompletion;
    if (!Number.isFinite(completion.recordId) || !Number.isFinite(completion.points) || !Number.isFinite(completion.completedAt)) {
      return null;
    }
    return completion;
  } catch {
    return null;
  }
};

export const savePomodoroCompletion = (completion: PomodoroCompletion) => {
  localStorage.setItem(COMPLETION_KEY, JSON.stringify(completion));
};

export const clearPomodoroCompletion = () => {
  localStorage.removeItem(COMPLETION_KEY);
};
export const savePomodoroReviewRequest = (actionId?: number) => {
  localStorage.setItem(REVIEW_REQUEST_KEY, JSON.stringify({ actionId }));
};

export const consumePomodoroReviewRequest = (): { actionId?: number } | null => {
  const raw = localStorage.getItem(REVIEW_REQUEST_KEY);
  localStorage.removeItem(REVIEW_REQUEST_KEY);
  if (!raw) return null;
  try {
    const request = JSON.parse(raw) as { actionId?: number };
    return Number.isFinite(request.actionId) ? { actionId: request.actionId } : {};
  } catch {
    return null;
  }
};
