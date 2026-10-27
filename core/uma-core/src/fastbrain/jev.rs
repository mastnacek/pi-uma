//! The Jev semantic operations: typed questions built on the transport.
//!
//! Each operation phrases one System-1 judgment as a JSON-schema chat
//! completion (is this a contradiction? does this message need memory? is
//! this telemetry durable knowledge?) and parses the typed answer. The wire
//! details — models, credentials, timeouts, the response envelope — live in
//! [`super::transport`]; swapping in TypeSafe's native System One API later
//! means changing that file only.

use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::json;

use super::transport::{complete_decisions, router_model};
// Re-exported: dream.rs and the council transports reach these through jev.
pub(crate) use super::transport::{complete, model_name, truncate};

use super::{resolve_min_prob, Backend, DistilledDraft, Judgment, RecallNeed, Relationship};

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

/// Parses the model's Decisions API answer into a recall verdict.
pub(crate) fn parse_decisions_recall(
    resp: &serde_json::Value,
    threshold: f64,
) -> Result<RecallNeed> {
    let noul = resp["answers"]["needs_memory"]["noul"]
        .as_f64()
        .context("Missing or non-numeric 'answers.needs_memory.noul' in decisions response")?;

    let search = !noul.is_nan() && noul >= threshold;

    Ok(RecallNeed {
        search,
        fact_types: Vec::new(),
        probability: vec![noul],
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
        notes: Some(model_name()),
    })
}

/// Decides whether a user message needs memory recall using the Decisions API.
pub fn recall_need(message: &str, min_prob: Option<f64>) -> Result<Judgment<RecallNeed>> {
    let threshold = resolve_min_prob(min_prob);
    let questions = json!({
        "needs_memory": {
            "type": "noul",
            "instructions": "Decide whether answering this user message to a coding agent may depend on remembered project decisions, past agreements, architecture patterns, user preferences, or project-specific conventions.",
            "criteria": {
                "true": "The message references past decisions, project conventions, architectural choices, 'why/how' about this codebase, prior work, or custom rules.",
                "false": "Casual greetings, thanks, general coding knowledge without project specifics, simple file reading/editing commands, or questions answerable purely from the immediate prompt."
            }
        }
    });

    let resp = complete_decisions(&router_model(), message, questions)?;
    let answer = parse_decisions_recall(&resp, threshold)?;
    let confidence = answer.probability.first().copied().unwrap_or(0.8);

    Ok(Judgment {
        answer,
        confidence,
        judged_by: Backend::Jev,
        notes: Some(router_model()),
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
        notes: Some(model_name()),
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
        let json = serde_json::json!({
            "answers": {
                "needs_memory": {
                    "type": "noul",
                    "noul": 0.85
                }
            }
        });
        let need = parse_decisions_recall(&json, 0.5).unwrap();
        assert!(need.search);
        assert_eq!(need.probability, vec![0.85]);

        let need_low = parse_decisions_recall(&json, 0.9).unwrap();
        assert!(!need_low.search);
        assert_eq!(need_low.probability, vec![0.85]);

        let json_invalid = serde_json::json!({ "answers": {} });
        assert!(parse_decisions_recall(&json_invalid, 0.5).is_err());
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
        let greeting = recall_need("hello, how are you", None).expect("live recall call");
        assert_eq!(greeting.judged_by, Backend::Jev);
        assert!(!greeting.answer.search, "greeting must not trigger recall");

        // recall_need: a project-convention question must trigger it.
        let project_q = recall_need(
            "why did we adopt vertical slice architecture for this repository?",
            None,
        )
        .expect("live recall call");
        assert!(
            project_q.answer.search,
            "convention question must trigger recall"
        );

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
        assert!(
            draft.answer.is_durable,
            "evidenced recovery must be durable knowledge"
        );
        assert!(!draft.answer.title.is_empty());
        assert!(!draft.answer.rule.is_empty());
    }
}
