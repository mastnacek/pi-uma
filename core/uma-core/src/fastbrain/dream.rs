//! Dreaming: retrieval-practice judgments (Proposal 05, Pillar IV).
//!
//! Sits beside the other fastbrain transports and reuses the shared
//! OpenRouter completion helper — one more typed question the System-1 layer
//! answers (`dream_question` / `dream_answer`).

use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::json;

use crate::domain::Fact;

use super::jev::{complete, model_name, truncate};
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

/// Answers a dream question, then grades it against the fact's body.
///
/// Two separate calls on purpose. The answering model must NOT see the
/// reference rule: when the grading key sits in the same prompt the model is
/// grading itself with the answer in hand, which makes the "retrieval practice"
/// verdict meaningless (a model that has just read the rule can always restate
/// it). Answer from recall first, grade afterwards.
pub fn dream_answer(question: &str, fact: &Fact) -> Result<Judgment<DreamAnswer>> {
    // Step 1 — answer from recall, no reference rule in the prompt.
    let answer_schema = json!({
        "type": "object",
        "properties": { "answer": { "type": "string" } },
        "required": ["answer"],
        "additionalProperties": false,
    });
    let answer_prompt = format!(
        "Answer the question from your OWN recall, as an engineer would in a standup \
         (2 sentences max). Do not ask for clarification.\n\nQuestion: {question}"
    );
    let answer_content = complete("dream_answer", answer_schema, answer_prompt)?;
    #[derive(Deserialize)]
    struct AnswerOnly {
        answer: String,
    }
    let candidate: AnswerOnly = serde_json::from_str(answer_content.trim())
        .with_context(|| format!("Unparsable dream answer: {}", truncate(&answer_content, 120)))?;

    // Step 2 — a separate, strict grading call that does see the key.
    let grade_schema = json!({
        "type": "object",
        "properties": { "correct": { "type": "boolean" } },
        "required": ["correct"],
        "additionalProperties": false,
    });
    let grade_prompt = format!(
        "You are a strict grader. Decide whether the candidate answer captures the \
         substance of the reference rule. correct=true only if it does.\n\n\
         Reference rule: {}\n{}\n\nCandidate answer: {}\n\nQuestion: {question}",
        fact.title, fact.body, candidate.answer
    );
    let grade_content = complete("dream_grade", grade_schema, grade_prompt)?;
    #[derive(Deserialize)]
    struct Grade {
        correct: bool,
    }
    let grade: Grade = serde_json::from_str(grade_content.trim())
        .with_context(|| format!("Unparsable dream grade: {}", truncate(&grade_content, 120)))?;

    Ok(Judgment {
        answer: DreamAnswer {
            answer: candidate.answer,
            correct: grade.correct,
        },
        confidence: 0.85,
        judged_by: Backend::Jev,
        notes: Some(model_name()),
    })
}
