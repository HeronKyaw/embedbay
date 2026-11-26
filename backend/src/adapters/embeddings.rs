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

fn parse_f32_array(val: &Value) -> Vec<f32> {
    val.as_array()
        .map(|nums| {
            nums.iter()
                .filter_map(|x| x.as_f64().map(|f| f as f32))
                .collect::<Vec<f32>>()
        })
        .unwrap_or_default()
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
        "openai_compatible" => {
            embed_bearer_data_embeddings(
                profile,
                api_key,
                texts,
                "https://api.openai.com/v1",
                "Embeddings API",
            )
            .await?
        }
        "gemini" => embed_gemini(profile, api_key, texts).await?,
        "cohere" => embed_cohere(profile, api_key, texts).await?,
        "voyage" => {
            embed_bearer_data_embeddings(
                profile,
                api_key,
                texts,
                "https://api.voyageai.com/v1",
                "Voyage AI",
            )
            .await?
        }
        "huggingface_tei" => embed_huggingface_tei(profile, api_key, texts).await?,
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
            let vectors = arr.iter().map(parse_f32_array).collect::<Vec<_>>();
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
            .map(parse_f32_array)
            .filter(|v| !v.is_empty())
            .ok_or_else(|| AdapterError::Api("Ollama response missing embedding".to_string()))?;
        out.push(vec);
    }
    Ok(out)
}

async fn embed_bearer_data_embeddings(
    profile: &EmbeddingProfile,
    api_key: Option<&str>,
    texts: &[String],
    default_base: &str,
    provider_label: &str,
) -> Result<Vec<Vec<f32>>, AdapterError> {
    let raw_base = profile
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(default_base)
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
        req = req.bearer_auth(key.trim());
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
            provider_label,
            status,
            &text,
        )));
    }

    let body: Value = serde_json::from_str(&text)
        .map_err(|_| AdapterError::Api(format_invalid_json_error(provider_label, &text)))?;
    let mut data = body
        .get("data")
        .and_then(|v| v.as_array())
        .cloned()
        .ok_or_else(|| {
            AdapterError::Api(format!("{} response missing 'data' array", provider_label))
        })?;

    data.sort_by_key(|item| item.get("index").and_then(|v| v.as_u64()).unwrap_or(0));

    let vectors = data
        .into_iter()
        .map(|item| {
            item.get("embedding")
                .map(parse_f32_array)
                .unwrap_or_default()
        })
        .collect();

    Ok(vectors)
}

async fn embed_gemini(
    profile: &EmbeddingProfile,
    api_key: Option<&str>,
    texts: &[String],
) -> Result<Vec<Vec<f32>>, AdapterError> {
    let base = profile
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("https://generativelanguage.googleapis.com/v1beta")
        .trim_end_matches('/');

    let model_name = if profile.model_name.trim().is_empty() {
        "gemini-embedding-001"
    } else {
        profile.model_name.trim()
    };
    let model_path = if model_name.starts_with("models/") {
        model_name.to_string()
    } else {
        format!("models/{}", model_name)
    };

    let url = format!("{}/{}:batchEmbedContents", base, model_path);
    let requests: Vec<Value> = texts
        .iter()
        .map(|t| {
            json!({
                "model": model_path,
                "content": { "parts": [{ "text": t }] }
            })
        })
        .collect();

    let client = http_client_for_url(&url, 60)?;
    let mut req = client.post(&url).json(&json!({ "requests": requests }));
    if let Some(key) = api_key.filter(|k| !k.trim().is_empty()) {
        req = req.header("x-goog-api-key", key.trim());
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
            "Gemini", status, &text,
        )));
    }

    let body: Value = serde_json::from_str(&text)
        .map_err(|_| AdapterError::Api(format_invalid_json_error("Gemini", &text)))?;

    if let Some(arr) = body.get("embeddings").and_then(|v| v.as_array()) {
        let vectors = arr
            .iter()
            .map(|item| item.get("values").map(parse_f32_array).unwrap_or_default())
            .collect();
        return Ok(vectors);
    }

    if let Some(single) = body.pointer("/embedding/values") {
        return Ok(vec![parse_f32_array(single)]);
    }

    Err(AdapterError::Api(
        "Gemini response missing 'embeddings' array".to_string(),
    ))
}

async fn embed_cohere(
    profile: &EmbeddingProfile,
    api_key: Option<&str>,
    texts: &[String],
) -> Result<Vec<Vec<f32>>, AdapterError> {
    let raw_base = profile
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("https://api.cohere.com")
        .trim_end_matches('/');

    let url = if raw_base.ends_with("/embed") {
        raw_base.to_string()
    } else if raw_base.ends_with("/v2") {
        format!("{}/embed", raw_base)
    } else {
        format!("{}/v2/embed", raw_base)
    };

    let model = if profile.model_name.trim().is_empty() {
        "embed-v4.0"
    } else {
        profile.model_name.trim()
    };

    let client = http_client_for_url(&url, 60)?;
    let mut req = client.post(&url).json(&json!({
        "model": model,
        "texts": texts,
        "input_type": "search_document",
        "embedding_types": ["float"],
    }));
    if let Some(key) = api_key.filter(|k| !k.trim().is_empty()) {
        req = req.bearer_auth(key.trim());
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
            "Cohere", status, &text,
        )));
    }

    let body: Value = serde_json::from_str(&text)
        .map_err(|_| AdapterError::Api(format_invalid_json_error("Cohere", &text)))?;

    if let Some(arr) = body.pointer("/embeddings/float").and_then(|v| v.as_array()) {
        return Ok(arr.iter().map(parse_f32_array).collect());
    }
    if let Some(arr) = body.get("embeddings").and_then(|v| v.as_array()) {
        return Ok(arr.iter().map(parse_f32_array).collect());
    }

    Err(AdapterError::Api(
        "Cohere response missing 'embeddings.float'".to_string(),
    ))
}

async fn embed_huggingface_tei(
    profile: &EmbeddingProfile,
    api_key: Option<&str>,
    texts: &[String],
) -> Result<Vec<Vec<f32>>, AdapterError> {
    let raw_base = profile
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("http://127.0.0.1:8080")
        .trim_end_matches('/');

    let url = if raw_base.ends_with("/embed") {
        raw_base.to_string()
    } else {
        format!("{}/embed", raw_base)
    };

    let client = http_client_for_url(&url, 60)?;
    let mut req = client.post(&url).json(&json!({
        "inputs": texts,
    }));
    if let Some(key) = api_key.filter(|k| !k.trim().is_empty()) {
        req = req.bearer_auth(key.trim());
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
            "HuggingFace TEI",
            status,
            &text,
        )));
    }

    let body: Value = serde_json::from_str(&text)
        .map_err(|_| AdapterError::Api(format_invalid_json_error("HuggingFace TEI", &text)))?;

    let arr = body.as_array().ok_or_else(|| {
        AdapterError::Api("HuggingFace TEI response must be a JSON array".to_string())
    })?;
    if arr.first().map(|v| v.is_number()).unwrap_or(false) {
        return Ok(vec![parse_f32_array(&body)]);
    }
    Ok(arr.iter().map(parse_f32_array).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;

    async fn spawn_embed_server(response_json: Value) -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let handle = tokio::spawn(async move {
            if let Ok((mut sock, _)) = listener.accept().await {
                let mut buf = [0u8; 4096];
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

    async fn spawn_capturing_embed_server(
        response_json: Value,
    ) -> (
        String,
        oneshot::Receiver<String>,
        tokio::task::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let (tx, rx) = oneshot::channel();
        let handle = tokio::spawn(async move {
            if let Ok((mut sock, _)) = listener.accept().await {
                let mut buf = [0u8; 8192];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let captured = String::from_utf8_lossy(&buf[..n]).to_string();
                let _ = tx.send(captured);
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
        (format!("http://127.0.0.1:{}", port), rx, handle)
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

    #[tokio::test]
    async fn embeds_via_gemini_cohere_voyage_and_huggingface_tei() {
        // 1. Gemini
        let (gem_url, gem_rx, s_gem) = spawn_capturing_embed_server(json!({
            "embeddings": [
                { "values": [0.11, 0.22] },
                { "values": [0.33, 0.44] }
            ]
        }))
        .await;
        let gem_prof = EmbeddingProfile {
            id: "g1".to_string(),
            name: "Gemini".to_string(),
            provider: "gemini".to_string(),
            model_name: "gemini-embedding-001".to_string(),
            base_url: Some(gem_url),
            dimensions: Some(2),
            secret_ref: None,
        };
        let (g_vecs, _) = embed_texts(
            &gem_prof,
            Some("AIza-test"),
            &["first".to_string(), "second".to_string()],
        )
        .await
        .expect("gemini embed");
        assert_eq!(g_vecs, vec![vec![0.11, 0.22], vec![0.33, 0.44]]);
        let g_req = gem_rx.await.expect("captured gemini req");
        assert!(g_req.contains("POST /models/gemini-embedding-001:batchEmbedContents"));
        assert!(g_req.to_ascii_lowercase().contains("x-goog-api-key: aiza-test"));
        s_gem.abort();

        // 2. Cohere
        let (coh_url, coh_rx, s_coh) = spawn_capturing_embed_server(json!({
            "embeddings": { "float": [[0.9, 0.8, 0.7]] }
        }))
        .await;
        let coh_prof = EmbeddingProfile {
            id: "c1".to_string(),
            name: "Cohere".to_string(),
            provider: "cohere".to_string(),
            model_name: "embed-v4.0".to_string(),
            base_url: Some(coh_url),
            dimensions: Some(3),
            secret_ref: None,
        };
        let (c_vecs, _) = embed_texts(&coh_prof, Some("co-key"), &["hello".to_string()])
            .await
            .expect("cohere embed");
        assert_eq!(c_vecs, vec![vec![0.9, 0.8, 0.7]]);
        let c_req = coh_rx.await.expect("captured cohere req");
        assert!(c_req.contains("POST /v2/embed"));
        assert!(c_req.contains("Bearer co-key"));
        assert!(c_req.contains("\"embedding_types\":[\"float\"]"));
        s_coh.abort();

        // 3. Voyage AI
        let (voy_url, voy_rx, s_voy) = spawn_capturing_embed_server(json!({
            "data": [
                { "index": 1, "embedding": [0.4, 0.5] },
                { "index": 0, "embedding": [0.1, 0.2] }
            ]
        }))
        .await;
        let voy_prof = EmbeddingProfile {
            id: "v1".to_string(),
            name: "Voyage".to_string(),
            provider: "voyage".to_string(),
            model_name: "voyage-3-lite".to_string(),
            base_url: Some(format!("{}/v1", voy_url)),
            dimensions: Some(2),
            secret_ref: None,
        };
        let (v_vecs, _) = embed_texts(
            &voy_prof,
            Some("pa-voyage"),
            &["a".to_string(), "b".to_string()],
        )
        .await
        .expect("voyage embed");
        assert_eq!(v_vecs, vec![vec![0.1, 0.2], vec![0.4, 0.5]]);
        let v_req = voy_rx.await.expect("captured voyage req");
        assert!(v_req.contains("POST /v1/embeddings"));
        assert!(v_req.contains("Bearer pa-voyage"));
        s_voy.abort();

        // 4. HuggingFace TEI
        let (tei_url, tei_rx, s_tei) =
            spawn_capturing_embed_server(json!([[0.25, 0.75, -0.5]])).await;
        let tei_prof = EmbeddingProfile {
            id: "h1".to_string(),
            name: "Local TEI".to_string(),
            provider: "huggingface_tei".to_string(),
            model_name: "BAAI/bge-small-en-v1.5".to_string(),
            base_url: Some(tei_url),
            dimensions: Some(3),
            secret_ref: None,
        };
        let (t_vecs, _) = embed_texts(&tei_prof, Some("hf_token"), &["chunk".to_string()])
            .await
            .expect("tei embed");
        assert_eq!(t_vecs, vec![vec![0.25, 0.75, -0.5]]);
        let t_req = tei_rx.await.expect("captured tei req");
        assert!(t_req.contains("POST /embed"));
        assert!(t_req.contains("Bearer hf_token"));
        assert!(t_req.contains("\"inputs\":[\"chunk\"]"));
        s_tei.abort();
    }
}
