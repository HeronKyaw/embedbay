use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

use crate::db::Database;

const BUNDLED_MANIFEST_JSON: &str = include_str!("../../../manifests/engines.json");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ArchiveType {
    Zip,
    TarGz,
    Binary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtraArchiveSpec {
    pub url: String,
    pub sha256: String,
    #[serde(default)]
    pub size_bytes: u64,
    pub archive_type: ArchiveType,
    #[serde(default)]
    pub dest_subdir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineTargetArtifact {
    pub url: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub archive_type: ArchiveType,
    pub binary_rel_path: String,
    #[serde(default)]
    pub extra_archives: Vec<ExtraArchiveSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineVersionEntry {
    pub version: String,
    #[serde(default)]
    pub recommended: bool,
    pub targets: HashMap<String, EngineTargetArtifact>,
}

fn default_runtime_kind() -> String {
    "native".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineCatalogEntry {
    pub engine_type: String,
    pub display_name: String,
    pub description: String,
    pub tier: u8,
    #[serde(default)]
    pub embedded: bool,
    #[serde(default = "default_runtime_kind")]
    pub runtime_kind: String,
    #[serde(default)]
    pub ram_hint: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub install_notice: Option<String>,
    pub default_port: u16,
    #[serde(default)]
    pub default_grpc_port: Option<u16>,
    pub versions: Vec<EngineVersionEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineManifest {
    pub schema_version: u32,
    pub updated_at: String,
    pub engines: Vec<EngineCatalogEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CatalogVersionView {
    pub version: String,
    pub recommended: bool,
    pub size_bytes: u64,
    pub sha256: String,
    pub archive_type: ArchiveType,
    pub installed: bool,
    pub installed_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CatalogEngineView {
    pub engine_type: String,
    pub display_name: String,
    pub description: String,
    pub tier: u8,
    pub embedded: bool,
    pub runtime_kind: String,
    pub ram_hint: Option<String>,
    pub category: Option<String>,
    pub install_notice: Option<String>,
    pub default_port: u16,
    pub default_grpc_port: Option<u16>,
    pub versions: Vec<CatalogVersionView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ManifestDiagnostics {
    pub path: String,
    pub schema_version: u32,
    pub updated_at: String,
    pub engine_count: usize,
}

pub struct ManifestService {
    manifest_path: PathBuf,
    manifest: RwLock<EngineManifest>,
}

impl ManifestService {
    pub fn load_or_init(data_root: &Path) -> Result<Self, String> {
        let bundled: EngineManifest = serde_json::from_str(BUNDLED_MANIFEST_JSON)
            .map_err(|e| format!("Invalid bundled engines manifest: {}", e))?;

        let manifest_path = data_root.join("manifest.json");
        let active = if manifest_path.exists() {
            match std::fs::read_to_string(&manifest_path)
                .ok()
                .and_then(|raw| serde_json::from_str::<EngineManifest>(&raw).ok())
            {
                Some(cached)
                    if cached.schema_version > bundled.schema_version
                        || (cached.schema_version == bundled.schema_version
                            && cached.updated_at > bundled.updated_at) =>
                {
                    cached
                }
                _ => {
                    let _ = std::fs::write(&manifest_path, BUNDLED_MANIFEST_JSON);
                    bundled
                }
            }
        } else {
            let _ = std::fs::write(&manifest_path, BUNDLED_MANIFEST_JSON);
            bundled
        };

        Ok(Self {
            manifest_path,
            manifest: RwLock::new(active),
        })
    }

    pub fn manifest_path(&self) -> &Path {
        &self.manifest_path
    }

    pub fn diagnostics_info(&self) -> Result<ManifestDiagnostics, String> {
        let guard = self
            .manifest
            .read()
            .map_err(|_| "Manifest lock poisoned".to_string())?;
        Ok(ManifestDiagnostics {
            path: self.manifest_path.to_string_lossy().into_owned(),
            schema_version: guard.schema_version,
            updated_at: guard.updated_at.clone(),
            engine_count: guard.engines.len(),
        })
    }

    pub fn find_artifact(
        &self,
        engine_type: &str,
        version: &str,
        target_triple: &str,
    ) -> Result<(EngineCatalogEntry, EngineTargetArtifact), String> {
        let guard = self
            .manifest
            .read()
            .map_err(|_| "Manifest lock poisoned".to_string())?;
        let engine = guard
            .engines
            .iter()
            .find(|e| e.engine_type == engine_type)
            .cloned()
            .ok_or_else(|| format!("Engine '{}' not found in catalog", engine_type))?;

        let ver = engine
            .versions
            .iter()
            .find(|v| v.version == version)
            .ok_or_else(|| {
                format!(
                    "Version '{}' for engine '{}' not found in catalog",
                    version, engine_type
                )
            })?;

        let target_key = if engine.embedded && !ver.targets.contains_key(target_triple) {
            ver.targets
                .get("universal")
                .cloned()
                .ok_or_else(|| format!("No embedded artifact for '{}'", engine_type))?
        } else {
            ver.targets
                .get(target_triple)
                .cloned()
                .ok_or_else(|| {
                    format!(
                        "Engine '{}' v{} has no release artifact for target '{}'",
                        engine_type, version, target_triple
                    )
                })?
        };

        Ok((engine, target_key))
    }

    pub fn catalog_for_target(
        &self,
        target_triple: &str,
        db: &Database,
    ) -> Result<Vec<CatalogEngineView>, String> {
        let installed = db.list_installed_engines().map_err(|e| e.to_string())?;
        let guard = self
            .manifest
            .read()
            .map_err(|_| "Manifest lock poisoned".to_string())?;

        let mut out = Vec::new();
        for engine in &guard.engines {
            let mut versions = Vec::new();
            for ver in &engine.versions {
                let artifact = ver
                    .targets
                    .get(target_triple)
                    .or_else(|| if engine.embedded { ver.targets.get("universal") } else { None });
                let Some(art) = artifact else {
                    continue;
                };
                let inst_match = installed
                    .iter()
                    .find(|i| i.engine_type == engine.engine_type && i.version == ver.version);
                versions.push(CatalogVersionView {
                    version: ver.version.clone(),
                    recommended: ver.recommended,
                    size_bytes: art.size_bytes,
                    sha256: art.sha256.clone(),
                    archive_type: art.archive_type.clone(),
                    installed: inst_match.is_some(),
                    installed_id: inst_match.map(|m| m.id.clone()),
                });
            }

            if !versions.is_empty() {
                out.push(CatalogEngineView {
                    engine_type: engine.engine_type.clone(),
                    display_name: engine.display_name.clone(),
                    description: engine.description.clone(),
                    tier: engine.tier,
                    embedded: engine.embedded,
                    runtime_kind: engine.runtime_kind.clone(),
                    ram_hint: engine.ram_hint.clone(),
                    category: engine.category.clone(),
                    install_notice: engine.install_notice.clone(),
                    default_port: engine.default_port,
                    default_grpc_port: engine.default_grpc_port,
                    versions,
                });
            }
        }
        Ok(out)
    }

    #[cfg(test)]
    pub fn from_manifest_for_test(manifest_path: PathBuf, manifest: EngineManifest) -> Self {
        Self {
            manifest_path,
            manifest: RwLock::new(manifest),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_manifest_contains_valid_windows_entries() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Database::init(dir.path().to_path_buf()).expect("db init");
        let service = ManifestService::load_or_init(dir.path()).expect("load manifest");
        assert!(service.manifest_path().exists());

        let catalog = service
            .catalog_for_target("x86_64-pc-windows-msvc", &db)
            .expect("catalog for windows");
        let qdrant = catalog
            .iter()
            .find(|e| e.engine_type == "qdrant")
            .expect("qdrant entry");
        let chroma = catalog
            .iter()
            .find(|e| e.engine_type == "chroma")
            .expect("chroma entry");

        assert!(!qdrant.versions.is_empty());
        assert!(!chroma.versions.is_empty());
        assert!(qdrant.versions[0].sha256.len() == 64);
        assert!(chroma.versions[0].sha256.len() == 64);

        for expected in [
            "qdrant",
            "chroma",
            "pgvector",
            "lancedb",
            "elasticsearch",
            "meilisearch",
            "surrealdb",
            "sqlite_vec",
            "opensearch",
            "mariadb",
            "duckdb",
        ] {
            let entry = catalog
                .iter()
                .find(|e| e.engine_type == expected)
                .unwrap_or_else(|| panic!("missing engine '{}' in Windows catalog", expected));
            assert!(!entry.versions.is_empty());
            assert!(matches!(
                entry.runtime_kind.as_str(),
                "native" | "embedded" | "sql_portable" | "jvm"
            ));
        }

        let es = catalog
            .iter()
            .find(|e| e.engine_type == "elasticsearch")
            .expect("es");
        let os = catalog
            .iter()
            .find(|e| e.engine_type == "opensearch")
            .expect("os");
        assert!(es.install_notice.is_some());
        assert!(os.install_notice.is_some());

        let bundled: EngineManifest =
            serde_json::from_str(BUNDLED_MANIFEST_JSON).expect("parse bundled manifest");
        for engine in &bundled.engines {
            for ver in &engine.versions {
                for (target_name, target) in &ver.targets {
                    if target.url == "embedded://local" {
                        continue;
                    }
                    assert!(
                        target.url.starts_with("https://"),
                        "{}@{} [{}] url must use https:// (got {})",
                        engine.engine_type,
                        ver.version,
                        target_name,
                        target.url
                    );
                    assert!(
                        target.sha256.len() == 64
                            && target.sha256.chars().all(|c| c.is_ascii_hexdigit()),
                        "{}@{} [{}] must have a valid 64-char hex sha256 (got '{}')",
                        engine.engine_type,
                        ver.version,
                        target_name,
                        target.sha256
                    );
                    assert!(
                        target.size_bytes > 0,
                        "{}@{} [{}] must have size_bytes > 0",
                        engine.engine_type,
                        ver.version,
                        target_name
                    );
                    for (idx, extra) in target.extra_archives.iter().enumerate() {
                        assert!(
                            extra.url.starts_with("https://"),
                            "{}@{} [{}] extra[{}] url must use https:// (got {})",
                            engine.engine_type,
                            ver.version,
                            target_name,
                            idx,
                            extra.url
                        );
                        assert!(
                            extra.sha256.len() == 64
                                && extra.sha256.chars().all(|c| c.is_ascii_hexdigit()),
                            "{}@{} [{}] extra[{}] must have a valid 64-char hex sha256",
                            engine.engine_type,
                            ver.version,
                            target_name,
                            idx
                        );
                        assert!(
                            extra.size_bytes > 0,
                            "{}@{} [{}] extra[{}] must have size_bytes > 0",
                            engine.engine_type,
                            ver.version,
                            target_name,
                            idx
                        );
                    }
                }
            }
        }
    }
}
