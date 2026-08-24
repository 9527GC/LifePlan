import { invoke } from "@tauri-apps/api/core";
import type { Action, Event, NewAction, NewEvent, ProcessEvent, Project, ReorderProjectActions, StartupNotice, UpdateAction, UpdateEvent, UpdateProject } from "@/types";

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: {
    invoke?: unknown;
  };
};

const invokeCommand = <T>(command: string, args?: Record<string, unknown>) => {
  const tauriInvoke = (window as TauriWindow).__TAURI_INTERNALS__?.invoke;
  if (typeof tauriInvoke !== "function") {
    return Promise.reject(new Error("当前为浏览器测试环境，请启动桌面客户端后使用。"));
  }
  return invoke<T>(command, args);
};

export const systemApi = {
  startupNotice: () => invokeCommand<StartupNotice | null>("get_startup_notice"),
  retryStartupBackup: () => invokeCommand<void>("retry_startup_backup"),
};

export const eventsApi = {
  list: () => invokeCommand<Event[]>("get_events"),
  create: (payload: NewEvent) => invokeCommand<Event>("create_event", { payload }),
  update: (payload: UpdateEvent) => invokeCommand<Event>("update_event", { payload }),
  process: (payload: ProcessEvent) => invokeCommand<void>("process_event", { payload }),
  complete: (eventId: number) => invokeCommand<void>("complete_event", { event_id: eventId }),
  restore: (eventId: number) => invokeCommand<void>("restore_event", { event_id: eventId }),
  delete: (id: number) => invokeCommand<void>("delete_event", { id }),
};

export const projectsApi = {
  list: () => invokeCommand<Project[]>("get_projects"),
  update: (payload: UpdateProject) => invokeCommand<Project>("update_project", { payload }),
  complete: (id: number) => invokeCommand<void>("complete_project", { id }),
  abandon: (id: number, reason: string) => invokeCommand<void>("abandon_project", { id, reason }),
  delete: (id: number) => invokeCommand<void>("delete_project", { id }),
};

export const actionsApi = {
  list: () => invokeCommand<Action[]>("get_actions"),
  create: (payload: NewAction) => invokeCommand<Action>("create_action", { payload }),
  update: (payload: UpdateAction) => invokeCommand<Action>("update_action", { payload }),
  complete: (id: number) => invokeCommand<Action>("complete_action", { id }),
  restore: (id: number) => invokeCommand<Action>("restore_action", { id }),
  delete: (id: number) => invokeCommand<void>("delete_action", { id }),
  reorder: (payload: ReorderProjectActions) => invokeCommand<void>("reorder_project_actions", { payload }),
  resolveDelegated: (actionId: number, resolution: string, abandonReason?: string) => invokeCommand<void>("complete_delegated_follow_up", { payload: { action_id: actionId, resolution, abandon_reason: abandonReason } }),
};
