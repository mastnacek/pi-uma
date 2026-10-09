//! `uma doctor --dream`: nightly retrieval practice (Proposal 05, Pillar IV).
//!
//! The Testing Effect (Roediger & Karpicke): passive re-reading does not
//! strengthen memory — effortful active recall does. For facts approaching
//! their decay half-life, UMA generates a synthetic question (Jev), answers it
//! with the same fast model, and compares:
//! - correct → the fact's plasticity should be REINFORCED (weight reset toward 1.0)
//! - wrong   → the fact is "blurred"; propose operator review or supersession
//!
//! **Read-only for the store**: results are printed as proposals — a mutation
//! must still pass the approval modal, per the standing consent model.

use std::path::Path;

use chrono::{DateTime, Utc};
use uma_core::domain::Fact;
use uma_core::fastbrain::{self, Judge};

/// One dream result: the question, the answer, and the proposal.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DreamResult {
    pub fact_id: String,
    pub title: String,
    pub effective_weight: f64,
    pub question: String,
    pub answer: String,
    pub correct: bool,
    pub judged_by: String,
    pub proposal: String,
}

/// Picks the facts nearest their half-life (lowest effective weight, stable only).
pub fn dream_candidates(facts: &[Fact], now: DateTime<Utc>, max: usize) -> Vec<Fact> {
    let mut decayed: Vec<(f64, &Fact)> = facts
        .iter()
        .filter(|f| f.status == uma_core::domain::FactStatus::Stable && f.plasticity.is_some() && f.is_active_at(now))
        .filter_map(|f| {
            let w = f.effective_weight(now);
            // Only facts actually decaying (not immune, below 0.9) are worth testing.
            let immune = f.saliency.as_ref().map(|s| s.immune_to_decay).unwrap_or(false);
            if immune || w >= 0.9 {
                None
            } else {
                Some((w, f))
            }
        })
        .collect();
    decayed.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    decayed.into_iter().take(max).map(|(_, f)| f.clone()).collect()
}

/// Runs one dream pass over the given candidates. Network judge (Jev) for both
/// question synthesis and answering; `Judge::Offline` degrades to a lexical
/// overlap check between the fact body and a restated question.
pub fn run_dream(
    candidates: &[Fact],
    now: DateTime<Utc>,
    judge: Judge,
    json: bool,
) -> anyhow::Result<Vec<DreamResult>> {
    let mut results = Vec::new();

    for fact in candidates {
        let weight = fact.effective_weight(now);
        let question = match judge {
            Judge::Jev => fastbrain::dream::dream_question(fact),
            Judge::Offline => Ok(fastbrain::offline::dream_question(fact)),
        }
        .unwrap_or_else(|_| format!("What does the rule about {} state?", fact.title));

        let (answer, correct, judged_by) = match judge {
            Judge::Jev => match fastbrain::dream::dream_answer(&question, fact) {
                Ok(judgment) => (judgment.answer.answer, judgment.answer.correct, judgment.judged_by.as_str().to_string()),
                Err(failure) => {
                    // Degrade to offline check, visibly.
                    let off = fastbrain::offline::dream_answer(&question, fact);
                    (off.0, off.1, format!("offline (Jev failed: {})", truncate(failure, 60)))
                }
            },
            Judge::Offline => {
                let (a, c) = fastbrain::offline::dream_answer(&question, fact);
                (a, c, "offline".to_string())
            }
        };

        let proposal = if correct {
            format!(
                "REINFORCE: reset plasticity of {} toward 1.0 (retrieval succeeded at weight {:.2}). Propose via modal: uma supersede with fresh stale_after.",
                fact.id, weight
            )
        } else {
            format!(
                "BLURRED: answer wrong or off-topic at weight {:.2}. Review {} \"{}\"; consider supersession with a clearer rule.",
                weight, fact.id, fact.title
            )
        };

        results.push(DreamResult {
            fact_id: fact.id.to_string(),
            title: fact.title.clone(),
            effective_weight: weight,
            question,
            answer,
            correct,
            judged_by,
            proposal,
        });
    }

    if json {
        println!("{}", serde_json::to_string_pretty(&results)?);
        return Ok(results);
    }

    if results.is_empty() {
        println!("Dream: no facts nearing decay — nothing to practice.");
        return Ok(results);
    }

    println!("Dream (retrieval practice) — {} fact(s) tested:\n", results.len());
    for (idx, r) in results.iter().enumerate() {
        println!(
            "{}. {} (weight {:.2}) [{}, {}]",
            idx + 1,
            r.title,
            r.effective_weight,
            r.judged_by,
            if r.correct { "✓ correct" } else { "✗ blurred" }
        );
        println!("   Q: {}", r.question);
        println!("   A: {}", truncate(&r.answer, 120));
        println!("   → {}", r.proposal);
        println!();
    }
    println!("Dream results are PROPOSALS: reinforcing or archiving passes the approval modal.");
    Ok(results)
}

fn truncate(text: impl std::fmt::Display, width: usize) -> String {
    let text = text.to_string();
    if text.chars().count() <= width {
        text.to_string()
    } else {
        let head: String = text.chars().take(width).collect();
        format!("{head}…")
    }
}

/// Convenience wrapper used by the doctor slice: gathers roots, picks candidates, runs the pass.
pub fn dream_over_roots(
    roots: &[Option<&Path>],
    now: DateTime<Utc>,
    judge: Judge,
    dream_max: usize,
    json: bool,
) -> anyhow::Result<()> {
    let mut all = Vec::new();
    for root in roots.iter().flatten() {
        if root.exists() {
            let store = uma_core::store::Store::new(root.to_path_buf());
            if let Ok(facts) = store.list_all() {
                all.extend(facts);
            }
        }
    }
    let candidates = dream_candidates(&all, now, dream_max);
    run_dream(&candidates, now, judge, json)?;
    Ok(())
}