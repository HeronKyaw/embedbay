use std::fs;
use std::path::{Path, PathBuf};

use async_trait::async_trait;

use crate::db::models::InstanceRecord;
use crate::engines::{connect_host, EngineError, EngineProvider, HealthCheckKind, LaunchSpec};

pub struct OpenSearchProvider;

fn yaml_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn copy_dir_if_exists(src: &Path, dst: &Path) -> Result<(), EngineError> {
    if !src.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_if_exists(&src_path, &dst_path)?;
        } else if !dst_path.exists() {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

fn seed_baseline_config(os_home: &Path, config_dir: &Path) -> Result<(), EngineError> {
    let src_cfg = os_home.join("config");
    for file_name in ["jvm.options", "log4j2.properties"] {
        let src = src_cfg.join(file_name);
        let dst = config_dir.join(file_name);
        if src.is_file() && !dst.exists() {
            fs::copy(&src, &dst)?;
        }
    }
    copy_dir_if_exists(&src_cfg.join("jvm.options.d"), &config_dir.join("jvm.options.d"))?;
    Ok(())
}

fn is_windows_batch(binary_path: &Path) -> bool {
    binary_path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("bat") || e.eq_ignore_ascii_case("cmd"))
}

#[async_trait]
impl EngineProvider for OpenSearchProvider {
    fn engine_type(&self) -> &'static str {
        "opensearch"
    }

    fn default_port(&self) -> u16 {
        9201
    }

    fn default_grpc_port(&self) -> Option<u16> {
        None
    }

    fn startup_timeout_secs(&self) -> u64 {
        90
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

        let os_home = binary_path
            .parent()
            .and_then(|p| p.parent())
            .unwrap_or(instance_root);
        seed_baseline_config(os_home, &config_dir)?;

        let overrides: serde_json::Value =
            serde_json::from_str(&instance.config_json).unwrap_or(serde_json::Value::Null);
        let heap_mb = overrides
            .get("heap_mb")
            .and_then(|v| v.as_u64())
            .unwrap_or(1024)
            .clamp(256, 8192);
        let min_heap_mb = (heap_mb / 2).max(256);

        let cluster_name = format!("embedbay-os-{}", instance.id);
        let config_yml = format!(
            concat!(
                "# Managed by EmbedBay\n",
                "cluster.name: \"{cluster_name}\"\n",
                "node.name: \"node-1\"\n",
                "discovery.type: single-node\n",
                "network.host: \"{host}\"\n",
                "http.port: {port}\n",
                "transport.port: 0\n",
                "path.data: \"{data_path}\"\n",
                "path.logs: \"{logs_path}\"\n",
                "plugins.security.disabled: true\n",
            ),
            cluster_name = cluster_name,
            host = instance.host,
            port = instance.port,
            data_path = yaml_path(&data_dir),
            logs_path = yaml_path(&logs_dir),
        );
        fs::write(config_dir.join("opensearch.yml"), config_yml)?;

        let (program, args) = if is_windows_batch(binary_path) {
            (
                PathBuf::from("cmd.exe"),
                vec![
                    "/C".to_string(),
                    binary_path.to_string_lossy().into_owned(),
                ],
            )
        } else {
            (binary_path.to_path_buf(), Vec::new())
        };

        let check_host = connect_host(&instance.host);
        Ok(LaunchSpec {
            program,
            args,
            cwd: os_home.to_path_buf(),
            env: vec![
                (
                    "OPENSEARCH_PATH_CONF".to_string(),
                    config_dir.to_string_lossy().into_owned(),
                ),
                (
                    "OPENSEARCH_JAVA_OPTS".to_string(),
                    format!("-Xms{}m -Xmx{}m", min_heap_mb, heap_mb),
                ),
            ],
            health: HealthCheckKind::HttpGet {
                url: format!("http://{}:{}/_cluster/health", check_host, instance.port),
                fallback_url: Some(format!("http://{}:{}/", check_host, instance.port)),
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_opensearch_yml_and_jvm_env() {
        let dir = tempfile::tempdir().expect("temp dir");
        let os_home = dir.path().join("os-home");
        fs::create_dir_all(os_home.join("bin")).expect("mkdir bin");
        fs::create_dir_all(os_home.join("config")).expect("mkdir cfg");
        fs::write(os_home.join("config").join("jvm.options"), "-XX:+UseG1GC\n").expect("jvm");
        fs::write(os_home.join("config").join("log4j2.properties"), "status = error\n")
            .expect("log4j2");
        let bat = os_home.join("bin").join("opensearch.bat");
        fs::write(&bat, "@echo off\n").expect("bat");

        let inst_root = dir.path().join("inst");
        let inst = InstanceRecord {
            id: "os-1".to_string(),
            name: "Local OpenSearch".to_string(),
            description: None,
            color: None,
            group_id: None,
            engine_type: "opensearch".to_string(),
            engine_version: "3.10.0".to_string(),
            host: "127.0.0.1".to_string(),
            port: 9201,
            grpc_port: None,
            data_dir: inst_root.join("data").to_string_lossy().into_owned(),
            config_json: r#"{"heap_mb": 1024}"#.to_string(),
            auto_start: false,
            idle_timeout_minutes: 0,
            sort_order: 0,
            created_at: 0,
            tag_ids: Vec::new(),
        };

        let spec = OpenSearchProvider
            .prepare_instance(&inst, &inst_root, &bat)
            .expect("prepare os");
        assert_eq!(spec.program, PathBuf::from("cmd.exe"));
        assert!(spec
            .env
            .iter()
            .any(|(k, v)| k == "OPENSEARCH_JAVA_OPTS" && v == "-Xms512m -Xmx1024m"));
        let yml = fs::read_to_string(inst_root.join("config").join("opensearch.yml"))
            .expect("read yml");
        assert!(yml.contains("plugins.security.disabled: true"));
        assert!(yml.contains("http.port: 9201"));
    }
}
