//! Internal Council (Proposal 04): the adversarial Skeptic dialectic.
//!
//! Before an agent executes a risky plan, a synthetic Intent Statement is
//! submitted to the Skeptic — an independent System-1 judge whose only role is
//! to find the worst plausible failure scenario ("devil's advocate").
//!
//! **Invariants this module must not break:**
//! - The Skeptic is **advisory only** (on-demand): a probabilistic verdict may
//!   never silently veto work — auto-blocking stays reserved for deterministic
//!   contracts (recorded decision `01M4EP264QYX1FA23JQKT3GFQM`).
//! - A failed judge call degrades to the deterministic offline answer, visibly.
//! - No secret ever reaches a judge (the secrets gate runs first on anything
//!   a judge would see).

use serde::{Deserialize, Serialize};

pub(crate) mod jev_transport;

use crate::fastbrain::{Backend, Judge};

#[cfg(test)]
mod tests;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    Benign,
    Questionable,
    Dangerous,
}

impl RiskLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            RiskLevel::Benign => "benign",
            RiskLevel::Questionable => "questionable",
            RiskLevel::Dangerous => "dangerous",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureMode {
    ConcurrencyDeadlock,
    UnhandledNullEdgeCase,
    SilentDataCorruption,
    BreakingPublicContract,
    NoneAcceptableRisk,
}

impl FailureMode {
    pub fn as_str(self) -> &'static str {
        match self {
            FailureMode::ConcurrencyDeadlock => "concurrency_deadlock",
            FailureMode::UnhandledNullEdgeCase => "unhandled_null_edge_case",
            FailureMode::SilentDataCorruption => "silent_data_corruption",
            FailureMode::BreakingPublicContract => "breaking_public_contract",
            FailureMode::NoneAcceptableRisk => "none_acceptable_risk",
        }
    }
}

/// The Skeptic's verdict on a proposed intent.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SkepticCritique {
    /// The primary architectural failure mode the Skeptic identified.
    pub failure_mode: FailureMode,
    /// 0.0–1.0: how strongly the devil objects to proceeding without tests.
    pub devil_objection: f64,
    /// Overall risk band of the proposed action.
    pub risk_level: RiskLevel,
    /// One-paragraph adversarial warning for the agent's thought stream.
    pub advice: String,
    /// Which transport produced the verdict.
    pub judged_by: Backend,
    /// Set when Jev degraded to the offline answer.
    pub notes: Option<String>,
}

impl SkepticCritique {
    /// True when the verdict warrants injecting a warning into the agent's
    /// thought stream (dangerous, or a strong devil objection). Advisory only.
    pub fn warrants_warning(&self) -> bool {
        self.risk_level == RiskLevel::Dangerous || self.devil_objection > 0.70
    }
}

/// Inputs the caller gathers (risk gathering is the slice's job).
#[derive(Debug, Clone, Default)]
pub struct SkepticInput {
    /// Short synthetic statement of what the agent intends to do.
    pub intent: String,
    /// Files the intent will touch.
    pub files: Vec<String>,
    /// How many past correction facts mention these files (pain proxy).
    pub correction_mentions: usize,
    /// How many git reverts these files have (pain proxy).
    pub reverts: usize,
}

/// Consults the Skeptic with the requested judge.
///
/// Jev is the semantic devil's advocate; offline is the deterministic floor
/// built from the pain proxies the caller supplies.
pub fn consult_skeptic(
    input: &SkepticInput,
    judge: Judge,
) -> Result<SkepticCritique, String> {
    match judge {
        Judge::Offline => offline_skeptic(input),
        Judge::Jev => match jev_transport::skeptic(input) {
            Ok(critique) => Ok(critique),
            Err(failure) => {
                let mut degraded = offline_skeptic(input)?;
                degraded.judged_by = Backend::Offline;
                degraded.devil_objection *= 0.5;
                degraded.notes = Some(format!("Jev unavailable ({failure}); offline verdict"));
                Ok(degraded)
            }
        },
    }
}

/// Deterministic offline skeptic: pain proxies → risk band → canned advice.
fn offline_skeptic(input: &SkepticInput) -> Result<SkepticCritique, String> {
    // Same weights as the pain score: corrections x15 (cap 45) + reverts x20 (cap 60).
    let mention_points = (input.correction_mentions as u32 * 15).min(45);
    let revert_points = (input.reverts as u32 * 20).min(60);
    let pain = (mention_points + revert_points).min(100) as f64;
    let objection = (pain / 100.0).clamp(0.0, 1.0);

    let risk_level = if pain >= 61.0 {
        RiskLevel::Dangerous
    } else if pain >= 21.0 {
        RiskLevel::Questionable
    } else {
        RiskLevel::Benign
    };

    // Keyword heuristics over the intent for the failure mode (file paths are
    // excluded: a file named `indexer/` must not classify the intent as data
    // corruption on its own).
    let lower = input.intent.to_lowercase();
    let failure_mode = if lower.contains("lock") || lower.contains("concurren") || lower.contains("thread") || lower.contains("async") {
        FailureMode::ConcurrencyDeadlock
    } else if lower.contains("unwrap") || lower.contains("null") || lower.contains("none") || lower.contains("option") {
        FailureMode::UnhandledNullEdgeCase
    } else if lower.contains("index") || lower.contains("write") || lower.contains("store") || lower.contains("migrat") {
        FailureMode::SilentDataCorruption
    } else if lower.contains("api") || lower.contains("contract") || lower.contains("schema") || lower.contains("public") {
        FailureMode::BreakingPublicContract
    } else {
        FailureMode::NoneAcceptableRisk
    };

    let advice = match risk_level {
        RiskLevel::Dangerous => format!(
            "These files carry pain score {:.0}/100 from past corrections and reverts. \
             Write the failing test first and design the lock/error handling before touching code.",
            pain
        ),
        RiskLevel::Questionable => format!(
            "Pain score {:.0}/100: proceed carefully and run the affected tests after the edit.",
            pain
        ),
        RiskLevel::Benign => {
            "No recorded pain for these files; standard review discipline applies.".to_string()
        }
    };

    Ok(SkepticCritique {
        failure_mode,
        devil_objection: objection,
        risk_level,
        advice,
        judged_by: Backend::Offline,
        notes: None,
    })
}
