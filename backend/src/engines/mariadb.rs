use std::fs;
use std::path::{Path, PathBuf};

use async_trait::async_trait;
use mysql_async::prelude::Queryable;
use mysql_async::{Conn, Opts};

use crate::db::models::InstanceRecord;
use crate::engines::{connect_host, EngineError, EngineProvider, HealthCheckKind, LaunchSpec};
use crate::platform;

pub struct MariaDbProvider;

fn sibling_tool(mariadbd_binary: &Path, tool_base: &str) -> PathBuf {
    let dir = mariadbd_binary.parent().unwrap_or_else(|| Path::new("."));
    let is_exe = mariadbd_binary
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("exe"));
    let file_name = if is_exe {
        format!("{}.exe", tool_base)
    } else {
        tool_base.to_string()
    };
    dir.join(file_name)
}

fn ini_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[async_trait]
impl EngineProvider for MariaDbProvider {
    fn engine_type(&self) -> &'static str {
        "mariadb"
    }

    fn default_port(&self) -> u16 {
        3306
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

        // Initialize MariaDB system tables once when mysql/ is missing
        if !data_dir.join("mysql").is_dir() {
            let install_db = sibling_tool(binary_path, "mariadb-install-db");
            let mut cmd = std::process::Command::new(&install_db);
            cmd.arg(format!("--datadir={}", data_dir.to_string_lossy()));
            platform::configure_std_command(&mut cmd);
            let output = cmd.output().map_err(|e| {
                EngineError::Config(format!(
                    "Failed to invoke mariadb-install-db at {}: {}",
                    install_db.display(),
                    e
                ))
            })?;
            if !output.status.success() {
                return Err(EngineError::Config(format!(
                    "mariadb-install-db failed ({}): {}",
                    output.status,
                    String::from_utf8_lossy(&output.stderr)
                )));
            }
        }

        let basedir = binary_path
            .parent()
            .and_then(|p| p.parent())
            .unwrap_or(instance_root);
        let overrides: serde_json::Value =
            serde_json::from_str(&instance.config_json).unwrap_or(serde_json::Value::Null);
        let buffer_pool = overrides
            .get("innodb_buffer_pool_size")
            .and_then(|v| v.as_str())
            .unwrap_or("64M");
        let max_connections = overrides
            .get("max_connections")
            .and_then(|v| v.as_u64())
            .unwrap_or(32);

        let my_ini = format!(
            concat!(
                "# Managed by EmbedBay\n",
                "[mysqld]\n",
                "basedir={basedir}\n",
                "datadir={datadir}\n",
                "bind-address={host}\n",
                "port={port}\n",
                "innodb_buffer_pool_size={buffer_pool}\n",
                "max_connections={max_connections}\n",
                "character-set-server=utf8mb4\n",
                "collation-server=utf8mb4_unicode_ci\n",
            ),
            basedir = ini_path(basedir),
            datadir = ini_path(&data_dir),
            host = instance.host,
            port = instance.port,
            buffer_pool = buffer_pool,
            max_connections = max_connections,
        );
        let ini_file = config_dir.join("my.ini");
        fs::write(&ini_file, my_ini)?;

        let check_host = connect_host(&instance.host).to_string();
        Ok(LaunchSpec {
            program: binary_path.to_path_buf(),
            args: vec![
                format!("--defaults-file={}", ini_file.to_string_lossy()),
                "--console".to_string(),
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
        let url = format!("mysql://root@{}:{}/mysql", host, instance.port);
        let opts = Opts::from_url(&url)
            .map_err(|e| EngineError::Config(format!("Invalid MariaDB URL: {}", e)))?;

        let mut last_err = String::new();
        for _ in 0..10 {
            match Conn::new(opts.clone()).await {
                Ok(mut conn) => {
                    conn.query_drop("CREATE DATABASE IF NOT EXISTS `embedbay`;")
                        .await
                        .map_err(|e| {
                            EngineError::Config(format!("CREATE DATABASE embedbay failed: {}", e))
                        })?;
                    let _ = conn.disconnect().await;
                    return Ok(());
                }
                Err(err) => {
                    last_err = err.to_string();
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                }
            }
        }
        Err(EngineError::Config(format!(
            "Could not connect to MariaDB to initialize embedbay database: {}",
            last_err
        )))
    }

    async fn graceful_stop(
        &self,
        instance: &InstanceRecord,
        pid: u32,
        binary_path: &Path,
    ) -> Result<(), EngineError> {
        let admin = sibling_tool(binary_path, "mariadb-admin");
        if admin.is_file() {
            let host = connect_host(&instance.host);
            let mut cmd = tokio::process::Command::new(&admin);
            cmd.args([
                "-u",
                "root",
                "-h",
                host,
                "-P",
                &instance.port.to_string(),
                "shutdown",
            ]);
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
    fn generates_mariadb_my_ini_when_data_dir_initialized() {
        let dir = tempfile::tempdir().expect("temp dir");
        let data_dir = dir.path().join("data");
        fs::create_dir_all(data_dir.join("mysql")).expect("mkdir mysql");

        let inst = InstanceRecord {
            id: "mdb-1".to_string(),
            name: "Local MariaDB".to_string(),
            description: None,
            color: None,
            group_id: None,
            engine_type: "mariadb".to_string(),
            engine_version: "11.8.8".to_string(),
            host: "127.0.0.1".to_string(),
            port: 3306,
            grpc_port: None,
            data_dir: data_dir.to_string_lossy().into_owned(),
            config_json: r#"{"innodb_buffer_pool_size":"128M"}"#.to_string(),
            auto_start: false,
            idle_timeout_minutes: 0,
            sort_order: 0,
            created_at: 0,
            tag_ids: Vec::new(),
        };

        let spec = MariaDbProvider
            .prepare_instance(&inst, dir.path(), Path::new("C:/bin/mariadb/bin/mariadbd.exe"))
            .expect("prepare mariadb");

        assert!(spec.args[0].starts_with("--defaults-file="));
        assert_eq!(spec.args[1], "--console");
        let ini = fs::read_to_string(dir.path().join("config").join("my.ini")).expect("my.ini");
        assert!(ini.contains("port=3306"));
        assert!(ini.contains("innodb_buffer_pool_size=128M"));
        assert!(!ini.contains('\\'));
    }
}
