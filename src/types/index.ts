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
  project_id?: number;
  project_title?: string;
  action_count: number;
  pending_action_count: number;
  completed_action_count: number;
  created_at: number;
  updated_at: number;
}

export interface Project {
  id: number;
  event_id: number;
  event_title: string;
  title: string;
  target?: string;
  estimated_hours: number;
  start_date?: string;
  deadline?: string;
  importance: number;
  urgency: number;
  priority: number;
  status: 0 | 1 | 2;
  action_count: number;
  completed_action_count: number;
  pending_action_count: number;
  created_at: number;
  updated_at: number;
}

export interface Action {
  id: number;
  event_id?: number;
  project_id?: number;
  event_title?: string;
  project_title?: string;
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

export interface NewEvent { title: string }
export interface UpdateEvent { id: number; title: string }

export interface ProcessEvent {
  event_id: number;
  decision: "self" | "delegate" | "delay" | "abandon";
  project_title?: string;
  target?: string;
  start_date?: string;
  deadline?: string;
  importance?: number;
  urgency?: number;
  initial_action_title?: string;
  action_steps?: ProcessActionStep[];
  delegated_to?: string;
  follow_up_date?: string;
  follow_up_note?: string;
  action_title?: string;
  delay_until?: string;
  delay_note?: string;
  abandon_reason?: string;
}

export interface ProcessActionStep {
  title: string;
  estimated_hours: number;
  start_date?: string;
}

export interface UpdateProject {
  id: number;
  title: string;
  target?: string;
  start_date?: string;
  deadline?: string;
  importance: number;
  urgency: number;
}

export interface NewAction {
  event_id?: number;
  project_id?: number;
  title: string;
  description?: string;
  estimated_hours: number;
  start_date?: string;
  deadline?: string;
  is_frog: number;
  importance: number;
  urgency: number;
}
export type UpdateAction = Omit<NewAction, "event_id" | "project_id"> & { id: number };
export interface ReorderProjectActions { project_id: number; action_ids: number[] }
