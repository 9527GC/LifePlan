export type SavedWindowGeometry = { width: number; height: number; x: number; y: number };
const WINDOW_GEOMETRY_KEY = "lifeplan:window-geometry";
const FLOATING_POSITION_KEY = "lifeplan:pomodoro-floating-position";
const FLOATING_SIZE_KEY = "lifeplan:pomodoro-floating-size";
const FLOATING_MODE_KEY = "lifeplan:pomodoro-floating-mode";
let floatingMode = false;
const read = <T,>(key: string): T | null => { if (typeof localStorage === "undefined") return null; try { return JSON.parse(localStorage.getItem(key) ?? "null") as T | null; } catch { return null; } };
const write = (key: string, value: unknown) => { if (typeof localStorage === "undefined") return; try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 本地存储不可用时不影响窗口操作 */ } };
export const loadWindowGeometry = () => read<SavedWindowGeometry>(WINDOW_GEOMETRY_KEY);
export const saveWindowGeometry = (geometry: SavedWindowGeometry) => write(WINDOW_GEOMETRY_KEY, geometry);
export const loadFloatingPosition = () => read<{ x: number; y: number }>(FLOATING_POSITION_KEY);
export const saveFloatingPosition = (position: { x: number; y: number }) => write(FLOATING_POSITION_KEY, position);
export const loadFloatingSize = () => read<{ width: number; height: number }>(FLOATING_SIZE_KEY);
export const saveFloatingSize = (size: { width: number; height: number }) => write(FLOATING_SIZE_KEY, size);
export const isFloatingModeSaved = () => floatingMode || read<boolean>(FLOATING_MODE_KEY) === true;
export const saveFloatingMode = (floating: boolean) => { floatingMode = floating; write(FLOATING_MODE_KEY, floating); };



