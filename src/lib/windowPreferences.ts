export type SavedWindowGeometry = { width: number; height: number; x: number; y: number };

const WINDOW_GEOMETRY_KEY = "lifeplan:window-geometry";
const FLOATING_WINDOW_GEOMETRY_KEY = "lifeplan:pomodoro-floating-window-geometry";

const read = <T,>(key: string): T | null => {
  if (typeof localStorage === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
};

const write = (key: string, value: unknown) => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 本地存储不可用时不影响窗口操作。
  }
};

export const loadWindowGeometry = () => read<SavedWindowGeometry>(WINDOW_GEOMETRY_KEY);
export const saveWindowGeometry = (geometry: SavedWindowGeometry) => write(WINDOW_GEOMETRY_KEY, geometry);

// 主窗口与悬浮番茄钟使用独立存储，避免任一窗口移动或缩放覆盖另一窗口的状态。
export const loadFloatingWindowGeometry = () => read<SavedWindowGeometry>(FLOATING_WINDOW_GEOMETRY_KEY);
export const saveFloatingWindowGeometry = (geometry: SavedWindowGeometry) => write(FLOATING_WINDOW_GEOMETRY_KEY, geometry);
