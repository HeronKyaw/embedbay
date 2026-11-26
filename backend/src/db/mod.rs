pub mod models;
pub mod repo;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("filesystem error initializing data directory: {0}")]
    Io(#[from] std::io::Error),
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("database mutex poisoned")]
    LockPoisoned,
    #[error("validation error: {0}")]
    Validation(String),
    #[error("not found: {0}")]
    NotFound(String),
}

struct Migration {
    version: i64,
    name: &'static str,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "0001_initial_schema",
        sql: include_str!("migrations/0001_initial_schema.sql"),
    },
    Migration {
        version: 2,
        name: "0002_extended_settings",
        sql: include_str!("migrations/0002_extended_settings.sql"),
    },
    Migration {
        version: 3,
        name: "0003_v01_features",
        sql: include_str!("migrations/0003_v01_features.sql"),
    },
    Migration {
        version: 4,
        name: "0004_app_settings",
        sql: include_str!("migrations/0004_app_settings.sql"),
    },
    Migration {
        version: 5,
        name: "0005_engine_last_used",
        sql: include_str!("migrations/0005_engine_last_used.sql"),
    },
];

pub struct Database {
    conn: Mutex<Connection>,
    data_root: PathBuf,
    db_path: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
pub struct TableRowCounts {
    pub installed_engines: i64,
    pub instances: i64,
    pub remote_connections: i64,
    pub connection_groups: i64,
    pub tags: i64,
    pub embedding_profiles: i64,
    pub search_history: i64,
    pub search_presets: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SqliteDiagnostics {
    pub schema_version: i64,
    pub sqlite_version: String,
    pub journal_mode: String,
    pub foreign_keys: bool,
    pub quick_check: String,
    pub db_bytes: u64,
    pub wal_bytes: u64,
    pub shm_bytes: u64,
    pub table_counts: TableRowCounts,
    pub stored_secret_refs: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct VacuumResult {
    pub before_bytes: u64,
    pub after_bytes: u64,
    pub freed_bytes: u64,
}

fn file_size_or_zero(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

fn count_table(conn: &Connection, table: &str) -> Result<i64, DbError> {
    let sql = format!("SELECT COUNT(*) FROM {}", table);
    Ok(conn.query_row(&sql, [], |row| row.get(0))?)
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

    pub fn bin_dir(&self) -> PathBuf {
        self.data_root.join("bin")
    }

    pub fn instance_root(&self, instance_id: &str) -> PathBuf {
        self.data_root.join("instances").join(instance_id)
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

    pub fn db_storage_bytes(&self) -> (u64, u64, u64) {
        let db_bytes = file_size_or_zero(&self.db_path);
        let wal_path = PathBuf::from(format!("{}-wal", self.db_path.display()));
        let shm_path = PathBuf::from(format!("{}-shm", self.db_path.display()));
        (
            db_bytes,
            file_size_or_zero(&wal_path),
            file_size_or_zero(&shm_path),
        )
    }

    pub fn sqlite_diagnostics(&self) -> Result<SqliteDiagnostics, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let schema_version: i64 = conn.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )?;
        let journal_mode: String = conn.query_row("PRAGMA journal_mode", [], |row| row.get(0))?;
        let fk_val: i64 = conn.query_row("PRAGMA foreign_keys", [], |row| row.get(0))?;
        let quick_check: String =
            conn.query_row("PRAGMA quick_check(1)", [], |row| row.get(0))?;

        let table_counts = TableRowCounts {
            installed_engines: count_table(&conn, "installed_engines")?,
            instances: count_table(&conn, "instances")?,
            remote_connections: count_table(&conn, "remote_connections")?,
            connection_groups: count_table(&conn, "connection_groups")?,
            tags: count_table(&conn, "tags")?,
            embedding_profiles: count_table(&conn, "embedding_profiles")?,
            search_history: count_table(&conn, "search_history")?,
            search_presets: count_table(&conn, "search_presets")?,
        };

        let remote_secrets: i64 = conn.query_row(
            "SELECT COUNT(*) FROM remote_connections WHERE secret_ref IS NOT NULL",
            [],
            |row| row.get(0),
        )?;
        let embed_secrets: i64 = conn.query_row(
            "SELECT COUNT(*) FROM embedding_profiles WHERE secret_ref IS NOT NULL",
            [],
            |row| row.get(0),
        )?;

        let (db_bytes, wal_bytes, shm_bytes) = self.db_storage_bytes();

        Ok(SqliteDiagnostics {
            schema_version,
            sqlite_version: rusqlite::version().to_string(),
            journal_mode,
            foreign_keys: fk_val != 0,
            quick_check,
            db_bytes,
            wal_bytes,
            shm_bytes,
            table_counts,
            stored_secret_refs: remote_secrets + embed_secrets,
        })
    }

    pub fn vacuum_database(&self) -> Result<VacuumResult, DbError> {
        let (b_db, b_wal, b_shm) = self.db_storage_bytes();
        let before_bytes = b_db.saturating_add(b_wal).saturating_add(b_shm);

        {
            let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
            conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")?;
        }

        let (a_db, a_wal, a_shm) = self.db_storage_bytes();
        let after_bytes = a_db.saturating_add(a_wal).saturating_add(a_shm);

        Ok(VacuumResult {
            before_bytes,
            after_bytes,
            freed_bytes: before_bytes.saturating_sub(after_bytes),
        })
    }

    pub fn get_app_setting(&self, key: &str) -> Result<Option<String>, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let mut stmt = conn.prepare("SELECT value FROM app_settings WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn set_app_setting(&self, key: &str, value: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let updated_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        conn.execute(
            "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, updated_at],
        )?;
        Ok(())
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
        assert_eq!(db.schema_version().expect("schema version"), 5);
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
                "app_settings",
                "connection_groups",
                "embedding_profiles",
                "entity_tags",
                "installed_engines",
                "instances",
                "remote_connections",
                "schema_migrations",
                "search_history",
                "search_presets",
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
        assert_eq!(db2.schema_version().expect("schema version after re-init"), 5);
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

    #[test]
    fn crud_groups_tags_instances_and_engines() {
        use crate::db::models::*;

        let dir = tempfile::tempdir().expect("temp dir");
        let db = Database::init(dir.path().to_path_buf()).expect("db init");

        let engine = InstalledEngine {
            id: "qdrant-1.20.2".to_string(),
            engine_type: "qdrant".to_string(),
            version: "1.20.2".to_string(),
            target_triple: "x86_64-pc-windows-msvc".to_string(),
            binary_path: "C:/bin/qdrant.exe".to_string(),
            sha256: "abc123".to_string(),
            installed_at: 100,
            last_used_at: None,
        };
        db.upsert_installed_engine(&engine).expect("upsert engine");
        assert_eq!(db.list_installed_engines().expect("list engines").len(), 1);

        let group = db
            .create_group(CreateGroupPayload {
                name: "Work RAG".to_string(),
                color: Some("#14B8A6".to_string()),
                icon: Some("Folder".to_string()),
            })
            .expect("create group");
        let tag = db
            .create_tag("local".to_string(), "#14B8A6".to_string())
            .expect("create tag");

        let inst = db
            .create_instance(CreateInstancePayload {
                name: "Local Qdrant Dev".to_string(),
                description: Some("Dev box".to_string()),
                color: Some("#14B8A6".to_string()),
                group_id: Some(group.id.clone()),
                engine_type: "qdrant".to_string(),
                engine_version: "1.20.2".to_string(),
                host: None,
                port: 6333,
                grpc_port: Some(6334),
                data_dir: None,
                config_json: None,
                auto_start: Some(true),
                idle_timeout_minutes: Some(15),
                tag_ids: Some(vec![tag.id.clone()]),
            })
            .expect("create instance");

        assert_eq!(inst.host, "127.0.0.1");
        assert_eq!(inst.tag_ids, vec![tag.id.clone()]);
        assert_eq!(inst.idle_timeout_minutes, 15);
        assert!(inst.auto_start);

        let updated = db
            .update_instance(
                &inst.id,
                UpdateInstancePayload {
                    name: Some("Qdrant Renamed".to_string()),
                    description: None,
                    color: None,
                    group_id: None,
                    engine_version: None,
                    host: None,
                    port: Some(6335),
                    grpc_port: None,
                    data_dir: None,
                    config_json: None,
                    auto_start: Some(false),
                    idle_timeout_minutes: Some(0),
                    sort_order: None,
                    tag_ids: Some(vec![]),
                },
            )
            .expect("update instance");
        assert_eq!(updated.name, "Qdrant Renamed");
        assert_eq!(updated.port, 6335);
        assert!(updated.tag_ids.is_empty());

        assert!(db.delete_instance(&inst.id).expect("delete instance"));
        assert!(db.delete_group(&group.id).expect("delete group"));
        assert!(db.delete_tag(&tag.id).expect("delete tag"));
        assert!(db.delete_installed_engine(&engine.id).expect("delete engine"));
    }

    #[test]
    fn search_history_prunes_to_100_and_presets_crud() {
        use crate::db::models::*;

        let dir = tempfile::tempdir().expect("temp dir");
        let db = Database::init(dir.path().to_path_buf()).expect("db init");

        for i in 0..105 {
            db.record_search_history(SaveSearchHistoryPayload {
                connection_key: "local:inst1".to_string(),
                collection: "docs".to_string(),
                search_mode: "text".to_string(),
                query_text: Some(format!("query {}", i)),
                vector_json: None,
                embedding_profile_id: Some("prof1".to_string()),
                top_k: 10,
                score_threshold: Some(0.5),
                filter_json: None,
                result_count: 3,
                latency_ms: Some(12),
            })
            .expect("record history");
        }

        let history = db
            .list_search_history("local:inst1", "docs", None)
            .expect("list history");
        assert_eq!(history.len(), 100);
        assert_eq!(history[0].query_text.as_deref(), Some("query 104"));
        assert_eq!(history[99].query_text.as_deref(), Some("query 5"));

        let cleared = db
            .clear_search_history("local:inst1", "docs")
            .expect("clear history");
        assert_eq!(cleared, 100);
        assert!(db
            .list_search_history("local:inst1", "docs", None)
            .expect("empty history")
            .is_empty());

        let preset = db
            .save_search_preset(SaveSearchPresetPayload {
                name: "Rust Docs Top 5".to_string(),
                connection_key: "local:inst1".to_string(),
                collection: "docs".to_string(),
                search_mode: "text".to_string(),
                query_text: Some("ownership".to_string()),
                vector_json: None,
                embedding_profile_id: Some("prof1".to_string()),
                top_k: 5,
                score_threshold: Some(0.75),
                filter_json: Some(r#"{"mode":"raw_json","json":{"topic":"rust"}}"#.to_string()),
            })
            .expect("save preset");

        let presets = db
            .list_search_presets("local:inst1", "docs")
            .expect("list presets");
        assert_eq!(presets.len(), 1);
        assert_eq!(presets[0].name, "Rust Docs Top 5");
        assert!(db.delete_search_preset(&preset.id).expect("delete preset"));
        assert!(db
            .list_search_presets("local:inst1", "docs")
            .expect("empty presets")
            .is_empty());
    }

    #[test]
    fn sqlite_diagnostics_and_vacuum_work() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Database::init(dir.path().to_path_buf()).expect("db init");

        db.create_tag("prod".to_string(), "#F43F5E".to_string())
            .expect("create tag");

        let diag = db.sqlite_diagnostics().expect("sqlite diagnostics");
        assert_eq!(diag.schema_version, 5);
        assert_eq!(diag.quick_check, "ok");
        assert!(diag.journal_mode.eq_ignore_ascii_case("wal"));
        assert!(diag.foreign_keys);
        assert!(diag.db_bytes > 0);
        assert_eq!(diag.table_counts.tags, 1);
        assert_eq!(diag.stored_secret_refs, 0);

        let vacuum = db.vacuum_database().expect("vacuum database");
        assert!(vacuum.after_bytes > 0);
    }

    #[test]
    fn app_settings_get_and_set_roundtrip() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Database::init(dir.path().to_path_buf()).expect("db init");

        assert_eq!(
            db.get_app_setting("close_behavior").expect("get unset"),
            None
        );

        db.set_app_setting("close_behavior", "quit")
            .expect("set quit");
        assert_eq!(
            db.get_app_setting("close_behavior").expect("get quit"),
            Some("quit".to_string())
        );

        db.set_app_setting("close_behavior", "tray")
            .expect("set tray");
        assert_eq!(
            db.get_app_setting("close_behavior").expect("get tray"),
            Some("tray".to_string())
        );
    }
}
