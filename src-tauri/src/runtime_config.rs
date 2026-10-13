/// 与数据库使用同一构建渠道，隔离 WebView 存储和单实例标识。
/// 生产版必须沿用原标识，避免升级后读不到用户已经保存的 AI 配置。
pub(crate) fn channel_identifier(base: &str, data_folder: &str) -> String {
    match data_folder.strip_prefix("LifePlanTodolist-") {
        Some(channel) => format!("{base}.{channel}"),
        None => base.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::channel_identifier;

    const BASE: &str = "com.tauri-app.life-plan-todolist";

    #[test]
    fn 生产版保留已有配置目录标识() {
        assert_eq!(channel_identifier(BASE, "LifePlanTodolist"), BASE);
    }

    #[test]
    fn 本地构建使用独立标识() {
        assert_eq!(
            channel_identifier(BASE, "LifePlanTodolist-dev"),
            format!("{BASE}.dev")
        );
    }

    #[test]
    fn 不同测试渠道互相隔离() {
        let qa = channel_identifier(BASE, "LifePlanTodolist-qa-smoke");
        assert_eq!(qa, format!("{BASE}.qa-smoke"));
        assert_ne!(qa, channel_identifier(BASE, "LifePlanTodolist-dev"));
        assert_ne!(qa, BASE);
    }
}
