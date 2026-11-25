use std::time::Instant;

use serde::Serialize;
use serde_json::{json, Value};

use crate::adapters::{
    format_http_status_error, format_invalid_json_error, format_reqwest_error,
    http_client_for_url, AdapterError,
};
use crate::db::models::EmbeddingProfile;

#[derive(Debug, Clone, Serialize)]
pub struct EmbeddingTestResult {
    pub ok: bool,
    pub dimensions: usize,
    pub latency_ms: u64,
    pub message: String,
}

pub async fn embed_texts(
    profile: &EmbeddingProfile,
    api_key: Option<&str>,
    texts: &[String],
) -> Result<(Vec<Vec<f32>>, u64), AdapterError> {
    if texts.is_empty() {
        return Ok((Vec::new(), 0));
    }

    let start = Instant::now();
    let vectors = match profile.provider.as_str() {
        "ollama" => embed_ollama(profile, texts).await?,
        "openai_compatible" => embed_openai_compatible(profile, api_key, texts).await?,
        other => {
            return Err(AdapterError::UnsupportedEngine(format!(
                "Unsupported embedding provider '{}'",
                other
            )));
        }
    };
    let latency_ms = start.elapsed().as_millis() as u64;
    Ok((vectors, latency_ms))
}

pub async fn test_embedding_profile(
    profile: &EmbeddingProfile,
    api_key: Option<&str>,
) -> Result<EmbeddingTestResult, AdapterError> {
    let (vecs, latency_ms) =
        embed_texts(profile, api_key, &[String::from("embedbay health check")]).await?;
    let dimensions = vecs.first().map(|v| v.len()).unwrap_or(0);
    Ok(EmbeddingTestResult {
        ok: dimensions > 0,
        dimensions,
        latency_ms,
        message: format!(
            "Generated {}-dim embedding via {} ({} ms)",
            dimensions, profile.model_name, latency_ms
        ),
    })
}

async fn embed_ollama(
    profile: &EmbeddingProfile,
    texts: &[String],
) -> Result<Vec<Vec<f32>>, AdapterError> {
    let base = profile
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("http://127.0.0.1:11434")
        .trim_end_matches('/');
    let client = http_client_for_url(base, 60)?;

    let url = format!("{}/api/embed", base);
    let resp = client
        .post(&url)
        .json(&json!({
            "model": profile.model_name,
            "input": texts,
        }))
        .send()
        .await
        .map_err(|e| AdapterError::Http(format_reqwest_error(&e)))?;

    if resp.status().is_success() {
        let body_text = resp
            .text()
            .await
            .map_err(|e| AdapterError::Http(format_reqwest_error(&e)))?;
        let body: Value = serde_json::from_str(&body_text)
            .map_err(|_| AdapterError::Api(format_invalid_json_error("Ollama", &body_text)))?;
        if let Some(arr) = body.get("embeddings").and_then(|v| v.as_array()) {
            let vectors = arr
                .iter()
                .map(|row| {
                    row.as_array()
                        .map(|nums| {
                            nums.iter()
                                .filter_map(|x| x.as_f64().map(|f| f as f32))
                                .collect::<Vec<f32>>()
                        })
                        .unwrap_or_default()
                })
                .collect::<Vec<_>>();
            return Ok(vectors);
        }
    }

    // Legacy Ollama fallback: /api/embeddings (single prompt per call)
    let legacy_url = format!("{}/api/embeddings", base);
    let mut out = Vec::with_capacity(texts.len());
    for text in texts {
        let r = client
            .post(&legacy_url)
            .json(&json!({
                "model": profile.model_name,
                "prompt": text,
            }))
            .send()
            .await
            .map_err(|e| AdapterError::Http(format_reqwest_error(&e)))?;
        let status = r.status();
        let body_text = r
            .text()
            .await
            .map_err(|e| AdapterError::Http(format_reqwest_error(&e)))?;
        if !status.is_success() {
            return Err(AdapterError::Api(format_http_status_error(
                "Ollama",
                status,
                &body_text,
            )));
        }
        let val: Value = serde_json::from_str(&body_text)
            .map_err(|_| AdapterError::Api(format_invalid_json_error("Ollama", &body_text)))?;
        let vec = val
            .get("embedding")
            .and_then(|v| v.as_array())
            .map(|nums| {
                nums.iter()
                    .filter_map(|x| x.as_f64().map(|f| f as f32))
                    .collect::<Vec<f32>>()
            })
            .ok_or_else(|| AdapterError::Api("Ollama response missing embedding".to_string()))?;
        out.push(vec);
    }
    Ok(out)
}

async fn embed_openai_compatible(
    profile: &EmbeddingProfile,
    api_key: Option<&str>,
    texts: &[String],
) -> Result<Vec<Vec<f32>>, AdapterError> {
    let raw_base = profile
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("https://api.openai.com/v1")
        .trim_end_matches('/');

    let url = if raw_base.ends_with("/embeddings") {
        raw_base.to_string()
    } else if raw_base.ends_with("/v1") {
        format!("{}/embeddings", raw_base)
    } else {
        format!("{}/v1/embeddings", raw_base)
    };

    let client = http_client_for_url(&url, 60)?;
    let mut req = client.post(&url).json(&json!({
        "model": profile.model_name,
        "input": texts,
    }));
    if let Some(key) = api_key.filter(|k| !k.trim().is_empty()) {
        req = req.bearer_auth(key);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| AdapterError::Http(format_reqwest_error(&e)))?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| AdapterError::Http(format_reqwest_error(&e)))?;
    if !status.is_success() {
        return Err(AdapterError::Api(format_http_status_error(
            "Embeddings API",
            status,
            &text,
        )));
    }

    let body: Value = serde_json::from_str(&text)
        .map_err(|_| AdapterError::Api(format_invalid_json_error("Embeddings API", &text)))?;
    let mut data = body
        .get("data")
        .and_then(|v| v.as_array())
        .cloned()
        .ok_or_else(|| AdapterError::Api("Embeddings response missing 'data' array".to_string()))?;

    data.sort_by_key(|item| item.get("index").and_then(|v| v.as_u64()).unwrap_or(0));

    let vectors = data
        .into_iter()
        .map(|item| {
            item.get("embedding")
                .and_then(|v| v.as_array())
                .map(|nums| {
                    nums.iter()
                        .filter_map(|x| x.as_f64().map(|f| f as f32))
                        .collect::<Vec<f32>>()
                })
                .unwrap_or_default()
        })
        .collect();

    Ok(vectors)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    async fn spawn_embed_server(response_json: Value) -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let handle = tokio::spawn(async move {
            if let Ok((mut sock, _)) = listener.accept().await {
                let mut buf = [0u8; 2048];
                let _ = sock.read(&mut buf).await;
                let text = serde_json::to_string(&response_json).expect("json");
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    text.len(),
                    text
                );
                let _ = sock.write_all(resp.as_bytes()).await;
                let _ = sock.shutdown().await;
            }
        });
        (format!("http://127.0.0.1:{}", port), handle)
    }

    #[tokio::test]
    async fn embeds_via_ollama_and_openai_compatible_endpoints() {
        let (ollama_url, s1) = spawn_embed_server(json!({
            "embeddings": [[0.1, 0.2, 0.3, 0.4]]
        }))
        .await;

        let ollama_prof = EmbeddingProfile {
            id: "p1".to_string(),
            name: "Local Nomic".to_string(),
            provider: "ollama".to_string(),
            model_name: "nomic-embed-text".to_string(),
            base_url: Some(ollama_url),
            dimensions: Some(4),
            secret_ref: None,
        };
        let test1 = test_embedding_profile(&ollama_prof, None)
            .await
            .expect("ollama embed");
        assert!(test1.ok);
        assert_eq!(test1.dimensions, 4);
        s1.abort();

        let (oai_url, s2) = spawn_embed_server(json!({
            "data": [{ "index": 0, "embedding": [0.5, 0.6, 0.7] }]
        }))
        .await;
        let oai_prof = EmbeddingProfile {
            id: "p2".to_string(),
            name: "OpenAI Compat".to_string(),
            provider: "openai_compatible".to_string(),
            model_name: "text-embedding-3-small".to_string(),
            base_url: Some(format!("{}/v1", oai_url)),
            dimensions: Some(3),
            secret_ref: None,
        };
        let (vecs, _) = embed_texts(&oai_prof, Some("sk-test"), &[String::from("hello")])
            .await
            .expect("openai embed");
        assert_eq!(vecs, vec![vec![0.5, 0.6, 0.7]]);
        s2.abort();
    }
}
