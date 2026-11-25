import { invoke } from "@tauri-apps/api/core";

export type ProjectionMethod = "pca" | "umap";

export interface ProjectionResult {
  coords: Array<[number, number, number]>;
  dims: number;
  method: string;
  elapsed_ms: number;
  explained_variance: number[];
}

export async function computeEmbeddingProjection(
  vectors: number[][],
  method: ProjectionMethod,
  dims: 2 | 3,
): Promise<ProjectionResult> {
  return invoke<ProjectionResult>("compute_embedding_projection", {
    vectors,
    method,
    dims,
  });
}
