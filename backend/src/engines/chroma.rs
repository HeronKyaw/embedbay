use std::fs;
use std::path::{Path, PathBuf};

use async_trait::async_trait;

use crate::db::models::InstanceRecord;
use crate::engines::{connect_host, EngineError, EngineProvider, HealthCheckKind, LaunchSpec};

pub struct ChromaProvider;

#[async_trait]
impl EngineProvider for ChromaProvider {
    fn engine_type(&self) -> &'static str {
        "chroma"
    }

    fn default_port(&self) -> u16 {
        8000
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

        let config_snapshot = serde_json::json!({
            "host": instance.host,
            "port": instance.port,
            "data_dir": data_dir.to_string_lossy(),
            "telemetry": false,
        });
        fs::write(
            config_dir.join("chroma.json"),
            serde_json::to_string_pretty(&config_snapshot).unwrap_or_default(),
        )?;

        let args = vec![
            "run".to_string(),
            "--path".to_string(),
            data_dir.to_string_lossy().into_owned(),
            "--host".to_string(),
            instance.host.clone(),
            "--port".to_string(),
            instance.port.to_string(),
        ];

        let check_host = connect_host(&instance.host);
        Ok(LaunchSpec {
            program: binary_path.to_path_buf(),
            args,
            cwd: instance_root.to_path_buf(),
            env: vec![("ANONYMIZED_TELEMETRY".to_string(), "FALSE".to_string())],
            health: HealthCheckKind::HttpGet {
                url: format!("http://{}:{}/api/v2/heartbeat", check_host, instance.port),
                fallback_url: Some(format!(
                    "http://{}:{}/api/v1/heartbeat",
                    check_host, instance.port
                )),
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_chroma_run_args_and_heartbeat_urls() {
        let dir = tempfile::tempdir().expect("temp dir");
        let data_dir = dir.path().join("data");
        let inst = InstanceRecord {
            id: "inst-c1".to_string(),
            name: "Local Chroma".to_string(),
            description: None,
            color: None,
            group_id: None,
            engine_type: "chroma".to_string(),
            engine_version: "1.4.4".to_string(),
            host: "127.0.0.1".to_string(),
            port: 8000,
            grpc_port: None,
            data_dir: data_dir.to_string_lossy().into_owned(),
            config_json: "{}".to_string(),
            auto_start: false,
            idle_timeout_minutes: 0,
            sort_order: 0,
            created_at: 0,
            tag_ids: Vec::new(),
        };

        let spec = ChromaProvider
            .prepare_instance(&inst, dir.path(), Path::new("C:/bin/chroma.exe"))
            .expect("prepare chroma");
        assert_eq!(spec.args[0], "run");
        assert_eq!(spec.args[1], "--path");
        assert_eq!(spec.args[3], "--host");
        assert_eq!(spec.args[4], "127.0.0.1");
        assert_eq!(spec.args[5], "--port");
        assert_eq!(spec.args[6], "8000");
        assert!(dir.path().join("config").join("chroma.json").is_file());
    }
}
