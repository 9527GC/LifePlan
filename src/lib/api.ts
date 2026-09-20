import { invoke } from "@tauri-apps/api/core";
import type { Action, EventCompletionCheck, RewardCheckin, AddDailyListItem, DailyListItem, DailySchedule, DailyScheduleSlot, DailyTemplateSlot, Event, NewAction, NewEvent, NewDailySlot, NewRecurringAction, ProcessEvent, Project, RecurringAction, ReorderDailyList, ReorderProjectActions, ReorderRecurringActions, StartupNotice, UpdateAction, UpdateDailySlot, UpdateDailySlotReview, UpdateEvent, UpdateProject, PomodoroRecord, PomodoroStatus, NewReward, Reward, RewardsOverview, UpdateReward, UpdateRecurringAction } from "@/types";

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
  saveTextFile: (filename: string, content: string) => invokeCommand<string>("save_download_text_file", { filename, content }),
};

export const eventsApi = {
  list: () => invokeCommand<Event[]>("get_events"),
  create: (payload: NewEvent) => invokeCommand<Event>("create_event", { payload }),
  update: (payload: UpdateEvent) => invokeCommand<Event>("update_event", { payload }),
  process: (payload: ProcessEvent) => invokeCommand<void>("process_event", { payload }),
  complete: (eventId: number) => invokeCommand<EventCompletionCheck>("complete_event", { event_id: eventId }),
  restore: (eventId: number) => invokeCommand<void>("restore_event", { event_id: eventId }),
  delete: (id: number) => invokeCommand<void>("delete_event", { id }),
};

export const projectsApi = {
  list: () => invokeCommand<Project[]>("get_projects"),
  update: (payload: UpdateProject) => invokeCommand<Project>("update_project", { payload }),
  complete: (id: number) => invokeCommand<number>("complete_project", { id }),
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

export const recurringActionsApi = {
  list: () => invokeCommand<RecurringAction[]>("get_recurring_actions"),
  create: (payload: NewRecurringAction) => invokeCommand<RecurringAction>("create_recurring_action", { payload }),
  update: (payload: UpdateRecurringAction) => invokeCommand<RecurringAction>("update_recurring_action", { payload }),
  reorder: (payload: ReorderRecurringActions) => invokeCommand<RecurringAction[]>("reorder_recurring_actions", { payload }),
  instantiate: (recurringActionId: number) => invokeCommand<Action>("create_action_from_recurring", { recurringActionId }),
};

export const dailyListApi = {
  list: (listDate: string) => invokeCommand<DailyListItem[]>("get_daily_list", { listDate }),
  add: (payload: AddDailyListItem) => invokeCommand<DailyListItem[]>("add_daily_list_item", { payload }),
  remove: (listDate: string, actionId: number) => invokeCommand<DailyListItem[]>("remove_daily_list_item", { listDate, actionId }),
  reorder: (payload: ReorderDailyList) => invokeCommand<DailyListItem[]>("reorder_daily_list", { payload }),
};

export const dailyScheduleApi = {
  get: (listDate: string) => invokeCommand<DailySchedule>("get_daily_schedule", { listDate }),
  initialize: (listDate: string) => invokeCommand<DailySchedule>("initialize_daily_schedule", { listDate }),
  createSlot: (payload: NewDailySlot) => invokeCommand<DailyScheduleSlot>("create_daily_slot", { payload }),
  updateSlot: (payload: UpdateDailySlot) => invokeCommand<DailyScheduleSlot>("update_daily_slot", { payload }),
  deleteSlot: (listDate: string, slotId: number) => invokeCommand<void>("delete_daily_slot", { listDate, slotId }),
  splitSlot: (listDate: string, slotId: number) => invokeCommand<DailyScheduleSlot[]>("split_daily_slot", { listDate, slotId }),
  assignAction: (slotId: number, actionId?: number) => invokeCommand<DailyScheduleSlot>("assign_daily_slot_action", { slotId, actionId: actionId ?? null }),
  updateReview: (payload: UpdateDailySlotReview) => invokeCommand<DailyScheduleSlot>("update_daily_slot_review", { payload }),
  template: () => invokeCommand<DailyTemplateSlot[]>("get_daily_template"),
  saveTemplate: (slots: DailyTemplateSlot[]) => invokeCommand<DailyTemplateSlot[]>("save_daily_template", { slots }),
};


export const pomodoroApi = {
  status: () => invokeCommand<PomodoroStatus>("get_pomodoro_status"),
  start: (actionId: number | undefined, plannedSeconds: number) => invokeCommand<PomodoroRecord>("start_pomodoro", { actionId: actionId ?? null, plannedSeconds }),
  finish: (recordId: number, status: 0 | 1 | 2, interruptType?: 0 | 1 | 2, interruptReason?: string) => invokeCommand<PomodoroStatus>("finish_pomodoro", { recordId, status, interruptType: interruptType ?? null, interruptReason: interruptReason || null }),
  award: (recordId: number) => invokeCommand<PomodoroStatus>("award_pomodoro_points", { recordId }),
  records: (limit = 20) => invokeCommand<PomodoroRecord[]>("get_pomodoro_records", { limit }),
};

export const rewardsApi = {
  overview: () => invokeCommand<RewardsOverview>("get_rewards_overview"),
  create: (payload: NewReward) => invokeCommand<Reward>("create_reward", { payload }),
  update: (payload: UpdateReward) => invokeCommand<Reward>("update_reward", { payload }),
  archive: (id: number) => invokeCommand<void>("archive_reward", { id }),
  exchange: (rewardId: number) => invokeCommand<RewardsOverview>("exchange_reward", { rewardId }),
  saveCheckin: (payload: { exchangeId: number; imageBase64?: string | null; description?: string | null }) => invokeCommand<void>("save_reward_checkin", { exchangeId: payload.exchangeId, imageBase64: payload.imageBase64 ?? null, description: payload.description ?? null }),
  getCheckin: (exchangeId: number) => invokeCommand<RewardCheckin>("get_reward_checkin", { exchangeId }),
  savePoster: (imageBase64: string) => invokeCommand<string>("save_reward_poster", { imageBase64 }),
};
