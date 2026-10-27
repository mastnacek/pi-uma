//! Recall: fastbrain-gated memory recall (the S3 compromise).
//!
//! **Read-only.** This slice answers one question — *is memory worth
//! searching for this prompt, and if so, which facts?* — and never mutates.
//! It exists because auto-injection was paused deliberately (operator
//! preference: uncontrolled injection caused context noise); the gate makes
//! injection *conditional* instead of absent.
//!
//! Flow: the judge (offline markers or Jev via OpenRouter) decides whether
//! the prompt may depend on remembered facts; only on a trigger does a BM25
//! keyword search run — never a network semantic call, because recall must
//! not add latency or cost to every turn. The caller decides what to do with
//! the hits; UMA itself injects nothing.

use anyhow::Result;
use clap::{Args, Subcommand};
use uma_core::fastbrain::{self, Judge};
use uma_core::search::SearchHit;

mod priming;
mod threshold;

pub use threshold::*;

#[derive(Args, Debug, Clone)]
pub struct RecallArgs {
    #[command(subcommand)]
    pub command: RecallCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub enum RecallCommand {
    /// Check a prompt for memory triggers and recall matching facts (read-only)
    Check(CheckArgs),
}

#[derive(Args, Debug, Clone)]
pub struct CheckArgs {
    /// The prompt to check (joined if several arguments are given)
    pub prompt: Vec<String>,

    /// Which judge to use: off (default), jev, always, or jev-relevance
    #[arg(long = "judge", default_value = "off", value_parser = ["off", "jev", "always", "jev-relevance"])]
    pub judge: String,

    /// Minimum probability threshold for memory recall trigger (default 0.5, env UMA_RECALL_MIN_PROB / UMA_RELEVANCE_MIN_PROB)
    #[arg(long = "min-prob")]
    pub min_prob: Option<f64>,

    /// Maximum facts to recall
    #[arg(long = "max", default_value_t = 3)]
    pub max: usize,

    /// Fact IDs removed from the ranking competition before the limit is
    /// applied (the recall gate's anti-echo: facts the session already
    /// injected). Repeatable.
    #[arg(long = "exclude", value_name = "ID")]
    pub exclude: Vec<String>,

    /// Alternative prompt for bilingual candidate retrieval (e.g. original language before translation)
    #[arg(long = "alt-prompt")]
    pub alt_prompt: Option<String>,

    /// Emit the verdict and recalled facts as JSON
    #[arg(long = "json")]
    pub json: bool,
}

/// Executes the Recall vertical slice.
pub fn run(args: RecallArgs) -> Result<()> {
    match args.command {
        RecallCommand::Check(check) => check_prompt(check),
    }
}

fn judge_from_name(name: &str) -> Judge {
    match name {
        "jev" => Judge::Jev,
        _ => Judge::Offline,
    }
}

/// Recall verdict: trigger plus the facts worth showing.
#[derive(serde::Serialize)]
pub(crate) struct RecallVerdict {
    pub(crate) search: bool,
    pub(crate) judged_by: String,
    pub(crate) fact_types: Vec<String>,
    pub(crate) probability: Vec<f64>,
    pub(crate) recalled: usize,
    pub(crate) facts: Vec<serde_json::Value>,
    pub(crate) note: Option<String>,
}

fn check_prompt(args: CheckArgs) -> Result<()> {
    if args.prompt.is_empty() {
        anyhow::bail!("Nothing to check: pass the prompt text");
    }
    let prompt = args.prompt.join(" ");

    if args.judge == "jev-relevance" {
        return relevance::check_prompt(args);
    }

    if args.judge == "always" {
        // Forced search without type filters: deterministic baseline for evaluation
        // and scenarios, separating retrieval errors from judge classification errors.
        let (facts, search_notes) =
            recall_facts_with_alt(&prompt, args.alt_prompt.as_deref(), args.max, &args.exclude)?;
        let note = if search_notes.is_empty() {
            None
        } else {
            Some(search_notes.join("; "))
        };
        return emit(
            &RecallVerdict {
                search: true,
                judged_by: "always".to_string(),
                fact_types: Vec::new(),
                probability: Vec::new(),
                recalled: facts.len(),
                facts,
                note,
            },
            args.json,
        );
    }

    // judge_recall_need already degrades Jev to offline with a note when the
    // transport fails, so one call covers both transports and their failure.
    let verdict =
        fastbrain::judge_recall_need(&prompt, judge_from_name(&args.judge), args.min_prob)
            .map_err(|failure| anyhow::anyhow!("Recall check failed: {failure}"))?;
    let need = &verdict.answer;

    // No trigger means no search at all: the whole point of the gate.
    if !need.search {
        return emit(
            &RecallVerdict {
                search: false,
                judged_by: verdict.judged_by.as_str().to_string(),
                fact_types: Vec::new(),
                probability: need.probability.clone(),
                recalled: 0,
                facts: Vec::new(),
                note: verdict.notes,
            },
            args.json,
        );
    }

    let (facts, search_notes) =
        recall_facts_with_alt(&prompt, args.alt_prompt.as_deref(), args.max, &args.exclude)?;
    // Merge provenance (judge note) with the search's degradation notes so a
    // relaxed recall is visible in the verdict, not silently presented as a
    // precise match.
    let note = match (verdict.notes.clone(), search_notes.is_empty()) {
        (Some(judge_note), true) => Some(judge_note),
        (Some(judge_note), false) => Some(format!("{judge_note}; {}", search_notes.join("; "))),
        (None, false) => Some(search_notes.join("; ")),
        (None, true) => None,
    };
    emit(
        &RecallVerdict {
            search: true,
            judged_by: verdict.judged_by.as_str().to_string(),
            fact_types: need.fact_types.clone(),
            probability: need.probability.clone(),
            recalled: facts.len(),
            facts,
            note,
        },
        args.json,
    )
}

pub(crate) fn emit(verdict: &RecallVerdict, json: bool) -> Result<()> {
    if json {
        println!("{}", serde_json::to_string_pretty(verdict)?);
        return Ok(());
    }

    if !verdict.search {
        println!(
            "No memory trigger — recall skipped (judge {})",
            verdict.judged_by
        );
    } else {
        println!(
            "Recall trigger: {} (judge {}, {} fact(s))",
            if verdict.fact_types.is_empty() {
                "general".to_string()
            } else {
                verdict.fact_types.join(", ")
            },
            verdict.judged_by,
            verdict.recalled
        );
        for (idx, fact) in verdict.facts.iter().enumerate() {
            let rel_str = if let Some(p) = fact.get("relevance").and_then(|v| v.as_f64()) {
                format!(" [p={:.2}]", p)
            } else {
                String::new()
            };
            println!(
                "{}. [{}] {} — {}{}",
                idx + 1,
                fact["fact_type"].as_str().unwrap_or("?"),
                fact["title"].as_str().unwrap_or("?"),
                fact["id"].as_str().unwrap_or("?"),
                rel_str
            );
        }
    }
    if let Some(ref note) = verdict.note {
        println!("note: {note}");
    }
    Ok(())
}

/// Minimum absolute score for a fact or primed neighbor to be recalled.
///
/// Discards low-confidence hits, partial OR matches, and cross-topic trap noise
/// while preserving strong, high-signal matches.
///
/// Scenario proof (`npm run scenarios -- --judge always`):
/// - All 16 expected facts have score >= 12.7.
/// - False positive sums in negatives/traps are 9.8 and 9.9 (live test: NEG-5
///   "Keep hook logic pure" 9.9, TRAP-1 time-theme-switcher 9.9).
/// - Threshold 12 holds 16/16 expected facts while reducing extra facts from 16 to 7.
/// - Threshold 14 would lose 4 expected facts, so it cannot be higher.
pub const MIN_ABSOLUTE_SCORE: f64 = 12.0;

/// Relative score threshold ratio compared to the best hit in the candidate pool.
///
/// Any hit with a score below ~50% of the top candidate's score is considered noise
/// and discarded (e.g. for scores 24.7, 4.6, 4.4, only 24.7 is retained because
/// 4.6 and 4.4 fall far below 50% of 24.7).
pub const RELATIVE_SCORE_RATIO: f64 = 0.5;

/// Evaluates whether a score passes the recall quality gate:
/// 1. Must be strictly positive (> 0.0)
/// 2. Must meet or exceed the absolute minimum threshold (`MIN_ABSOLUTE_SCORE`)
/// 3. Must meet or exceed the relative score threshold (~50% of `best_score`)
pub fn passes_recall_threshold(score: f64, best_score: f64) -> bool {
    if score.is_nan() || score <= 0.0 {
        return false;
    }
    if score < MIN_ABSOLUTE_SCORE {
        return false;
    }
    if score < best_score * RELATIVE_SCORE_RATIO {
        return false;
    }
    true
}

pub(crate) struct RawCandidate {
    pub(crate) hit: SearchHit,
}

/// Recalls facts for the trigger: collects candidates across all fact types,
/// ranks them globally by score, and applies quality thresholds.
/// If bilingual retrieval is enabled and alt_prompt is given, pools both
/// and merges them before returning.
pub(crate) fn recall_facts_with_alt(
    prompt: &str,
    alt_prompt: Option<&str>,
    max: usize,
    exclude: &[String],
) -> Result<(Vec<serde_json::Value>, Vec<String>)> {
    let (cands_primary, note_primary) = retrieve_candidate_pool(prompt, exclude, max)?;
    let (candidate_pool, note) =
        if is_bilingual_enabled() && alt_prompt.map(|s| !s.trim().is_empty()).unwrap_or(false) {
            let alt_text = alt_prompt.unwrap().trim();
            let (cands_alt, note_alt) = retrieve_candidate_pool(alt_text, exclude, max)?;
            let merged = merge_candidate_pools(cands_primary, cands_alt, max);
            let combined_note = match (note_primary, note_alt) {
                (Some(n1), Some(n2)) if n1 == n2 => Some(n1),
                (Some(n1), Some(n2)) => Some(format!("{n1}; {n2}")),
                (Some(n), None) | (None, Some(n)) => Some(n),
                (None, None) => None,
            };
            (merged, combined_note)
        } else {
            (cands_primary, note_primary)
        };

    let mut facts = Vec::new();
    let mut notes = Vec::new();
    if let Some(n) = note {
        notes.push(n);
    }

    for c in candidate_pool {
        facts.push(serde_json::json!({
            "id": c.hit.id,
            "title": c.hit.title,
            "fact_type": c.hit.fact_type,
            "scope": c.hit.scope,
            "score": c.hit.score,
            "snippet": c.hit.snippet,
            "tags": c.hit.tags,
        }));
    }

    Ok((facts, notes))
}

/// Builds the search query from the prompt: meaningful words only, capped, so
/// BM25 keeps signal instead of matching everything vaguely.
pub(crate) fn recall_query(prompt: &str) -> String {
    const NOISE: &[&str] = &[
        "the", "and", "for", "with", "that", "this", "please", "could", "would", "does", "jak",
        "pro", "nebo", "když", "aby", "tedy",
    ];
    prompt
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| word.chars().count() > 2 && !NOISE.contains(&word.to_lowercase().as_str()))
        .take(12)
        .map(str::to_string)
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests;

mod relevance;
