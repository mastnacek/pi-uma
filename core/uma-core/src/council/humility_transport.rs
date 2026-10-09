//! The Familiarity Index's Jev transport (Proposal 04, Pillar IV).

use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::json;

use crate::fastbrain::jev::{complete, truncate, DEFAULT_MODEL};
use crate::fastbrain::Backend;

use super::{complexity_signals, Familiarity, HumilityInput, HumilityVerdict};

/// Consults Jev for a semantic familiarity judgment over the target subsystem.
pub fn familiarity(input: &HumilityInput) -> Result<HumilityVerdict> {
    let schema = json!({
        "type": "object",
        "properties": {
            "familiarity": { "type": "string", "enum": ["low", "medium", "high"] },
            "advice": { "type": "string" }
        },
        "required": ["familiarity", "advice"],
        "additionalProperties": false,
    });

    let prompt = format!(
        "You are the Epistemic-Humility assessor for a coding agent. Judge how well \
         documented the target subsystem is and how hazardous an unexplored mutation \
         would be (complex macros, FFI, unsafe blocks, concurrency primitives).\\n\\n\
         Proposed intent: {intent}\\n\
         Target files: {files}\\n\
         Memory facts covering these files: {coverage}\\n\
         Detected complexity signals: {signals}\\n\\n\
         Rate familiarity low/medium/high and give one paragraph of concrete guidance. \
         Rate LOW when coverage is absent and the constructs are intricate — the agent \
         must explore (read files, form a hypothesis) before mutating.",
        intent = input.intent,
        files = if input.files.is_empty() { "(none)".to_string() } else { input.files.join(", ") },
        coverage = input.fact_coverage,
        signals = {
            let s = complexity_signals(&input.intent, &input.files);
            if s.is_empty() { "(none)".to_string() } else { s.join(", ") }
        },
    );

    let content = complete("humility_familiarity", schema, prompt)?;

    #[derive(Deserialize)]
    struct Answer {
        familiarity: String,
        advice: String,
    }

    let parsed: Answer = serde_json::from_str(content.trim())
        .with_context(|| format!("Unparsable humility answer: {}", truncate(&content, 120)))?;

    let familiarity = match parsed.familiarity.as_str() {
        "medium" => Familiarity::Medium,
        "high" => Familiarity::High,
        _ => Familiarity::Low,
    };

    Ok(HumilityVerdict {
        familiarity,
        fact_coverage: input.fact_coverage,
        complexity_signals: complexity_signals(&input.intent, &input.files),
        exploration_required: familiarity != Familiarity::High,
        hypothesis_required: familiarity != Familiarity::High,
        advice: parsed.advice,
        judged_by: Backend::Jev,
        notes: Some(DEFAULT_MODEL.to_string()),
    })
}