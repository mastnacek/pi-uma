//! Dreaming: retrieval-practice judgments (Proposal 05, Pillar IV).
//!
//! Sits beside the other fastbrain transports and reuses the shared
//! OpenRouter completion helper — one more typed question the System-1 layer
//! answers (`dream_question` / `dream_answer`).

use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::json;

use crate::domain::Fact;

use super::jev::{complete, truncate, DEFAULT_MODEL};
use super::{Backend, Judgment};

/// The dreaming pass's graded answer.
pub struct DreamAnswer {
    pub answer: String,
    pub correct: bool,
}

/// Synthesizes a retrieval-practice question for a fact (the dreaming pass).
pub fn dream_question(fact: &Fact) -> Result<String> {
    let schema = json!({
        "type": "object",
        "properties": { "question": { "type": "string" } },
        "required": ["question"],
        "additionalProperties": false,
    });
    let prompt = format!(
        "Generate ONE short natural question that tests whether an engineer still \
         remembers the rule below — the question a colleague would ask, WITHOUT \
         quoting the rule verbatim. No preamble.\n\nTitle: {}\nBody: {}",
        fact.title, fact.body
    );
    let content = complete("dream_question", schema, prompt)?;

    #[derive(Deserialize)]
    struct Answer {
        question: String,
    }
    let parsed: Answer = serde_json::from_str(content.trim())
        .with_context(|| format!("Unparsable dream question: {}", truncate(&content, 120)))?;
    Ok(parsed.question)
}

/// Answers a dream question and grades it against the fact's body.
pub fn dream_answer(question: &str, fact: &Fact) -> Result<Judgment<DreamAnswer>> {
    let schema = json!({
        "type": "object",
        "properties": {
            "answer": { "type": "string" },
            "correct": { "type": "boolean" }
        },
        "required": ["answer", "correct"],
        "additionalProperties": false,
    });
    let prompt = format!(
        "Answer the question from your OWN recall, as an engineer would in a standup \
         (2 sentences max). Then grade yourself STRICTLY against the reference rule: \
         correct=true only if your answer captures its substance.\n\nQuestion: {question}\n\n\
         Reference rule (grading key): {}\n{}",
        fact.title, fact.body
    );
    let content = complete("dream_answer", schema, prompt)?;

    #[derive(Deserialize)]
    struct Answer {
        answer: String,
        correct: bool,
    }
    let parsed: Answer = serde_json::from_str(content.trim())
        .with_context(|| format!("Unparsable dream answer: {}", truncate(&content, 120)))?;

    Ok(Judgment {
        answer: DreamAnswer {
            answer: parsed.answer,
            correct: parsed.correct,
        },
        confidence: 0.85,
        judged_by: Backend::Jev,
        notes: Some(DEFAULT_MODEL.to_string()),
    })
}