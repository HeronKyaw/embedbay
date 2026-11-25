use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("filesystem error initializing data directory: {0}")]
    Io(#[from] std::io::Error),
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("database mutex poisoned")]
    LockPoisoned,
}

struct Migration {
    version: i64,
    name: &'static str,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    name: "0001_initial_schema",
    sql: include_str!("migrations/0001_initial_schema.sql"),
}];

pub struct Database {
    conn: Mutex<Connection>,
    data_root: PathBuf,
    db_path: PathBuf,
}

impl Database {
    /// Initializes `<data_root>/app.db`, directory layout (`bin/`, `instances/`),
    /// WAL mode, foreign keys, and executes pending schema migrations.
    pub fn init(data_root: PathBuf) -> Result<Self, DbError> {
        std::fs::create_dir_all(&data_root)?;
        std::fs::create_dir_all(data_root.join("bin"))?;
        std::fs::create_dir_all(data_root.join("instances"))?;

        let db_path = data_root.join("app.db");
        let mut conn = Connection::open(&db_path)?;

        conn.execute_batch(
            "PRAGMA journal_mode = WAL;\
             PRAGMA foreign_keys = ON;",
        )?;

        Self::run_migrations(&mut conn)?;

        Ok(Self {
            conn: Mutex::new(conn),
            data_root,
            db_path,
        })
    }

    pub fn data_root(&self) -> &Path {
        &self.data_root
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    pub fn schema_version(&self) -> Result<i64, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let version: i64 = conn.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )?;
        Ok(version)
    }

    fn run_migrations(conn: &mut Connection) -> Result<(), DbError> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (\
                version INTEGER PRIMARY KEY,\
                name TEXT NOT NULL,\
                applied_at INTEGER NOT NULL\
            );",
        )?;

        let current_version: i64 = conn.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )?;

        for migration in MIGRATIONS {
            if migration.version <= current_version {
                continue;
            }

            let applied_at = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);

            let tx = conn.transaction()?;
            tx.execute_batch(migration.sql)?;
            tx.execute(
                "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
                params![migration.version, migration.name, applied_at],
            )?;
            tx.commit()?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_create_all_tables_and_are_idempotent() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let root = dir.path().to_path_buf();

        let db = Database::init(root.clone()).expect("initial db init");
        assert_eq!(db.schema_version().expect("schema version"), 1);
        assert!(root.join("app.db").exists());
        assert!(root.join("bin").is_dir());
        assert!(root.join("instances").is_dir());

        {
            let conn = db.conn.lock().expect("lock db");
            let mut stmt = conn
                .prepare(
                    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC",
                )
                .expect("prepare table query");
            let tables: Vec<String> = stmt
                .query_map([], |row| row.get(0))
                .expect("query tables")
                .map(|r| r.expect("table name"))
                .collect();

            for expected in [
                "connection_groups",
                "embedding_profiles",
                "entity_tags",
                "installed_engines",
                "instances",
                "remote_connections",
                "schema_migrations",
                "tags",
            ] {
                assert!(
                    tables.contains(&expected.to_string()),
                    "missing expected table: {}",
                    expected
                );
            }
        }

        drop(db);

        // Re-initializing on existing DB should cleanly be a no-op
        let db2 = Database::init(root).expect("idempotent db re-init");
        assert_eq!(db2.schema_version().expect("schema version after re-init"), 1);
    }

    #[test]
    fn foreign_keys_cascade_and_set_null() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let db = Database::init(dir.path().to_path_buf()).expect("db init");
        let conn = db.conn.lock().expect("lock db");

        conn.execute(
            "INSERT INTO connection_groups (id, name, color, sort_order, is_collapsed, created_at)
             VALUES ('g1', 'Work RAG', '#14B8A6', 0, 0, 1000)",
            [],
        )
        .expect("insert group");

        conn.execute(
            "INSERT INTO instances (id, name, group_id, engine_type, engine_version, host, port, data_dir, config_json, created_at)
             VALUES ('i1', 'Local Qdrant', 'g1', 'qdrant', '1.20.2', '127.0.0.1', 6333, '/tmp/q', '{}', 1000)",
            [],
        )
        .expect("insert instance");

        conn.execute(
            "INSERT INTO tags (id, name, color) VALUES ('t1', 'local', '#14B8A6')",
            [],
        )
        .expect("insert tag");

        conn.execute(
            "INSERT INTO entity_tags (entity_type, entity_id, tag_id) VALUES ('instance', 'i1', 't1')",
            [],
        )
        .expect("insert entity_tag");

        // Deleting group sets instance.group_id = NULL
        conn.execute("DELETE FROM connection_groups WHERE id = 'g1'", [])
            .expect("delete group");
        let group_id: Option<String> = conn
            .query_row("SELECT group_id FROM instances WHERE id = 'i1'", [], |row| {
                row.get(0)
            })
            .expect("query instance group_id");
        assert_eq!(group_id, None);

        // Deleting tag cascades to entity_tags
        conn.execute("DELETE FROM tags WHERE id = 't1'", [])
            .expect("delete tag");
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM entity_tags WHERE entity_id = 'i1'",
                [],
                |row| row.get(0),
            )
            .expect("count entity_tags");
        assert_eq!(count, 0);
    }
}
