pub mod actions;
pub mod analytics;
pub mod daily_list;
pub mod daily_schedule;
pub mod events;
pub mod pomodoro;
pub mod projects;
pub mod recurring_actions;
pub mod rewards;
pub mod system;

/// 根据重要程度和紧急程度计算优先级，数字越小表示越优先。
pub fn calculate_priority(importance: i32, urgency: i32) -> i32 {
    4 - (importance * 2 + urgency)
}

#[cfg(test)]
mod tests {
    use super::calculate_priority;

    #[test]
    fn 优先级与重要紧急组合一致() {
        assert_eq!(calculate_priority(1, 1), 1);
        assert_eq!(calculate_priority(1, 0), 2);
        assert_eq!(calculate_priority(0, 1), 3);
        assert_eq!(calculate_priority(0, 0), 4);
    }
}
