//! The Skeptic's Jev transport (Proposal 04, Pillar I).
//!
//! Reuses the shared fastbrain chat-completion helper (`fastbrain::jev::complete`)
//! so the OpenRouter plumbing — auth resolution, timeout, JSON-schema response
//! format — lives in exactly one place.

use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::json;

use crate::fastbrain::jev::{complete, truncate, DEFAULT_MODEL};
use crate::fastbrain::Backend;

use super::{FailureMode, RiskLevel, SkepticCritique, SkepticInput};

/// Consults Jev as the adversarial devil's advocate over a proposed intent.
pub fn skeptic(input: &SkepticInput) -> Result<SkepticCritique> {
    let schema = json!({
        "type": "object",
        "properties": {
            "failure_mode": {
                "type": "string",
                "enum": [
                    "concurrency_deadlock",
                    "unhandled_null_edge_case",
                    "silent_data_corruption",
                    "breaking_public_contract",
                    "none_acceptable_risk"
                ]
            },
            "devil_objection": { "type": "number", "minimum": 0.0, "maximum": 1.0 },
            "risk_level": { "type": "string", "enum": ["benign", "questionable", "dangerous"] },
            "advice": { "type": "string" }
        },
        "required": ["failure_mode", "devil_objection", "risk_level", "advice"],
        "additionalProperties": false,
    });

    let prompt = format!(
        "You are the adversarial Skeptic (the devil's advocate) reviewing a coding agent's \
         proposed intent before execution. Your ONLY role is to find the worst plausible \
         failure scenario an expert senior architect would flag. Be harsh but concrete.\n\n\
         Proposed intent: {intent}\n\
         Target files: {files}\n\
         Known past incidents: {mentions} correction(s), {reverts} revert(s) on these files.\n\n\
         Identify the primary architectural failure mode, rate how strongly you object \
         (devil_objection 0.0-1.0), give an overall risk level, and one paragraph of concrete \
         adversarial advice for the agent.",
        intent = input.intent,
        files = if input.files.is_empty() {
            "(none specified)".to_string()
        } else {
            input.files.join(", ")
        },
        mentions = input.correction_mentions,
        reverts = input.reverts,
    );

    let content = complete("skeptic_critique", schema, prompt)?;

    #[derive(Deserialize)]
    struct Answer {
        failure_mode: String,
        devil_objection: f64,
        risk_level: String,
        advice: String,
    }

    let parsed: Answer = serde_json::from_str(content.trim())
        .with_context(|| format!("Unparsable skeptic answer: {}", truncate(&content, 120)))?;

    let failure_mode = match parsed.failure_mode.as_str() {
        "concurrency_deadlock" => FailureMode::ConcurrencyDeadlock,
        "unhandled_null_edge_case" => FailureMode::UnhandledNullEdgeCase,
        "silent_data_corruption" => FailureMode::SilentDataCorruption,
        "breaking_public_contract" => FailureMode::BreakingPublicContract,
        _ => FailureMode::NoneAcceptableRisk,
    };
    let risk_level = match parsed.risk_level.as_str() {
        "questionable" => RiskLevel::Questionable,
        "dangerous" => RiskLevel::Dangerous,
        _ => RiskLevel::Benign,
    };

    Ok(SkepticCritique {
        failure_mode,
        devil_objection: parsed.devil_objection.clamp(0.0, 1.0),
        risk_level,
        advice: parsed.advice,
        judged_by: Backend::Jev,
        notes: Some(DEFAULT_MODEL.to_string()),
    })
}
