use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartupNotice {
    pub kind: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: i64,
    pub title: String,
    pub status: i32,
    pub delegated_to: Option<String>,
    pub follow_up_date: Option<String>,
    pub follow_up_note: Option<String>,
    pub delay_until: Option<String>,
    pub delay_note: Option<String>,
    pub abandon_reason: Option<String>,
    pub target: Option<String>,
    pub deadline: Option<String>,
    pub importance: Option<i32>,
    pub urgency: Option<i32>,
    pub action_count: i64,
    pub pending_action_count: i64,
    pub completed_action_count: i64,
    pub is_quick_completed: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewEvent {
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateEvent {
    pub id: i64,
    pub title: String,
    pub target: Option<String>,
    pub deadline: Option<String>,
    pub importance: Option<i32>,
    pub urgency: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessEvent {
    pub event_id: i64,
    pub decision: String,
    pub quick_complete: Option<bool>,
    pub title: Option<String>,
    pub target: Option<String>,
    pub start_date: Option<String>,
    pub deadline: Option<String>,
    pub importance: Option<i32>,
    pub urgency: Option<i32>,
    pub initial_action_title: Option<String>,
    pub action_steps: Option<Vec<ProcessActionStep>>,
    pub delegated_to: Option<String>,
    pub follow_up_date: Option<String>,
    pub delay_until: Option<String>,
    pub delay_note: Option<String>,
    pub abandon_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessActionStep {
    pub title: String,
    pub estimated_hours: f64,
    pub start_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventCompletionCheck {
    pub action_count: i64,
    pub completed_count: i64,
    pub abandoned_count: i64,
    pub points_awarded: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Action {
    pub id: i64,
    pub event_id: Option<i64>,
    pub event_title: Option<String>,
    pub delegated_to: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub estimated_hours: f64,
    pub start_date: Option<String>,
    pub deadline: Option<String>,
    pub is_frog: i32,
    pub importance: i32,
    pub urgency: i32,
    pub priority: i32,
    pub status: i32,
    pub completed_at: Option<i64>,
    pub is_delegated_follow_up: i32,
    pub cascade_abandoned: i32,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewAction {
    pub event_id: Option<i64>,
    pub title: String,
    pub description: Option<String>,
    pub estimated_hours: f64,
    pub start_date: Option<String>,
    pub deadline: Option<String>,
    pub is_frog: i32,
    pub importance: i32,
    pub urgency: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateAction {
    pub id: i64,
    pub title: String,
    pub description: Option<String>,
    pub estimated_hours: f64,
    pub start_date: Option<String>,
    pub deadline: Option<String>,
    pub is_frog: i32,
    pub importance: i32,
    pub urgency: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReorderEventActions {
    pub event_id: i64,
    pub action_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecurringAction {
    pub id: i64,
    pub title: String,
    pub estimated_hours: f64,
    pub is_frog: i32,
    pub importance: i32,
    pub urgency: i32,
    pub priority: i32,
    pub frequency_unit: String,
    pub frequency_count: i32,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewRecurringAction {
    pub title: String,
    pub estimated_hours: f64,
    pub is_frog: i32,
    pub importance: i32,
    pub urgency: i32,
    pub frequency_unit: String,
    pub frequency_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateRecurringAction {
    pub id: i64,
    pub title: String,
    pub estimated_hours: f64,
    pub is_frog: i32,
    pub importance: i32,
    pub urgency: i32,
    pub frequency_unit: String,
    pub frequency_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReorderRecurringActions {
    pub action_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyListItem {
    pub id: i64,
    pub action_id: i64,
    pub list_date: String,
    pub sort_order: i64,
    pub action: Action,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddDailyListItem {
    pub action_id: i64,
    pub list_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReorderDailyList {
    pub list_date: String,
    pub action_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyScheduleSlot {
    pub id: i64,
    pub list_date: String,
    pub start_time: String,
    pub end_time: String,
    pub action_id: Option<i64>,
    pub action: Option<Action>,
    pub actual_notes: Option<String>,
    pub met_expectation: Option<i32>,
    pub focused: Option<i32>,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailySchedule {
    pub list_date: String,
    pub slots: Vec<DailyScheduleSlot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewDailySlot {
    pub list_date: String,
    pub start_time: String,
    pub end_time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateDailySlot {
    pub id: i64,
    pub start_time: String,
    pub end_time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateDailySlotReview {
    pub id: i64,
    pub actual_notes: String,
    pub met_expectation: i32,
    pub focused: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyTemplateSlot {
    pub start_time: String,
    pub end_time: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DelegatedFollowUpResolution {
    pub action_id: i64,
    pub resolution: String,
    pub abandon_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PomodoroRecord {
    pub id: i64,
    pub action_id: Option<i64>,
    pub action_title: Option<String>,
    pub start_time: i64,
    pub end_time: Option<i64>,
    pub planned_seconds: i64,
    pub actual_seconds: Option<i64>,
    pub status: i32,
    pub interrupt_type: Option<i32>,
    pub interrupt_reason: Option<String>,
    pub points_awarded: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PomodoroStatus {
    pub active: Option<PomodoroRecord>,
    pub total_points: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reward {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub points_required: i64,
    pub category: String,
    pub icon: String,
    pub status: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewReward {
    pub name: String,
    pub description: Option<String>,
    pub points_required: i64,
    pub category: String,
    pub icon: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateReward {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub points_required: i64,
    pub category: String,
    pub icon: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewardExchange {
    pub id: i64,
    pub reward_id: i64,
    pub reward_name: String,
    pub points_used: i64,
    pub exchanged_at: i64,
    pub checkin: Option<RewardCheckinBrief>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewardCheckinBrief {
    pub description: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewardCheckin {
    pub exchange_id: i64,
    pub reward_name: String,
    pub icon: String,
    pub points_used: i64,
    pub exchanged_at: i64,
    pub description: Option<String>,
    pub image_base64: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewardsOverview {
    pub total_points: i64,
    pub rewards: Vec<Reward>,
    pub exchanges: Vec<RewardExchange>,
}
