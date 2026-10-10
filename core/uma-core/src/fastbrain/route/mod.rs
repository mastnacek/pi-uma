//! Task routing: which specialist should receive this prompt (Proposal 09).
//!
//! The orchestrator's System-1 decision. Given a prompt and the delegation
//! targets that exist (herdr panes, one per UMA scope), the router answers
//! *who should get this* — deterministically offline, semantically via Jev
//! (Fáze D), with the orchestrator's own model as the escalation floor for
//! anything the cheap layers cannot decide.
//!
//! **Read-only verdict, same contract as skeptic/humility:** the core
//! proposes, the plugin acts. No delegation ever happens in uma-core — the
//! verdict crosses the process boundary and the orchestrator's pi plugin
//! executes `herdr tab create` / `agent prompt` itself.
//!
//! Confidence contract: a verdict is only *confident* when the winner clears
//! both an absolute bar and a margin over the runner-up. Anything else
//! returns `specialist: None` — escalate, never guess. A guessed route is
//! worse than no route: it burns a pane on the wrong project.

use serde::Serialize;

use super::{Backend, Judge, Judgment};
use crate::similarity::tokenize;

/// A delegation target the router may pick — one herdr pane / UMA scope.
#[derive(Debug, Clone, PartialEq)]
pub struct Specialist {
    /// Scope/pane name, e.g. `pi-uma` or `global`.
    pub name: String,
    /// Domain markers: scope-name tokens, file stems, top tags. Matching is
    /// substring-based on the lowercased prompt, so keep them distinctive.
    pub keywords: Vec<String>,
}

impl Specialist {
    /// Builds a candidate from a bare scope name, deriving keywords from its
    /// tokens: `mozek_rust` → keywords `mozek`, `rust`.
    pub fn from_scope_name(name: &str) -> Self {
        let keywords = name
            .split(|c: char| !c.is_alphanumeric())
            .filter(|token| token.len() >= 3)
            .map(|token| token.to_lowercase())
            .collect();
        Self {
            name: name.to_string(),
            keywords,
        }
    }
}

/// The router's answer.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RouteVerdict {
    /// Where the prompt should go. `None` means *no cheap layer can tell* —
    /// escalate to the orchestrator model, never guess.
    pub specialist: Option<String>,
    /// Second-best candidate, surfaced so the escalation prompt can offer
    /// the operator a two-button choice instead of an open question.
    pub runner_up: Option<String>,
    /// Every candidate's raw score, for the dashboard and eval harness.
    pub scores: Vec<(String, f64)>,
}

/// Absolute score a winner must reach to count as a route at all.
const MIN_WINNING_SCORE: f64 = 0.25;
/// Lead over the runner-up a winner must have to be confident.
const MIN_MARGIN: f64 = 0.15;

/// Routes a prompt to a specialist, honoring the requested judge.
///
/// Jev routing is Fáze D — until then the Jev branch degrades to offline
/// with a visible note, matching the module invariant that a judged answer
/// and a guessed answer must never look the same.
pub fn route_task(
    prompt: &str,
    candidates: &[Specialist],
    judge: Judge,
) -> Result<Judgment<RouteVerdict>, String> {
    match judge {
        Judge::Offline => Ok(route_offline(prompt, candidates)),
        Judge::Jev => {
            let mut degraded = route_offline(prompt, candidates);
            degraded.judged_by = Backend::Offline;
            degraded.confidence *= 0.5;
            degraded.notes =
                Some("Jev routing is not implemented yet (Fáze D); offline verdict".to_string());
            Ok(degraded)
        }
    }
}

/// Deterministic offline routing over candidate keywords.
///
/// Score = (keyword hits + name bonus) / (keyword count + 1), where a hit is
/// a candidate marker appearing in the prompt and the name bonus rewards
/// mentioning the pane outright. Token overlap (`tokenize`) would punish
/// long prompts; substring hits keep a 200-word brief routable when it names
/// its target once.
fn route_offline(prompt: &str, candidates: &[Specialist]) -> Judgment<RouteVerdict> {
    let lower = prompt.to_lowercase();
    let prompt_tokens = tokenize(prompt);

    let mut scores: Vec<(String, f64)> = candidates
        .iter()
        .map(|candidate| {
            let name_hit = usize::from(
                candidate.name.len() >= 3 && lower.contains(&candidate.name.to_lowercase()),
            );
            let keyword_hits = candidate
                .keywords
                .iter()
                .filter(|kw| {
                    lower.contains(kw.as_str())
                        || prompt_tokens.iter().any(|token| token == *kw)
                })
                .count();
            let score =
                (keyword_hits + name_hit) as f64 / (candidate.keywords.len() + 1) as f64;
            (candidate.name.clone(), score)
        })
        .collect();

    // Deterministic order: score desc, name asc as tiebreak — same prompt,
    // same verdict, on every machine.
    scores.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.0.cmp(&b.0))
    });

    let (winner, runner_up) = (scores.first(), scores.get(1));
    let winning_score = winner.map(|(_, s)| *s).unwrap_or(0.0);
    let runner_score = runner_up.map(|(_, s)| *s).unwrap_or(0.0);
    let margin = winning_score - runner_score;

    let confident = winner.is_some()
        && winning_score >= MIN_WINNING_SCORE
        && margin >= MIN_MARGIN;

    let verdict = RouteVerdict {
        specialist: if confident {
            winner.map(|(name, _)| name.clone())
        } else {
            None
        },
        runner_up: runner_up
            .filter(|(_, s)| *s > 0.0)
            .map(|(name, _)| name.clone()),
        scores,
    };

    // Confidence mirrors decisiveness: a clear winner reports its margin-
    // weighted score; an escalation reports how *little* evidence there was.
    let confidence = if confident {
        (winning_score + margin).min(1.0)
    } else {
        winning_score
    };

    Judgment {
        answer: verdict,
        confidence,
        judged_by: Backend::Offline,
        notes: None,
    }
}

#[cfg(test)]
mod tests;
