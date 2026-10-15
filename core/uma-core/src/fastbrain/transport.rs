//! The Jev transport: typed questions over OpenRouter.
//!
//! TypeSafe's native System One API (`api.typesafe.ai/v1/systemone`) takes
//! `{state, questions}` and returns typed answers with calibrated confidence.
//! That API needs a TypeSafe key, so this transport initially speaks the same
//! *contract* through OpenRouter's `jev-router` chat model with a JSON-schema
//! response — one enum answer per question, confidence reported conservatively
//! because the router does not expose calibrated probabilities. Swapping in
//! the native transport later means changing this file only.
//!
//! This module owns the wire: models, credentials, the HTTP client, and the
//! response envelope. The semantic operations built on it (relationship,
//! recall_need, distill_telemetry) live in [`super::jev`].

use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::json;

/// The default fast triage router model on OpenRouter.
pub const DEFAULT_ROUTER_MODEL: &str = "typesafe/jev-router";

/// The default semantic judge model on OpenRouter (low temperature, minimal reasoning).
pub const DEFAULT_JUDGE_MODEL: &str = "google/gemini-3.5-flash-lite";

/// Resolves the configured router model: UMA_ROUTER_MODEL or DEFAULT_ROUTER_MODEL.
pub fn router_model() -> String {
    std::env::var("UMA_ROUTER_MODEL").unwrap_or_else(|_| DEFAULT_ROUTER_MODEL.to_string())
}

/// Resolves the configured judge model: UMA_JUDGE_MODEL, UMA_FASTBRAIN_MODEL, or DEFAULT_JUDGE_MODEL.
pub fn judge_model() -> String {
    std::env::var("UMA_JUDGE_MODEL")
        .or_else(|_| std::env::var("UMA_FASTBRAIN_MODEL"))
        .unwrap_or_else(|_| DEFAULT_JUDGE_MODEL.to_string())
}

pub fn model_name() -> String {
    judge_model()
}

/// Chat-completion timeout: a triage call that outlives this is worse than no
/// triage at all — the caller degrades to offline. MUST stay below the Pi
/// plugin's recall-gate ceiling (GATE_TIMEOUT_MS = 15 s): a judge that hangs
/// past the gate is killed mid-flight and the operator sees a bare timeout
/// warning instead of a graceful degraded verdict.
const TIMEOUT_SECS: u64 = 10;

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Deserialize)]
struct ChatMessage {
    content: String,
}

pub(crate) fn api_key() -> Result<String> {
    crate::embeddings::resolve_api_key()
        .filter(|key| !key.is_empty())
        .context("No OpenRouter API key found (env OPENROUTER_API_KEY or ~/.pi/agent/auth.json)")
}

/// Raw chat completion supporting model selection, temperature, and reasoning effort.
pub(crate) fn complete_raw(
    model: &str,
    schema_name: &str,
    schema: serde_json::Value,
    user_payload: String,
    temperature: Option<f64>,
    reasoning_effort: Option<&str>,
) -> Result<String> {
    let key = api_key()?;
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
        .build()
        .context("Failed to build HTTP client")?;

    let mut body = json!({
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "You are a fast classifier. Answer ONLY with a JSON object \
                            matching the given schema. No prose, no markdown."
            },
            { "role": "user", "content": user_payload },
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": schema_name,
                "strict": true,
                "schema": schema,
            },
        },
    });

    if let Some(t) = temperature {
        body["temperature"] = json!(t);
    }
    if let Some(effort) = reasoning_effort {
        body["reasoning"] = json!({ "effort": effort });
        body["reasoning_effort"] = json!(effort);
    }

    let response = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .bearer_auth(&key)
        .json(&body)
        .send()
        .context("OpenRouter request failed")?;

    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().unwrap_or_default();
        anyhow::bail!("OpenRouter returned {status}: {}", truncate(&detail, 200));
    }

    let parsed: ChatResponse = response
        .json()
        .context("OpenRouter returned invalid JSON")?;
    parsed
        .choices
        .into_iter()
        .next()
        .map(|choice| choice.message.content)
        .context("OpenRouter returned no choices")
}

/// Router completion for fast triage (e.g. recall gate).
pub(crate) fn complete_router(
    schema_name: &str,
    schema: serde_json::Value,
    user_payload: String,
) -> Result<String> {
    complete_raw(
        &router_model(),
        schema_name,
        schema,
        user_payload,
        None,
        None,
    )
}

/// Semantic judge completion with low temperature and minimal reasoning.
pub(crate) fn complete_judge(
    schema_name: &str,
    schema: serde_json::Value,
    user_payload: String,
) -> Result<String> {
    complete_raw(
        &judge_model(),
        schema_name,
        schema,
        user_payload,
        Some(0.0),
        Some("minimal"),
    )
}

/// Default completion helper routed to the semantic judge.
pub(crate) fn complete(
    schema_name: &str,
    schema: serde_json::Value,
    user_payload: String,
) -> Result<String> {
    complete_judge(schema_name, schema, user_payload)
}

pub(crate) fn truncate(text: &str, width: usize) -> String {
    if text.chars().count() <= width {
        text.to_string()
    } else {
        let head: String = text.chars().take(width).collect();
        format!("{head}…")
    }
}
