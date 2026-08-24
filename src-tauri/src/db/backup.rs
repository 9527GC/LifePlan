use crate::db::DbError;
use rusqlite::{Connection, DatabaseName};
use std::fs;
use std::path::{Path, PathBuf};

pub fn backup_dir(db_path: &Path) -> PathBuf {
    db_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("backups")
}

pub fn startup_backup_path(db_path: &Path) -> PathBuf {
    backup_dir(db_path).join("startup.db")
}

pub fn migration_backup_path(db_path: &Path) -> PathBuf {
    backup_dir(db_path).join("migration-before.db")
}

pub fn failed_backup_path(db_path: &Path, timestamp: i64) -> PathBuf {
    backup_dir(db_path).join(format!("migration-failed-{timestamp}.db"))
}

fn validate(path: &Path) -> Result<(), DbError> {
    let conn = Connection::open(path).map_err(DbError::ConnectionFailed)?;
    let result: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(DbError::ConnectionFailed)?;
    if result != "ok" {
        return Err(DbError::Other(format!(
            "backup integrity check failed: {result}"
        )));
    }
    Ok(())
}

pub fn create_backup(db_path: &Path, target: &Path) -> Result<(), DbError> {
    fs::create_dir_all(backup_dir(db_path))
        .map_err(|error| DbError::PathFailed(format!("create backup directory failed: {error}")))?;
    let temporary = target.with_extension("db.tmp");
    if temporary.exists() {
        fs::remove_file(&temporary).map_err(|error| {
            DbError::PathFailed(format!("remove temporary backup failed: {error}"))
        })?;
    }
    if !db_path.exists() {
        return Err(DbError::PathFailed("database file does not exist".into()));
    }
    let source = Connection::open(db_path).map_err(DbError::ConnectionFailed)?;
    source
        .backup(DatabaseName::Main, &temporary, None)
        .map_err(DbError::ConnectionFailed)?;
    if let Err(error) = validate(&temporary) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    if target.exists() {
        fs::remove_file(target)
            .map_err(|error| DbError::PathFailed(format!("replace backup failed: {error}")))?;
    }
    fs::rename(&temporary, target)
        .map_err(|error| DbError::PathFailed(format!("finalize backup failed: {error}")))
}

pub fn create_startup_backup(db_path: &Path) -> Result<(), DbError> {
    create_backup(db_path, &startup_backup_path(db_path))
}

pub fn create_migration_backup(db_path: &Path) -> Result<(), DbError> {
    create_backup(db_path, &migration_backup_path(db_path))
}

pub fn preserve_failed_database(db_path: &Path, timestamp: i64) -> Result<PathBuf, DbError> {
    let target = failed_backup_path(db_path, timestamp);
    create_backup(db_path, &target)?;
    Ok(target)
}

pub fn restore_backup(db_path: &Path) -> Result<(), DbError> {
    let source = migration_backup_path(db_path);
    if !source.exists() {
        return Err(DbError::PathFailed(
            "migration backup does not exist".into(),
        ));
    }
    let temporary = db_path.with_extension("db.restore.tmp");
    if temporary.exists() {
        fs::remove_file(&temporary).map_err(|error| {
            DbError::PathFailed(format!("remove restore temporary failed: {error}"))
        })?;
    }
    fs::copy(&source, &temporary)
        .map_err(|error| DbError::PathFailed(format!("restore backup failed: {error}")))?;
    validate(&temporary)?;
    if db_path.exists() {
        fs::remove_file(db_path)
            .map_err(|error| DbError::PathFailed(format!("replace database failed: {error}")))?;
    }
    fs::rename(&temporary, db_path)
        .map_err(|error| DbError::PathFailed(format!("finalize database restore failed: {error}")))
}
