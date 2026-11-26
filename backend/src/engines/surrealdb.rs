use std::fs;
use std::path::{Path, PathBuf};

use async_trait::async_trait;

use crate::db::models::InstanceRecord;
use crate::engines::{connect_host, EngineError, EngineProvider, HealthCheckKind, LaunchSpec};

pub struct SurrealDbProvider;

#[async_trait]
impl EngineProvider for SurrealDbProvider {
    fn engine_type(&self) -> &'static str {
        "surrealdb"
    }

    fn default_port(&self) -> u16 {
        8008
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

        let overrides: serde_json::Value =
            serde_json::from_str(&instance.config_json).unwrap_or(serde_json::Value::Null);
        let user = overrides
            .get("user")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or("root");
        let pass = overrides
            .get("pass")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or("root");
        let log_level = overrides
            .get("log_level")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or("info");

        let store_path = data_dir.join("store.db");
        let store_uri = format!(
            "surrealkv://{}",
            store_path.to_string_lossy().replace('\\', "/")
        );

        let check_host = connect_host(&instance.host);
        Ok(LaunchSpec {
            program: binary_path.to_path_buf(),
            args: vec![
                "start".to_string(),
                "--bind".to_string(),
                format!("{}:{}", instance.host, instance.port),
                "--user".to_string(),
                user.to_string(),
                "--pass".to_string(),
                pass.to_string(),
                "--log".to_string(),
                log_level.to_string(),
                store_uri,
            ],
            cwd: instance_root.to_path_buf(),
            env: vec![(
                "SURREAL_HTTP_MAX_SQL_BODY_SIZE".to_string(),
                "64MiB".to_string(),
            )],
            health: HealthCheckKind::HttpGet {
                url: format!("http://{}:{}/health", check_host, instance.port),
                fallback_url: Some(format!("http://{}:{}/status", check_host, instance.port)),
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_surrealdb_surrealkv_launch_spec() {
        let dir = tempfile::tempdir().expect("temp dir");
        let inst = InstanceRecord {
            id: "sr-1".to_string(),
            name: "Local SurrealDB".to_string(),
            description: None,
            color: None,
            group_id: None,
            engine_type: "surrealdb".to_string(),
            engine_version: "4.0.1".to_string(),
            host: "127.0.0.1".to_string(),
            port: 8008,
            grpc_port: None,
            data_dir: dir.path().join("data").to_string_lossy().into_owned(),
            config_json: "{}".to_string(),
            auto_start: false,
            idle_timeout_minutes: 0,
            sort_order: 0,
            created_at: 0,
            tag_ids: Vec::new(),
        };

        let spec = SurrealDbProvider
            .prepare_instance(&inst, dir.path(), Path::new("C:/bin/surreal.exe"))
            .expect("prepare surreal");
        assert_eq!(spec.args[0], "start");
        assert_eq!(spec.args[2], "127.0.0.1:8008");
        assert!(spec
            .args
            .last()
            .expect("store uri")
            .starts_with("surrealkv://"));
        assert!(spec
            .env
            .iter()
            .any(|(k, v)| k == "SURREAL_HTTP_MAX_SQL_BODY_SIZE" && v == "64MiB"));
    }
}
