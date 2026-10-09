//! The offline judge: deterministic, offline heuristics.
//!
//! This is the floor every Jev answer degrades to and the only thing
//! `cargo test` exercises. It is intentionally the same shape of reasoning
//! the consolidator and extractor already do — negation difference and token
//! overlap for relationships, keyword markers for recall — because a
//! fallback must be code the project already trusts.

use crate::similarity::{has_negation, jaccard, tokenize};

use crate::domain::Fact;

use super::{DistilledDraft, Judgment, RecallNeed, Relationship};

/// Token overlap above which two texts are the same rule said twice.
const DUPLICATE_THRESHOLD: f64 = 0.75;
/// Token overlap above which two texts are related enough to judge.
const RELATED_THRESHOLD: f64 = 0.3;

/// Words that mark a message as dependent on remembered context.
const RECALL_MARKERS: &[&str] = &[
    "as before",
    "like last time",
    "as agreed",
    "as decided",
    "the usual",
    "again",
    "same as",
    "remember",
    "as always",
    "per our",
    "jak minule",
    "jako posledne",
    "jak jsme se",
    "vzdycky",
    "opet",
    "znovu",
    "pamatujes",
    "jako vzdy",
];

/// Maps message keywords to the fact types worth searching for them.
const TYPE_HINTS: &[(&str, &str)] = &[
    ("architect", "decision"),
    ("decision", "decision"),
    ("refactor", "pattern"),
    ("why ", "decision"),
    ("how do i", "skill"),
    ("how to", "skill"),
    ("convention", "pattern"),
    ("style", "pattern"),
    ("prefer", "preference"),
];

/// Strips the Czech `ne-` negation prefix from tokens for the overlap
/// comparison only: "nepoužívat" must overlap "používat" so that a negation
/// flip reads as a contradiction on the same subject, not as unrelated
/// texts. Negation itself is detected on the raw text by `has_negation`.
fn negation_insensitive(tokens: &[String]) -> Vec<String> {
    tokens
        .iter()
        .map(|token| {
            if token.len() >= 7 && token.starts_with("ne") {
                token[2..].to_string()
            } else {
                token.clone()
            }
        })
        .collect()
}

/// Classifies the relationship between two fact texts without any model.
pub fn relationship(text_a: &str, text_b: &str) -> Result<Judgment<Relationship>, String> {
    let tokens_a = negation_insensitive(&tokenize(text_a));
    let tokens_b = negation_insensitive(&tokenize(text_b));
    let overlap = jaccard(&tokens_a, &tokens_b);

    let negation_differs = has_negation(text_a) != has_negation(text_b);

    let (answer, confidence) = if overlap >= DUPLICATE_THRESHOLD && !negation_differs {
        (Relationship::Duplicate, overlap)
    } else if negation_differs && overlap >= RELATED_THRESHOLD {
        // Same subject, opposite polarity: a contradiction, but only as
        // confident as the shared subject matter.
        (Relationship::Contradiction, overlap * 0.8)
    } else if overlap >= RELATED_THRESHOLD {
        (Relationship::Unrelated, 1.0 - overlap)
    } else {
        (Relationship::Unrelated, 0.9)
    };

    Ok(Judgment {
        answer,
        confidence,
        judged_by: super::Backend::Offline,
        notes: None,
    })
}

/// Marker-based recall gate without any model.
pub fn recall_need(message: &str) -> Result<Judgment<RecallNeed>, String> {
    let lower = message.to_lowercase();

    let fact_types: Vec<String> = TYPE_HINTS
        .iter()
        .filter(|(hint, _)| lower.contains(hint))
        .map(|(_, fact_type)| fact_type.to_string())
        .collect();

    let hits_recall_marker = RECALL_MARKERS.iter().any(|m| lower.contains(m));
    let search = hits_recall_marker || !fact_types.is_empty();

    Ok(Judgment {
        answer: RecallNeed {
            search,
            fact_types,
            notes: None,
        },
        confidence: if hits_recall_marker { 0.8 } else { 0.5 },
        judged_by: super::Backend::Offline,
        notes: None,
    })
}

/// Offline dream: a template question over the fact's own title.
pub fn dream_question(fact: &Fact) -> String {
    format!("What is the rule '{}' about?", fact.title)
}

/// Offline dream answer check: no model means no answer — the honest verdict
/// is "blurred, review manually", never a fake pass.
pub fn dream_answer(question: &str, fact: &Fact) -> (String, bool) {
    let _ = (question, fact);
    (
        "(offline dreaming cannot answer; review manually)".to_string(),
        false,
    )
}

/// Deterministic distillation of telemetry when offline.
pub fn distill_telemetry(trigger: &str, raw_context: &str) -> Result<Judgment<DistilledDraft>, String> {
    let first_line = raw_context
        .lines()
        .next()
        .unwrap_or("")
        .trim();

    let (is_durable, fact_type, title, rule, tags) = match trigger {
        "compiler_recovery" => (
            true,
            "correction".to_string(),
            format!("Compiler recovery: {}", first_line.chars().take(60).collect::<String>()),
            "Preserve verified resolution pattern.".to_string(),
            vec!["compiler".to_string(), "recovery".to_string()],
        ),
        "user_correction" => (
            true,
            "preference".to_string(),
            format!("User guidance: {}", first_line.chars().take(60).collect::<String>()),
            "Respect user directional guidance.".to_string(),
            vec!["preference".to_string(), "guidance".to_string()],
        ),
        "dependency_change" => (
            true,
            "decision".to_string(),
            format!("Dependency update: {}", first_line.chars().take(60).collect::<String>()),
            "Document dependency choice and version constraint.".to_string(),
            vec!["dependency".to_string(), "architecture".to_string()],
        ),
        _ => (
            false,
            "note".to_string(),
            "Telemetry note".to_string(),
            "Context only.".to_string(),
            vec!["telemetry".to_string()],
        ),
    };

    Ok(Judgment {
        answer: DistilledDraft {
            is_durable,
            fact_type,
            title,
            context: raw_context.to_string(),
            rule,
            tags,
        },
        confidence: 0.7,
        judged_by: super::Backend::Offline,
        notes: None,
    })
}

#[cfg(test)]
mod tests;
