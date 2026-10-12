use crate::db::{current_space_id, AppState};
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

// 首次升级保留历史汇总，并通过期初调整与真实余额对齐，不重复发放积分。
pub fn ensure_schema(conn: &mut Connection) -> rusqlite::Result<()> {
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='points_ledger'",
        [],
        |r| r.get(0),
    )?;
    if exists > 0 {
        return Ok(());
    }
    let tx = conn.transaction()?;
    tx.execute_batch(r#"
CREATE TABLE points_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, space_id TEXT NOT NULL REFERENCES local_spaces(space_id), kind TEXT NOT NULL, content TEXT NOT NULL, amount INTEGER NOT NULL, occurred_at INTEGER NOT NULL, source_id INTEGER, historical INTEGER NOT NULL DEFAULT 0);
CREATE INDEX idx_points_ledger_space_time ON points_ledger(space_id, occurred_at DESC, id DESC);
INSERT INTO points_ledger(space_id,kind,content,amount,occurred_at,source_id,historical)
SELECT r.space_id,'focus',COALESCE(a.title,'自由专注'),r.points_awarded,COALESCE(r.end_time,r.start_time),r.id,1 FROM pomodoro_records r LEFT JOIN actions a ON a.id=r.action_id WHERE r.points_awarded>0;
INSERT INTO points_ledger(space_id,kind,content,amount,occurred_at,source_id,historical)
SELECT space_id,'event',title,completion_points_awarded,updated_at,id,1 FROM events WHERE completion_points_awarded>0;
INSERT INTO points_ledger(space_id,kind,content,amount,occurred_at,source_id,historical)
SELECT x.space_id,'exchange',COALESCE(r.name,'历史奖励'),-x.points_used,x.exchanged_at,x.id,1 FROM reward_exchanges x LEFT JOIN rewards r ON r.id=x.reward_id;
INSERT INTO points_ledger(space_id,kind,content,amount,occurred_at,historical)
SELECT p.space_id,'opening','历史余额调整',p.total_points-COALESCE((SELECT SUM(amount) FROM points_ledger l WHERE l.space_id=p.space_id),0),p.updated_at,1 FROM user_points p WHERE p.total_points != COALESCE((SELECT SUM(amount) FROM points_ledger l WHERE l.space_id=p.space_id),0);
"#)?;
    tx.commit()
}

pub(crate) fn record(
    conn: &Connection,
    space: &str,
    kind: &str,
    source: i64,
    amount: i64,
    time: i64,
) -> rusqlite::Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let sql = match kind {
        "focus" => "SELECT COALESCE(a.title,'自由专注') FROM pomodoro_records r LEFT JOIN actions a ON a.id=r.action_id WHERE r.id=?1",
        "event" | "revoke" => "SELECT title FROM events WHERE id=?1",
        _ => "SELECT r.name FROM reward_exchanges x JOIN rewards r ON r.id=x.reward_id WHERE x.id=?1",
    };
    let title: String = conn.query_row(sql, [source], |r| r.get(0))?;
    conn.execute("INSERT INTO points_ledger(space_id,kind,content,amount,occurred_at,source_id) VALUES (?1,?2,?3,?4,?5,?6)", params![space,kind,title,amount,time,source])?;
    Ok(())
}

#[derive(Serialize)]
pub struct Entry {
    id: i64,
    kind: String,
    content: String,
    amount: i64,
    occurred_at: i64,
    source_id: Option<i64>,
    historical: bool,
}
#[derive(Serialize)]
pub struct LedgerPage {
    entries: Vec<Entry>,
    total: i64,
}

#[tauri::command]
pub fn get_points_ledger(
    state: State<'_, AppState>,
    page: Option<i64>,
    kind: Option<String>,
) -> Result<LedgerPage, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let space = current_space_id(&conn).map_err(|e| e.to_string())?;
    let page = page.unwrap_or(1).max(1);
    let total = conn.query_row("SELECT COUNT(*) FROM points_ledger WHERE space_id=?1 AND (?2 IS NULL OR kind=?2)", params![space, kind], |r| r.get(0)).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id,kind,content,amount,occurred_at,source_id,historical FROM points_ledger WHERE space_id=?1 AND (?2 IS NULL OR kind=?2) ORDER BY occurred_at DESC,id DESC LIMIT 20 OFFSET ?3").map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![space, kind, page.saturating_sub(1).saturating_mul(20)], |r| {
        Ok(Entry {
            id: r.get(0)?, kind: r.get(1)?, content: r.get(2)?, amount: r.get(3)?,
            occurred_at: r.get(4)?, source_id: r.get(5)?, historical: r.get(6)?,
        })
    }).map_err(|e| e.to_string())?;
    let entries = rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?;
    Ok(LedgerPage { entries, total })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn database() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(crate::db::migrations::INIT_MIGRATION)
            .unwrap();
        conn.execute_batch("INSERT INTO local_spaces VALUES ('test',NULL,0,0); INSERT INTO events(space_id,sync_id,title,created_at,updated_at) VALUES ('test','event','测试事件',0,0);").unwrap();
        ensure_schema(&mut conn).unwrap();
        conn
    }
    #[test]
    fn 历史汇总迁移对齐余额且重复执行不重复导入() {
        let mut conn = database();
        conn.execute_batch("DROP TABLE points_ledger; INSERT INTO user_points VALUES ('test',7,100); INSERT INTO pomodoro_records(space_id,start_time,planned_seconds,points_awarded,created_at) VALUES ('test',0,1800,2,0); UPDATE events SET completion_points_awarded=10;").unwrap();
        ensure_schema(&mut conn).unwrap();
        ensure_schema(&mut conn).unwrap();
        let (sum, count): (i64, i64) = conn
            .query_row("SELECT SUM(amount),COUNT(*) FROM points_ledger", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!((sum, count), (7, 3));
        assert_eq!(
            conn.query_row::<i64, _, _>("SELECT total_points FROM user_points", [], |r| r.get(0))
                .unwrap(),
            7
        );
    }
    #[test]
    fn 事件奖励幂等且撤回记录实际扣除值() {
        let mut conn = database();
        let tx = conn.transaction().unwrap();
        let award = super::super::events::award_event_completion_tx(&tx, 1, "test", 2).unwrap();
        assert!(award > 0);
        assert_eq!(
            super::super::events::award_event_completion_tx(&tx, 1, "test", 2).unwrap(),
            0
        );
        tx.execute(
            "UPDATE user_points SET total_points=3 WHERE space_id='test'",
            [],
        )
        .unwrap();
        super::super::events::revoke_event_completion_tx(&tx, 1, "test").unwrap();
        assert_eq!(
            tx.query_row::<i64, _, _>(
                "SELECT amount FROM points_ledger WHERE kind='revoke'",
                [],
                |r| r.get(0)
            )
            .unwrap(),
            -3
        );
        assert_eq!(
            super::super::events::revoke_event_completion_tx(&tx, 1, "test").unwrap(),
            0
        );
        tx.commit().unwrap();
    }
    #[test]
    fn 流水与余额事务回滚且名称快照不随改名变化() {
        let mut conn = database();
        {
            let tx = conn.transaction().unwrap();
            record(&tx, "test", "event", 1, 5, 100).unwrap();
        }
        assert_eq!(
            conn.query_row::<i64, _, _>("SELECT COUNT(*) FROM points_ledger", [], |r| r.get(0))
                .unwrap(),
            0
        );
        record(&conn, "test", "event", 1, 5, 100).unwrap();
        conn.execute("UPDATE events SET title='新名称' WHERE id=1", [])
            .unwrap();
        assert_eq!(
            conn.query_row::<String, _, _>("SELECT content FROM points_ledger", [], |r| r.get(0))
                .unwrap(),
            "测试事件"
        );
    }
}
