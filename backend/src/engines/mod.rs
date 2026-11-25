pub mod chroma;
pub mod installer;
pub mod lancedb;
pub mod manifest;
pub mod pgvector;
pub mod qdrant;

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use thiserror::Error;

use crate::db::models::InstanceRecord;
use crate::platform;

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("unsupported engine type: {0}")]
    UnsupportedEngine(String),
    #[error("engine configuration error: {0}")]
    Config(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("process stop error: {0}")]
    Stop(String),
}

#[derive(Debug, Clone)]
pub enum HealthCheckKind {
    HttpGet {
        url: String,
        fallback_url: Option<String>,
    },
    TcpConnect {
        host: String,
        port: u16,
    },
    None,
}

#[derive(Debug, Clone)]
pub struct LaunchSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: Vec<(String, String)>,
    pub health: HealthCheckKind,
}

#[async_trait]
pub trait EngineProvider: Send + Sync {
    fn engine_type(&self) -> &'static str;
    fn default_port(&self) -> u16;
    fn default_grpc_port(&self) -> Option<u16>;
    fn is_embedded(&self) -> bool {
        false
    }

    fn prepare_instance(
        &self,
        instance: &InstanceRecord,
        instance_root: &Path,
        binary_path: &Path,
    ) -> Result<LaunchSpec, EngineError>;

    async fn post_start_init(
        &self,
        _instance: &InstanceRecord,
        _binary_path: &Path,
    ) -> Result<(), EngineError> {
        Ok(())
    }

    async fn graceful_stop(
        &self,
        _instance: &InstanceRecord,
        pid: u32,
        _binary_path: &Path,
    ) -> Result<(), EngineError> {
        platform::graceful_stop_process(pid).map_err(EngineError::Stop)
    }
}

pub fn connect_host(bind_host: &str) -> &str {
    match bind_host.trim() {
        "" | "0.0.0.0" | "::" | "[::]" => "127.0.0.1",
        other => other,
    }
}

pub fn get_provider(engine_type: &str) -> Result<Box<dyn EngineProvider>, EngineError> {
    match engine_type {
        "qdrant" => Ok(Box::new(qdrant::QdrantProvider)),
        "chroma" => Ok(Box::new(chroma::ChromaProvider)),
        "pgvector" => Ok(Box::new(pgvector::PgVectorProvider)),
        "lancedb" => Ok(Box::new(lancedb::LanceDbProvider)),
        other => Err(EngineError::UnsupportedEngine(other.to_string())),
    }
}
