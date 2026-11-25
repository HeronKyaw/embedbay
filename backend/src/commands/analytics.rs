use crate::analytics::projection::{compute_projection, ProjectionMethod, ProjectionResult};

#[tauri::command]
pub async fn compute_embedding_projection(
    vectors: Vec<Vec<f32>>,
    method: ProjectionMethod,
    dims: usize,
) -> Result<ProjectionResult, String> {
    tokio::task::spawn_blocking(move || compute_projection(&vectors, method, dims))
        .await
        .map_err(|e| format!("Projection worker panicked: {}", e))?
}
