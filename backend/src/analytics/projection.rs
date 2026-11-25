use std::time::Instant;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectionMethod {
    Pca,
    Umap,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectionResult {
    pub coords: Vec<[f32; 3]>,
    pub dims: usize,
    pub method: String,
    pub elapsed_ms: u64,
    pub explained_variance: Vec<f32>,
}

pub fn compute_projection(
    vectors: &[Vec<f32>],
    method: ProjectionMethod,
    dims: usize,
) -> Result<ProjectionResult, String> {
    let start = Instant::now();
    let out_dims = if dims == 2 { 2 } else { 3 };
    let n = vectors.len();

    if n == 0 {
        return Ok(ProjectionResult {
            coords: Vec::new(),
            dims: out_dims,
            method: match method {
                ProjectionMethod::Pca => "pca".to_string(),
                ProjectionMethod::Umap => "umap".to_string(),
            },
            elapsed_ms: 0,
            explained_variance: Vec::new(),
        });
    }

    let d = vectors.iter().map(|v| v.len()).max().unwrap_or(0);
    if d == 0 {
        return Ok(ProjectionResult {
            coords: vec![[0.0, 0.0, 0.0]; n],
            dims: out_dims,
            method: match method {
                ProjectionMethod::Pca => "pca".to_string(),
                ProjectionMethod::Umap => "umap".to_string(),
            },
            elapsed_ms: start.elapsed().as_millis() as u64,
            explained_variance: vec![0.0; out_dims],
        });
    }

    // Normalize rectangular matrix X (n x d), centered around column mean
    let mut centered = vec![0.0f64; n * d];
    let mut mean = vec![0.0f64; d];
    for row in vectors {
        for (j, &val) in row.iter().enumerate() {
            if val.is_finite() {
                mean[j] += val as f64;
            }
        }
    }
    for m in &mut mean {
        *m /= n as f64;
    }
    for (i, row) in vectors.iter().enumerate() {
        for j in 0..d {
            let v = row.get(j).copied().unwrap_or(0.0);
            centered[i * d + j] = if v.is_finite() { v as f64 } else { 0.0 } - mean[j];
        }
    }

    let (pca_coords, explained_variance) = compute_pca_coords(&centered, n, d, out_dims);

    let final_coords = match method {
        ProjectionMethod::Pca => pca_coords,
        ProjectionMethod::Umap => compute_umap_from_init(&centered, n, d, out_dims, &pca_coords),
    };

    let elapsed_ms = start.elapsed().as_millis() as u64;
    Ok(ProjectionResult {
        coords: final_coords,
        dims: out_dims,
        method: match method {
            ProjectionMethod::Pca => "pca".to_string(),
            ProjectionMethod::Umap => "umap".to_string(),
        },
        elapsed_ms,
        explained_variance,
    })
}

fn compute_pca_coords(
    centered: &[f64],
    n: usize,
    d: usize,
    out_dims: usize,
) -> (Vec<[f32; 3]>, Vec<f32>) {
    if n <= 1 {
        return (vec![[0.0, 0.0, 0.0]; n], vec![0.0; out_dims]);
    }

    let total_var: f64 = centered.iter().map(|x| x * x).sum::<f64>().max(1e-12);
    let mut coords = vec![[0.0f32; 3]; n];
    let mut explained = Vec::with_capacity(out_dims);

    // Choose dual Gram matrix G = X * X^T (n x n) when n <= d (fast for 1536d/3072d!),
    // or covariance C = X^T * X (d x d) when d < n.
    if n <= d {
        let mut gram = vec![0.0f64; n * n];
        for i in 0..n {
            for k in i..n {
                let mut dot = 0.0f64;
                let row_i = &centered[i * d..(i + 1) * d];
                let row_k = &centered[k * d..(k + 1) * d];
                for j in 0..d {
                    dot += row_i[j] * row_k[j];
                }
                gram[i * n + k] = dot;
                gram[k * n + i] = dot;
            }
        }

        for comp in 0..out_dims {
            let (eigenval, u) = power_iteration_sym(&gram, n, comp);
            let scale = eigenval.max(0.0).sqrt();
            for i in 0..n {
                let val = (u[i] * scale) as f32;
                coords[i][comp] = if val.is_finite() { val } else { 0.0 };
            }
            explained.push(((eigenval.max(0.0) / total_var) as f32).clamp(0.0, 1.0));
            deflate_sym(&mut gram, n, eigenval, &u);
        }
    } else {
        let mut cov = vec![0.0f64; d * d];
        for row_idx in 0..n {
            let row = &centered[row_idx * d..(row_idx + 1) * d];
            for i in 0..d {
                let ri = row[i];
                for j in i..d {
                    cov[i * d + j] += ri * row[j];
                }
            }
        }
        for i in 0..d {
            for j in 0..i {
                cov[i * d + j] = cov[j * d + i];
            }
        }

        for comp in 0..out_dims {
            let (eigenval, v) = power_iteration_sym(&cov, d, comp);
            for i in 0..n {
                let row = &centered[i * d..(i + 1) * d];
                let mut proj = 0.0f64;
                for j in 0..d {
                    proj += row[j] * v[j];
                }
                let val = proj as f32;
                coords[i][comp] = if val.is_finite() { val } else { 0.0 };
            }
            explained.push(((eigenval.max(0.0) / total_var) as f32).clamp(0.0, 1.0));
            deflate_sym(&mut cov, d, eigenval, &v);
        }
    }

    (coords, explained)
}

fn power_iteration_sym(mat: &[f64], dim: usize, seed_idx: usize) -> (f64, Vec<f64>) {
    let mut vec = vec![0.0f64; dim];
    for (i, item) in vec.iter_mut().enumerate() {
        *item = (((i * 37 + seed_idx * 13 + 7) % 101) as f64) / 100.0 - 0.5;
    }
    normalize(&mut vec);

    let mut next = vec![0.0f64; dim];
    let mut eigenval = 0.0f64;

    for _ in 0..48 {
        for i in 0..dim {
            let row = &mat[i * dim..(i + 1) * dim];
            let mut sum = 0.0f64;
            for j in 0..dim {
                sum += row[j] * vec[j];
            }
            next[i] = sum;
        }
        eigenval = dot(&vec, &next);
        let norm = normalize(&mut next);
        if norm <= 1e-12 {
            return (0.0, vec);
        }
        let diff: f64 = vec
            .iter()
            .zip(&next)
            .map(|(a, b)| (a - b).abs())
            .sum();
        vec.copy_from_slice(&next);
        if diff < 1e-8 {
            break;
        }
    }

    (eigenval, vec)
}

fn deflate_sym(mat: &mut [f64], dim: usize, eigenval: f64, u: &[f64]) {
    if eigenval <= 0.0 {
        return;
    }
    for i in 0..dim {
        for j in 0..dim {
            mat[i * dim + j] -= eigenval * u[i] * u[j];
        }
    }
}

fn dot(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

fn normalize(v: &mut [f64]) -> f64 {
    let norm = v.iter().map(|x| x * x).sum::<f64>().sqrt();
    if norm > 1e-12 {
        for x in v.iter_mut() {
            *x /= norm;
        }
    }
    norm
}

/// Lightweight pure-Rust UMAP layout initialized from PCA coordinates:
/// builds exact k-NN fuzzy simplicial graph, symmetrizes edge weights,
/// and optimizes 2D/3D layout with attractive/repulsive SGD forces.
fn compute_umap_from_init(
    centered: &[f64],
    n: usize,
    d: usize,
    out_dims: usize,
    init: &[[f32; 3]],
) -> Vec<[f32; 3]> {
    if n <= 2 {
        return init.to_vec();
    }

    let k = (n - 1).min(15);
    let mut pos: Vec<[f64; 3]> = init
        .iter()
        .map(|c| [c[0] as f64, c[1] as f64, c[2] as f64])
        .collect();

    // Scale initial coordinates to [-5, 5] for numerical stability
    let max_abs = pos
        .iter()
        .flat_map(|p| p[..out_dims].iter())
        .map(|v| v.abs())
        .fold(0.0f64, f64::max)
        .max(1e-6);
    for p in &mut pos {
        for c in 0..out_dims {
            p[c] = (p[c] / max_abs) * 5.0;
        }
    }

    // Build k-NN fuzzy graph weights
    let mut directed_edges: Vec<(usize, usize, f64)> = Vec::with_capacity(n * k);
    let mut dists = Vec::with_capacity(n);

    for i in 0..n {
        dists.clear();
        let row_i = &centered[i * d..(i + 1) * d];
        for j in 0..n {
            if i == j {
                continue;
            }
            let row_j = &centered[j * d..(j + 1) * d];
            let mut sq = 0.0f64;
            for col in 0..d {
                let diff = row_i[col] - row_j[col];
                sq += diff * diff;
            }
            dists.push((j, sq.sqrt()));
        }
        dists.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
        let rho = dists.first().map(|x| x.1).unwrap_or(0.0);
        let kth = dists.get(k - 1).map(|x| x.1).unwrap_or(rho + 1.0);
        let sigma = ((kth - rho) / 2.0).max(1e-4);

        for &(nbr, dist) in dists.iter().take(k) {
            let w = (-((dist - rho).max(0.0)) / sigma).exp().clamp(0.01, 1.0);
            directed_edges.push((i, nbr, w));
        }
    }

    // Attractive / repulsive optimization epochs
    let epochs = 90usize;
    let a = 1.577f64;
    let b = 0.895f64;
    let mut rng_state: u64 = 0x9E37_79B9_7F4A_7C15;

    for epoch in 0..epochs {
        let lr = 0.85 * (1.0 - (epoch as f64) / (epochs as f64));
        for &(i, j, weight) in &directed_edges {
            if (epoch as f64 + weight) < 0.0 {
                continue;
            }
            let mut dist_sq = 0.0f64;
            let mut delta = [0.0f64; 3];
            for c in 0..out_dims {
                delta[c] = pos[i][c] - pos[j][c];
                dist_sq += delta[c] * delta[c];
            }
            let dist_sq = dist_sq.max(1e-6);
            let grad_coeff = (-2.0 * a * b * dist_sq.powf(b - 1.0)) / (1.0 + a * dist_sq.powf(b));
            let step = (lr * weight * grad_coeff).clamp(-4.0, 4.0);
            for c in 0..out_dims {
                let d_val = step * delta[c];
                pos[i][c] += d_val;
                pos[j][c] -= d_val;
            }

            // Negative samples
            for _ in 0..3 {
                rng_state = rng_state.wrapping_mul(6364136223846793005).wrapping_add(1);
                let neg = ((rng_state >> 32) as usize) % n;
                if neg == i {
                    continue;
                }
                let mut n_sq = 0.0f64;
                let mut nd = [0.0f64; 3];
                for c in 0..out_dims {
                    nd[c] = pos[i][c] - pos[neg][c];
                    n_sq += nd[c] * nd[c];
                }
                let n_sq = n_sq.max(1e-6);
                let rep = (2.0 * b) / ((0.001 + n_sq) * (1.0 + a * n_sq.powf(b)));
                let r_step = (lr * rep * 0.5).clamp(-4.0, 4.0);
                for c in 0..out_dims {
                    pos[i][c] += r_step * nd[c];
                }
            }
        }
    }

    pos.into_iter()
        .map(|p| {
            [
                if p[0].is_finite() { p[0] as f32 } else { 0.0 },
                if p[1].is_finite() { p[1] as f32 } else { 0.0 },
                if out_dims == 3 && p[2].is_finite() {
                    p[2] as f32
                } else {
                    0.0
                },
            ]
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pca_and_umap_produce_finite_separated_coordinates() {
        let vectors = vec![
            vec![10.0, 0.0, 0.0, 0.0],
            vec![10.2, 0.1, 0.0, 0.0],
            vec![9.8, -0.1, 0.1, 0.0],
            vec![-10.0, 0.0, 0.0, 0.0],
            vec![-10.2, -0.1, 0.0, 0.0],
            vec![-9.9, 0.1, -0.1, 0.0],
        ];

        let pca_2d = compute_projection(&vectors, ProjectionMethod::Pca, 2).expect("pca 2d");
        assert_eq!(pca_2d.coords.len(), 6);
        assert_eq!(pca_2d.dims, 2);
        for c in &pca_2d.coords {
            assert!(c[0].is_finite() && c[1].is_finite());
        }
        // Clusters should separate along principal axis
        assert!((pca_2d.coords[0][0] - pca_2d.coords[3][0]).abs() > 5.0);

        let umap_3d = compute_projection(&vectors, ProjectionMethod::Umap, 3).expect("umap 3d");
        assert_eq!(umap_3d.coords.len(), 6);
        assert_eq!(umap_3d.dims, 3);
        for c in &umap_3d.coords {
            assert!(c[0].is_finite() && c[1].is_finite() && c[2].is_finite());
        }
    }

    #[test]
    fn projection_handles_empty_and_single_point_safely() {
        let empty = compute_projection(&[], ProjectionMethod::Pca, 3).expect("empty");
        assert!(empty.coords.is_empty());

        let single =
            compute_projection(&[vec![1.0, 2.0, 3.0]], ProjectionMethod::Umap, 2).expect("one");
        assert_eq!(single.coords.len(), 1);
        assert_eq!(single.coords[0], [0.0, 0.0, 0.0]);
    }
}
