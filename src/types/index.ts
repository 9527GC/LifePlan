export type EventStatus = 0 | 1 | 2 | 3 | 4 | 5;
export type ActionStatus = 0 | 1 | 2;

export interface StartupNotice {
  kind: "backup_warning" | "migration_restored" | string;
  message: string;
}

export interface Event {
  id: number;
  title: string;
  status: EventStatus;
  delegated_to?: string;
  follow_up_date?: string;
  follow_up_note?: string;
  delay_until?: string;
  delay_note?: string;
  abandon_reason?: string;
  target?: string;
  deadline?: string;
  importance?: number;
  urgency?: number;
  action_count: number;
  pending_action_count: number;
  completed_action_count: number;
  is_quick_completed: number;
  created_at: number;
  updated_at: number;
}

export interface Action {
  id: number;
  event_id?: number | null;
  event_title?: string | null;
  delegated_to?: string;
  title: string;
  description?: string;
  estimated_hours: number;
  start_date?: string;
  deadline?: string;
  is_frog: number;
  importance: number;
  urgency: number;
  priority: number;
  status: ActionStatus;
  completed_at?: number;
  is_delegated_follow_up: number;
  cascade_abandoned: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface EventCompletionCheck {
  action_count: number;
  completed_count: number;
  abandoned_count: number;
  points_awarded: number;
}

export interface NewEvent { title: string }
export interface UpdateEvent {
  id: number;
  title: string;
  target?: string;
  deadline?: string;
  importance?: number;
  urgency?: number;
}

export interface ProcessEvent {
  event_id: number;
  decision: "self" | "delegate" | "delay" | "abandon";
  quick_complete?: boolean;
  title?: string;
  target?: string;
  start_date?: string;
  deadline?: string;
  importance?: number;
  urgency?: number;
  initial_action_title?: string;
  action_steps?: ProcessActionStep[];
  delegated_to?: string;
  follow_up_date?: string;
  delay_until?: string;
  delay_note?: string;
  abandon_reason?: string;
}

export interface ProcessActionStep {
  title: string;
  estimated_hours: number;
  start_date?: string;
}

export interface NewAction {
  event_id?: number;
  title: string;
  description?: string;
  estimated_hours: number;
  start_date?: string;
  deadline?: string;
  is_frog: number;
  importance: number;
  urgency: number;
}
export type UpdateAction = Omit<NewAction, "event_id"> & { id: number };
export interface ReorderEventActions { event_id: number; action_ids: number[] }

export type RecurringFrequencyUnit = "daily" | "weekly" | "monthly";
export interface RecurringAction {
  id: number;
  title: string;
  estimated_hours: number;
  is_frog: number;
  importance: number;
  urgency: number;
  priority: number;
  frequency_unit: RecurringFrequencyUnit;
  frequency_count: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
}
export interface NewRecurringAction {
  title: string;
  estimated_hours: number;
  is_frog: number;
  importance: number;
  urgency: number;
  frequency_unit: RecurringFrequencyUnit;
  frequency_count: number;
}
export type UpdateRecurringAction = NewRecurringAction & { id: number };
export interface ReorderRecurringActions { action_ids: number[] }

export interface DailyListItem { id: number; action_id: number; list_date: string; sort_order: number; action: Action }
export interface AddDailyListItem { action_id: number; list_date: string }
export interface ReorderDailyList { list_date: string; action_ids: number[] }

export interface DailyScheduleSlot {
  id: number;
  list_date: string;
  start_time: string;
  end_time: string;
  action_id?: number;
  action?: Action;
  actual_notes?: string;
  met_expectation?: 0 | 1;
  focused?: 0 | 1;
  sort_order: number;
}
export interface DailySchedule { list_date: string; slots: DailyScheduleSlot[] }
export interface NewDailySlot { list_date: string; start_time: string; end_time: string }
export interface UpdateDailySlot { id: number; start_time: string; end_time: string }
export interface UpdateDailySlotReview { id: number; actual_notes: string; met_expectation: 0 | 1; focused: 0 | 1 }
export interface DailyTemplateSlot { start_time: string; end_time: string; sort_order: number }


export interface PomodoroRecord {
  id: number;
  action_id?: number;
  action_title?: string;
  start_time: number;
  end_time?: number;
  planned_seconds: number;
  actual_seconds?: number;
  status: -1 | 0 | 1 | 2;
  interrupt_type?: 0 | 1 | 2;
  interrupt_reason?: string;
  points_awarded: number;
}
export interface PomodoroStatus { active?: PomodoroRecord; total_points: number }
export interface Reward { id: number; name: string; description?: string; points_required: number; category: string; icon: string; status: 0 | 1; created_at: number; updated_at: number }
export interface NewReward { name: string; description?: string; points_required: number; category: string; icon: string }
export type UpdateReward = NewReward & { id: number };
export interface RewardExchange { id: number; reward_id: number; reward_name: string; points_used: number; exchanged_at: number; checkin?: RewardCheckinBrief | null }
export interface RewardCheckinBrief { description?: string | null; created_at: number; updated_at: number }
export interface RewardCheckin { exchange_id: number; reward_name: string; icon: string; points_used: number; exchanged_at: number; description?: string | null; image_base64?: string | null; created_at: number; updated_at: number }
export interface RewardsOverview { total_points: number; rewards: Reward[]; exchanges: RewardExchange[] }
