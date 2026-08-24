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
    pub project_id: Option<i64>,
    pub project_title: Option<String>,
    pub action_count: i64,
    pub pending_action_count: i64,
    pub completed_action_count: i64,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessEvent {
    pub event_id: i64,
    pub decision: String,
    pub project_title: Option<String>,
    pub target: Option<String>,
    pub start_date: Option<String>,
    pub deadline: Option<String>,
    pub importance: Option<i32>,
    pub urgency: Option<i32>,
    pub initial_action_title: Option<String>,
    pub action_steps: Option<Vec<ProcessActionStep>>,
    pub delegated_to: Option<String>,
    pub follow_up_date: Option<String>,
    pub follow_up_note: Option<String>,
    pub action_title: Option<String>,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: i64,
    pub event_id: i64,
    pub event_title: String,
    pub title: String,
    pub target: Option<String>,
    pub estimated_hours: f64,
    pub start_date: Option<String>,
    pub deadline: Option<String>,
    pub importance: i32,
    pub urgency: i32,
    pub priority: i32,
    pub status: i32,
    pub action_count: i64,
    pub completed_action_count: i64,
    pub pending_action_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProject {
    pub id: i64,
    pub title: String,
    pub target: Option<String>,
    pub start_date: Option<String>,
    pub deadline: Option<String>,
    pub importance: i32,
    pub urgency: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Action {
    pub id: i64,
    pub event_id: Option<i64>,
    pub project_id: Option<i64>,
    pub event_title: Option<String>,
    pub project_title: Option<String>,
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
    pub project_id: Option<i64>,
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
pub struct ReorderProjectActions {
    pub project_id: i64,
    pub action_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DelegatedFollowUpResolution {
    pub action_id: i64,
    pub resolution: String,
    pub abandon_reason: Option<String>,
}
