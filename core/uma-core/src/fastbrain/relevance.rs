//! Fastbrain Relevance Judge: evaluates whether retrieved memory candidates
//! actually help answer or carry out the user's message.
//!
//! Uses TypeSafe's Jev (System-1 model) via OpenRouter Decisions API
//! (`/api/v1/alpha/decisions`) with multiple noul questions in a single request.

use super::transport::{complete_decisions, router_model};
use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CandidateForRelevance {
    pub id: String,
    pub title: String,
    pub body_preview: String,
}

/// Parses the model's Decisions API answer into relevance probabilities for each candidate.
pub fn parse_decisions_relevance(
    resp: &serde_json::Value,
    candidate_count: usize,
) -> Result<Vec<f64>> {
    let answers = resp
        .get("answers")
        .and_then(|v| v.as_object())
        .ok_or_else(|| anyhow::anyhow!("Missing 'answers' object in decisions response"))?;

    let mut probs = Vec::with_capacity(candidate_count);
    for i in 0..candidate_count {
        let key = format!("rel_{i}");
        let noul = answers
            .get(&key)
            .and_then(|ans| ans.get("noul"))
            .and_then(|v| v.as_f64())
            .ok_or_else(|| {
                anyhow::anyhow!("Missing or non-numeric answers.{key}.noul in decisions response")
            })?;
        probs.push(noul);
    }
    Ok(probs)
}

/// Given a user message and a list of candidates, calls Decisions API to evaluate
/// the relevance of each candidate.
pub fn judge_relevance(
    message: &str,
    candidates: &[CandidateForRelevance],
) -> Result<Vec<f64>> {
    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    let mut state = format!("User message:\n{}\n\nCandidate facts:\n", message);
    let mut questions = serde_json::Map::new();

    for (i, cand) in candidates.iter().enumerate() {
        state.push_str(&format!(
            "rel_{i} (ID: {}, Title: {}):\n{}\n\n",
            cand.id, cand.title, cand.body_preview
        ));

        let q = serde_json::json!({
            "type": "noul",
            "instructions": "Does this remembered fact help answer or carry out the user's message?",
            "criteria": {
                "true": "The fact states a rule, decision, gotcha or preference that directly applies to what the message asks or does",
                "false": "The fact only shares vocabulary, or concerns a different project or topic"
            }
        });
        questions.insert(format!("rel_{i}"), q);
    }

    let resp = complete_decisions(
        &router_model(),
        &state,
        serde_json::Value::Object(questions),
    )?;

    parse_decisions_relevance(&resp, candidates.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_decisions_relevance_multiple_questions() {
        let json = serde_json::json!({
            "answers": {
                "rel_0": {
                    "type": "noul",
                    "noul": 0.95
                },
                "rel_1": {
                    "type": "noul",
                    "noul": 0.12
                },
                "rel_2": {
                    "type": "noul",
                    "noul": 0.78
                }
            }
        });
        let probs = parse_decisions_relevance(&json, 3).unwrap();
        assert_eq!(probs, vec![0.95, 0.12, 0.78]);
    }

    #[test]
    fn test_parse_decisions_relevance_missing_question() {
        let json = serde_json::json!({
            "answers": {
                "rel_0": {
                    "type": "noul",
                    "noul": 0.95
                }
            }
        });
        assert!(parse_decisions_relevance(&json, 2).is_err());
    }

    #[test]
    fn test_parse_decisions_relevance_non_numeric() {
        let json = serde_json::json!({
            "answers": {
                "rel_0": {
                    "type": "noul",
                    "noul": "high"
                }
            }
        });
        assert!(parse_decisions_relevance(&json, 1).is_err());
    }
}
