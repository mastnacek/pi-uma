//! The Jev transport: typed questions over OpenRouter.
//!
//! TypeSafe's native System One API (`api.typesafe.ai/v1/systemone`) takes
//! `{state, questions}` and returns typed answers with calibrated confidence.
//! That API needs a TypeSafe key, so this transport initially speaks the same
//! *contract* through OpenRouter's `jev-router` chat model with a JSON-schema
//! response — one enum answer per question, confidence reported conservatively
//! because the router does not expose calibrated probabilities. Swapping in
//! the native transport later means changing this file only.

use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::json;

use super::{Backend, DistilledDraft, Judgment, RecallNeed, Relationship};

/// The router model OpenRouter currently serves.
pub const DEFAULT_MODEL: &str = "typesafe/jev-router";

/// Chat-completion timeout: a triage call that outlives this is worse than no
/// triage at all — the caller degrades to offline.
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

/// One chat completion with a JSON-schema response format.
pub(crate) fn complete(schema_name: &str, schema: serde_json::Value, user_payload: String) -> Result<String> {
    let key = api_key()?;
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
        .build()
        .context("Failed to build HTTP client")?;

    let body = json!({
        "model": DEFAULT_MODEL,
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

pub(crate) fn truncate(text: &str, width: usize) -> String {
    if text.chars().count() <= width {
        text.to_string()
    } else {
        let head: String = text.chars().take(width).collect();
        format!("{head}…")
    }
}

/// Parses the model's JSON answer into a relationship.
fn parse_relationship(content: &str) -> Result<Relationship> {
    #[derive(Deserialize)]
    struct Answer {
        relationship: Relationship,
    }
    let answer: Answer = serde_json::from_str(content.trim())
        .with_context(|| format!("Unparsable classifier answer: {}", truncate(content, 120)))?;
    Ok(answer.relationship)
}

/// Parses the model's JSON answer into a recall verdict.
fn parse_recall(content: &str) -> Result<RecallNeed> {
    #[derive(Deserialize)]
    struct Answer {
        search: bool,
        #[serde(default)]
        fact_types: Vec<String>,
    }
    let answer: Answer = serde_json::from_str(content.trim())
        .with_context(|| format!("Unparsable classifier answer: {}", truncate(content, 120)))?;
    Ok(RecallNeed {
        search: answer.search,
        fact_types: answer.fact_types,
        notes: None,
    })
}

/// Classifies the relationship between two fact texts semantically.
pub fn relationship(text_a: &str, text_b: &str) -> Result<Judgment<Relationship>> {
    let content = complete(
        "relationship",
        json!({
            "type": "object",
            "properties": {
                "relationship": {
                    "type": "string",
                    "enum": ["duplicate", "contradiction", "unrelated"],
                }
            },
            "required": ["relationship"],
            "additionalProperties": false,
        }),
        format!(
            "Two memory facts that look similar. Classify their relationship.\n\
             - duplicate: the same rule stated twice\n\
             - contradiction: opposite rules about the same subject\n\
             - unrelated: different rules that merely share vocabulary\n\
             Texts may be in English or Czech.\n\nFact A: {text_a}\n\nFact B: {text_b}"
        ),
    )?;

    Ok(Judgment {
        answer: parse_relationship(&content)?,
        // The router exposes no calibrated confidence; a semantic answer at
        // 0.8 must never be confused with the offline verdict's numbers.
        confidence: 0.8,
        judged_by: Backend::Jev,
        notes: Some(DEFAULT_MODEL.to_string()),
    })
}

/// Decides whether a user message needs memory recall, semantically.
pub fn recall_need(message: &str) -> Result<Judgment<RecallNeed>> {
    let content = complete(
        "recall_need",
        json!({
            "type": "object",
            "properties": {
                "search": { "type": "boolean" },
                "fact_types": {
                    "type": "array",
                    "items": { "type": "string", "enum": [
                        "decision", "pattern", "preference", "skill", "fact", "note"
                    ] },
                },
            },
            "required": ["search", "fact_types"],
            "additionalProperties": false,
        }),
        format!(
            "A user message to a coding agent. Decide whether answering it may depend on \
             remembered project decisions, patterns, preferences, or skills — and if so, \
             which fact types are worth searching.\n\
             DEFAULT TO search=false. Only set true when the message clearly references \
             implementation specifics, past decisions, project conventions, or asks \
             'why/how' about the project itself. Casual chat, thanks, approvals \
             ('looks good', 'commit it'), simple commands, and questions about the current \
             file contents do NOT need memory.\n\nMessage: {message}"
        ),
    )?;

    Ok(Judgment {
        answer: parse_recall(&content)?,
        confidence: 0.8,
        judged_by: Backend::Jev,
        notes: Some(DEFAULT_MODEL.to_string()),
    })
}

/// Distills telemetry into a structured memory candidate using Jev.
pub fn distill_telemetry(trigger: &str, raw_context: &str) -> Result<Judgment<DistilledDraft>> {
    let schema = json!({
        "type": "object",
        "properties": {
            "is_durable": { "type": "boolean" },
            "fact_type": { "type": "string", "enum": ["correction", "preference", "decision", "skill"] },
            "title": { "type": "string" },
            "context": { "type": "string" },
            "rule": { "type": "string" },
            "tags": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["is_durable", "fact_type", "title", "context", "rule", "tags"],
        "additionalProperties": false,
    });

    let prompt = format!(
        "You are the System-1 Shadow Observer analyzing developer activity.\n\
         Given an observed behavioral inflection point, decide if this is durable engineering \
         knowledge worth preserving in long-term memory.\n\
         If it is routine chatter or ephemeral, set is_durable=false.\n\
         If durable, synthesize a concise one-line title, context, actionable rule, and tags.\n\n\
         Trigger: {trigger}\n\
         Observed Context:\n{raw_context}"
    );

    let content = complete("distill_telemetry", schema, prompt)?;

    #[derive(Deserialize)]
    struct Answer {
        is_durable: bool,
        fact_type: String,
        title: String,
        context: String,
        rule: String,
        tags: Vec<String>,
    }

    let parsed: Answer = serde_json::from_str(content.trim())
        .with_context(|| format!("Unparsable distill answer: {}", truncate(&content, 120)))?;

    Ok(Judgment {
        answer: DistilledDraft {
            is_durable: parsed.is_durable,
            fact_type: parsed.fact_type,
            title: parsed.title,
            context: parsed.context,
            rule: parsed.rule,
            tags: parsed.tags,
        },
        confidence: 0.85,
        judged_by: Backend::Jev,
        notes: Some(DEFAULT_MODEL.to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_relationship_answer() {
        assert_eq!(
            parse_relationship(r#"{"relationship": "contradiction"}"#).unwrap(),
            Relationship::Contradiction
        );
        assert!(parse_relationship("not json").is_err());
    }

    #[test]
    fn test_parse_recall_answer() {
        let need = parse_recall(r#"{"search": true, "fact_types": ["decision"]}"#).unwrap();
        assert!(need.search);
        assert_eq!(need.fact_types, vec!["decision"]);

        let need = parse_recall(r#"{"search": false, "fact_types": []}"#).unwrap();
        assert!(!need.search);
    }

    /// Live Jev transport verification: the OpenRouter `typesafe/jev-router`
    /// endpoint is the production System-1 judge, not an emulation to mock.
    /// Runs whenever credentials resolve (OPENROUTER_API_KEY or
    /// ~/.pi/agent/auth.json); without credentials the test skips loudly
    /// rather than substituting a fake model.
    #[test]
    fn test_live_jev_transport_endpoints() {
        if crate::embeddings::resolve_api_key().is_none() {
            eprintln!("skipping live Jev check: no OpenRouter credentials");
            return;
        }

        // recall_need: a plain greeting must not trigger memory search.
        let greeting = recall_need("hello, how are you").expect("live recall call");
        assert_eq!(greeting.judged_by, Backend::Jev);
        assert!(!greeting.answer.search, "greeting must not trigger recall");

        // recall_need: a project-convention question must trigger it.
        let project_q = recall_need("why did we adopt vertical slice architecture for this repository?")
            .expect("live recall call");
        assert!(project_q.answer.search, "convention question must trigger recall");

        // relationship: two opposing statements are a contradiction.
        let rel = relationship(
            "Always use pnpm for package management.",
            "Never use pnpm; use npm instead.",
        )
        .expect("live relationship call");
        assert_eq!(rel.judged_by, Backend::Jev);
        assert_eq!(rel.answer, Relationship::Contradiction);

        // distill_telemetry: a specific, well-evidenced recovery event must
        // produce durable knowledge with populated fields. (Vague context is
        // correctly judged non-durable — that conservatism is the point of the
        // System-1 triage, so the live example must carry real signal.)
        let draft = distill_telemetry(
            "compiler_recovery",
            "cargo test failed: SQLite 'database is locked' when two writers opened the index concurrently. Fix: enable WAL mode with 'PRAGMA journal_mode=WAL' and set busy_timeout=5000. After the fix all tests passed.",
        )
        .expect("live distill call");
        assert!(draft.answer.is_durable, "evidenced recovery must be durable knowledge");
        assert!(!draft.answer.title.is_empty());
        assert!(!draft.answer.rule.is_empty());
    }
}
