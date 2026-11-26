use std::fs;
use std::path::{Path, PathBuf};

use async_trait::async_trait;

use crate::db::models::InstanceRecord;
use crate::engines::{connect_host, EngineError, EngineProvider, HealthCheckKind, LaunchSpec};

pub struct MeilisearchProvider;

#[async_trait]
impl EngineProvider for MeilisearchProvider {
    fn engine_type(&self) -> &'static str {
        "meilisearch"
    }

    fn default_port(&self) -> u16 {
        7700
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

        let mut args = vec![
            "--http-addr".to_string(),
            format!("{}:{}", instance.host, instance.port),
            "--db-path".to_string(),
            data_dir.to_string_lossy().into_owned(),
            "--env".to_string(),
            "development".to_string(),
            "--no-analytics".to_string(),
        ];

        if let Some(master_key) = overrides
            .get("master_key")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            args.push("--master-key".to_string());
            args.push(master_key.to_string());
        }
        if let Some(mem) = overrides
            .get("max_indexing_memory")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            args.push("--max-indexing-memory".to_string());
            args.push(mem.to_string());
        }

        let check_host = connect_host(&instance.host);
        Ok(LaunchSpec {
            program: binary_path.to_path_buf(),
            args,
            cwd: instance_root.to_path_buf(),
            env: Vec::new(),
            health: HealthCheckKind::HttpGet {
                url: format!("http://{}:{}/health", check_host, instance.port),
                fallback_url: None,
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_meilisearch_launch_args() {
        let dir = tempfile::tempdir().expect("temp dir");
        let inst = InstanceRecord {
            id: "ms-1".to_string(),
            name: "Local Meilisearch".to_string(),
            description: None,
            color: None,
            group_id: None,
            engine_type: "meilisearch".to_string(),
            engine_version: "1.35.0".to_string(),
            host: "127.0.0.1".to_string(),
            port: 7700,
            grpc_port: None,
            data_dir: dir.path().join("data").to_string_lossy().into_owned(),
            config_json: r#"{"master_key":"dev-secret"}"#.to_string(),
            auto_start: false,
            idle_timeout_minutes: 0,
            sort_order: 0,
            created_at: 0,
            tag_ids: Vec::new(),
        };

        let spec = MeilisearchProvider
            .prepare_instance(&inst, dir.path(), Path::new("C:/bin/meilisearch.exe"))
            .expect("prepare meilisearch");
        assert_eq!(spec.args[0], "--http-addr");
        assert_eq!(spec.args[1], "127.0.0.1:7700");
        assert!(spec.args.contains(&"--no-analytics".to_string()));
        assert!(spec.args.contains(&"--master-key".to_string()));
        assert!(spec.args.contains(&"dev-secret".to_string()));
    }
}
