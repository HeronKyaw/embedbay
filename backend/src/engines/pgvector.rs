use std::fs;
use std::path::{Path, PathBuf};

use async_trait::async_trait;
use tokio_postgres::NoTls;

use crate::db::models::InstanceRecord;
use crate::engines::{connect_host, EngineError, EngineProvider, HealthCheckKind, LaunchSpec};
use crate::platform;

pub struct PgVectorProvider;

fn sibling_tool(postgres_binary: &Path, tool_base: &str) -> PathBuf {
    let dir = postgres_binary.parent().unwrap_or_else(|| Path::new("."));
    let exe_name = if cfg!(target_os = "windows") {
        format!("{}.exe", tool_base)
    } else {
        tool_base.to_string()
    };
    dir.join(exe_name)
}

#[async_trait]
impl EngineProvider for PgVectorProvider {
    fn engine_type(&self) -> &'static str {
        "pgvector"
    }

    fn default_port(&self) -> u16 {
        5432
    }

    fn default_grpc_port(&self) -> Option<u16> {
        None
    }

    fn prepare_instance(
        &self,
        instance: &InstanceRecord,
        instance_root: &Path,
        binary_path: &Path,
    ) -> Result<LaunchSpec, EngineError> {
        let config_dir = instance_root.join("config");
        let data_dir = PathBuf::from(&instance.data_dir);
        let logs_dir = instance_root.join("logs");

        fs::create_dir_all(&config_dir)?;
        fs::create_dir_all(&data_dir)?;
        fs::create_dir_all(&logs_dir)?;

        // Initialize PostgreSQL cluster once if PG_VERSION is missing
        if !data_dir.join("PG_VERSION").is_file() {
            let initdb = sibling_tool(binary_path, "initdb");
            let mut cmd = std::process::Command::new(&initdb);
            cmd.arg("-D")
                .arg(&data_dir)
                .args(["-U", "postgres", "-A", "trust", "-E", "UTF8", "--no-locale"]);
            platform::configure_std_command(&mut cmd);
            let output = cmd.output().map_err(|e| {
                EngineError::Config(format!("Failed to invoke initdb at {}: {}", initdb.display(), e))
            })?;
            if !output.status.success() {
                return Err(EngineError::Config(format!(
                    "initdb failed ({}): {}",
                    output.status,
                    String::from_utf8_lossy(&output.stderr)
                )));
            }
        }

        let overrides: serde_json::Value =
            serde_json::from_str(&instance.config_json).unwrap_or(serde_json::Value::Null);
        let shared_buffers = overrides
            .get("shared_buffers")
            .and_then(|v| v.as_str())
            .unwrap_or("64MB");
        let max_connections = overrides
            .get("max_connections")
            .and_then(|v| v.as_u64())
            .unwrap_or(32);

        let auto_conf = format!(
            "# Managed by EmbedBay\n\
             listen_addresses = '{}'\n\
             port = {}\n\
             shared_buffers = '{}'\n\
             max_connections = {}\n\
             logging_collector = off\n",
            instance.host, instance.port, shared_buffers, max_connections
        );
        fs::write(data_dir.join("postgresql.auto.conf"), auto_conf)?;

        let check_host = connect_host(&instance.host).to_string();
        Ok(LaunchSpec {
            program: binary_path.to_path_buf(),
            args: vec![
                "-D".to_string(),
                data_dir.to_string_lossy().into_owned(),
                "-h".to_string(),
                instance.host.clone(),
                "-p".to_string(),
                instance.port.to_string(),
            ],
            cwd: instance_root.to_path_buf(),
            env: Vec::new(),
            health: HealthCheckKind::TcpConnect {
                host: check_host,
                port: instance.port,
            },
        })
    }

    async fn post_start_init(
        &self,
        instance: &InstanceRecord,
        _binary_path: &Path,
    ) -> Result<(), EngineError> {
        let host = connect_host(&instance.host);
        let conn_str = format!(
            "host={} port={} user=postgres dbname=postgres",
            host, instance.port
        );

        let mut last_err = String::new();
        for _ in 0..10 {
            match tokio_postgres::connect(&conn_str, NoTls).await {
                Ok((client, connection)) => {
                    tokio::spawn(async move {
                        let _ = connection.await;
                    });
                    client
                        .batch_execute("CREATE EXTENSION IF NOT EXISTS vector;")
                        .await
                        .map_err(|e| {
                            EngineError::Config(format!("CREATE EXTENSION vector failed: {}", e))
                        })?;
                    return Ok(());
                }
                Err(err) => {
                    last_err = err.to_string();
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                }
            }
        }
        Err(EngineError::Config(format!(
            "Could not connect to PostgreSQL to enable pgvector extension: {}",
            last_err
        )))
    }

    async fn graceful_stop(
        &self,
        instance: &InstanceRecord,
        pid: u32,
        binary_path: &Path,
    ) -> Result<(), EngineError> {
        let pg_ctl = sibling_tool(binary_path, "pg_ctl");
        if pg_ctl.is_file() {
            let mut cmd = tokio::process::Command::new(&pg_ctl);
            cmd.args(["-D", &instance.data_dir, "-m", "fast", "stop"]);
            platform::configure_tokio_command(&mut cmd);
            if let Ok(status) = cmd.status().await {
                if status.success() {
                    return Ok(());
                }
            }
        }
        platform::graceful_stop_process(pid).map_err(EngineError::Stop)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_low_ram_pg_auto_conf_when_cluster_exists() {
        let dir = tempfile::tempdir().expect("temp dir");
        let data_dir = dir.path().join("data");
        fs::create_dir_all(&data_dir).expect("mkdir");
        fs::write(data_dir.join("PG_VERSION"), "17\n").expect("write PG_VERSION");

        let inst = InstanceRecord {
            id: "pg-1".to_string(),
            name: "Local pgvector".to_string(),
            description: None,
            color: None,
            group_id: None,
            engine_type: "pgvector".to_string(),
            engine_version: "17.9-pgvector0.8.6".to_string(),
            host: "127.0.0.1".to_string(),
            port: 5432,
            grpc_port: None,
            data_dir: data_dir.to_string_lossy().into_owned(),
            config_json: r#"{"shared_buffers":"96MB"}"#.to_string(),
            auto_start: false,
            idle_timeout_minutes: 0,
            sort_order: 0,
            created_at: 0,
            tag_ids: Vec::new(),
        };

        let spec = PgVectorProvider
            .prepare_instance(&inst, dir.path(), Path::new("C:/bin/pgsql/bin/postgres.exe"))
            .expect("prepare pgvector");

        assert_eq!(spec.args[0], "-D");
        assert_eq!(spec.args[3], "127.0.0.1");
        assert_eq!(spec.args[5], "5432");
        let conf = fs::read_to_string(data_dir.join("postgresql.auto.conf")).expect("read conf");
        assert!(conf.contains("shared_buffers = '96MB'"));
        assert!(conf.contains("port = 5432"));
    }
}
