use std::fs;
use std::path::{Path, PathBuf};

use async_trait::async_trait;

use crate::db::models::InstanceRecord;
use crate::engines::{EngineError, EngineProvider, HealthCheckKind, LaunchSpec};

pub struct LanceDbProvider;

#[async_trait]
impl EngineProvider for LanceDbProvider {
    fn engine_type(&self) -> &'static str {
        "lancedb"
    }

    fn default_port(&self) -> u16 {
        0
    }

    fn default_grpc_port(&self) -> Option<u16> {
        None
    }

    fn is_embedded(&self) -> bool {
        true
    }

    fn prepare_instance(
        &self,
        instance: &InstanceRecord,
        instance_root: &Path,
        _binary_path: &Path,
    ) -> Result<LaunchSpec, EngineError> {
        let data_dir = PathBuf::from(&instance.data_dir);
        fs::create_dir_all(&data_dir)?;
        Ok(LaunchSpec {
            program: PathBuf::from("embedded"),
            args: Vec::new(),
            cwd: instance_root.to_path_buf(),
            env: Vec::new(),
            health: HealthCheckKind::None,
        })
    }
}
