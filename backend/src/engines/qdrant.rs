use std::fs;
use std::path::{Path, PathBuf};

use async_trait::async_trait;

use crate::db::models::InstanceRecord;
use crate::engines::{connect_host, EngineError, EngineProvider, HealthCheckKind, LaunchSpec};

pub struct QdrantProvider;

fn yaml_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[async_trait]
impl EngineProvider for QdrantProvider {
    fn engine_type(&self) -> &'static str {
        "qdrant"
    }

    fn default_port(&self) -> u16 {
        6333
    }

    fn default_grpc_port(&self) -> Option<u16> {
        Some(6334)
    }

    fn prepare_instance(
        &self,
        instance: &InstanceRecord,
        instance_root: &Path,
        binary_path: &Path,
    ) -> Result<LaunchSpec, EngineError> {
        let config_dir = instance_root.join("config");
        let data_dir = PathBuf::from(&instance.data_dir);
        let snapshots_dir = instance_root.join("snapshots");
        let logs_dir = instance_root.join("logs");

        fs::create_dir_all(&config_dir)?;
        fs::create_dir_all(&data_dir)?;
        fs::create_dir_all(&snapshots_dir)?;
        fs::create_dir_all(&logs_dir)?;

        let overrides: serde_json::Value =
            serde_json::from_str(&instance.config_json).unwrap_or(serde_json::Value::Null);
        let log_level = overrides
            .get("log_level")
            .and_then(|v| v.as_str())
            .unwrap_or("INFO");
        let enable_cors = overrides
            .get("enable_cors")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let grpc_port = instance.grpc_port.unwrap_or(instance.port.saturating_add(1));

        let config_yaml = format!(
            "log_level: {log_level}\n\
             storage:\n\
               storage_path: \"{storage_path}\"\n\
               snapshots_path: \"{snapshots_path}\"\n\
             service:\n\
               host: \"{host}\"\n\
               http_port: {http_port}\n\
               grpc_port: {grpc_port}\n\
               enable_cors: {enable_cors}\n\
             telemetry_disabled: true\n",
            log_level = log_level,
            storage_path = yaml_path(&data_dir),
            snapshots_path = yaml_path(&snapshots_dir),
            host = instance.host,
            http_port = instance.port,
            grpc_port = grpc_port,
            enable_cors = enable_cors,
        );

        let config_path = config_dir.join("config.yaml");
        fs::write(&config_path, config_yaml)?;

        let check_host = connect_host(&instance.host);
        Ok(LaunchSpec {
            program: binary_path.to_path_buf(),
            args: vec![
                "--config-path".to_string(),
                config_path.to_string_lossy().into_owned(),
            ],
            cwd: instance_root.to_path_buf(),
            env: Vec::new(),
            health: HealthCheckKind::HttpGet {
                url: format!("http://{}:{}/healthz", check_host, instance.port),
                fallback_url: None,
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_qdrant_yaml_and_launch_spec() {
        let dir = tempfile::tempdir().expect("temp dir");
        let inst = InstanceRecord {
            id: "inst-1".to_string(),
            name: "Local Qdrant".to_string(),
            description: None,
            color: None,
            group_id: None,
            engine_type: "qdrant".to_string(),
            engine_version: "1.20.2".to_string(),
            host: "127.0.0.1".to_string(),
            port: 6333,
            grpc_port: Some(6334),
            data_dir: dir.path().join("data").to_string_lossy().into_owned(),
            config_json: r#"{"log_level":"WARN"}"#.to_string(),
            auto_start: false,
            idle_timeout_minutes: 0,
            sort_order: 0,
            created_at: 0,
            tag_ids: Vec::new(),
        };

        let provider = QdrantProvider;
        let spec = provider
            .prepare_instance(&inst, dir.path(), Path::new("C:/bin/qdrant.exe"))
            .expect("prepare qdrant");

        assert_eq!(spec.args[0], "--config-path");
        let yaml = fs::read_to_string(dir.path().join("config").join("config.yaml"))
            .expect("read config.yaml");
        assert!(yaml.contains("http_port: 6333"));
        assert!(yaml.contains("grpc_port: 6334"));
        assert!(yaml.contains("log_level: WARN"));
        assert!(yaml.contains("telemetry_disabled: true"));
        assert!(!yaml.contains('\\'));
    }
}
