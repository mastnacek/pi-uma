//! Pillar IV: Epistemic humility — the Familiarity Index (Proposal 04).
//!
//! "The mark of a master is knowing when you don't know." Before an agent
//! mutates a subsystem with no memory coverage and complex constructs (macros,
//! FFI), the Familiarity Index decides whether it must first enter
//! **Read-Only Explorative Mode**: read at least 3 related files, state its
//! understanding as a hypothesis, and only then touch the code.
//!
//! **Invariants:** the verdict is advisory-for-the-operator but the
//! explorative-mode REQUIREMENT itself is a deterministic rule over counts
//! (memory coverage + exploration evidence) — no probabilistic verdict may
//! silently veto; the operator gate asks, it never blocks unasked.

use serde::{Deserialize, Serialize};

use crate::fastbrain::Backend;

#[cfg(test)]
mod tests;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Familiarity {
    Low,
    Medium,
    High,
}

impl Familiarity {
    pub fn as_str(self) -> &'static str {
        match self {
            Familiarity::Low => "low",
            Familiarity::Medium => "medium",
            Familiarity::High => "high",
        }
    }
}

/// The Humility verdict on a subsystem intervention.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HumilityVerdict {
    pub familiarity: Familiarity,
    /// How many memory facts cover the target files.
    pub fact_coverage: usize,
    /// Complexity constructs detected (ffi, macros, unsafe, bindings).
    pub complexity_signals: Vec<String>,
    /// Read-Only Explorative Mode required before the first mutation.
    pub exploration_required: bool,
    /// The agent must state its understanding as a hypothesis.
    pub hypothesis_required: bool,
    pub advice: String,
    pub judged_by: Backend,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct HumilityInput {
    pub intent: String,
    pub files: Vec<String>,
    /// Memory facts (any type) mentioning the target files or their stems.
    pub fact_coverage: usize,
}

/// Keywords marking constructs where unexplored mutation is hazardous.
pub const COMPLEXITY_MARKERS: &[&str] = &[
    "ffi",
    "extern",
    "unsafe",
    "macro",
    "asm",
    "binding",
    "link",
    "napi",
    "wasm",
    "macro_rules",
];

/// Detects complexity markers in the intent and file paths.
pub fn complexity_signals(intent: &str, files: &[String]) -> Vec<String> {
    let haystack = format!("{} {}", intent, files.join(" ")).to_lowercase();
    COMPLEXITY_MARKERS
        .iter()
        .filter(|m| haystack.contains(*m))
        .map(|m| (*m).to_string())
        .collect()
}

/// Deterministic offline floor over the counts the caller supplies.
pub fn offline_familiarity(input: &HumilityInput) -> HumilityVerdict {
    let signals = complexity_signals(&input.intent, &input.files);

    let familiarity = match input.fact_coverage {
        0 => Familiarity::Low,
        1..=2 => Familiarity::Medium,
        _ => Familiarity::High,
    };

    let exploration_required = familiarity != Familiarity::High;
    let advice = match familiarity {
        Familiarity::Low => format!(
            "No memory records cover these files{}; enter Read-Only Explorative Mode: \
             read at least 3 related files, state your understanding as a hypothesis, \
             and only then make the first mutation.",
            if signals.is_empty() {
                String::new()
            } else {
                format!(" (complexity signals: {})", signals.join(", "))
            }
        ),
        Familiarity::Medium => {
            "Partial memory coverage — verify the records are current before mutating.".to_string()
        }
        Familiarity::High => {
            "Memory covers this subsystem; standard review discipline applies.".to_string()
        }
    };

    HumilityVerdict {
        familiarity,
        fact_coverage: input.fact_coverage,
        complexity_signals: signals,
        exploration_required,
        hypothesis_required: exploration_required,
        advice,
        judged_by: Backend::Offline,
        notes: None,
    }
}

/// Consults the Familiarity Index with the requested judge.
pub fn assess_familiarity(
    input: &HumilityInput,
    judge: crate::fastbrain::Judge,
) -> Result<HumilityVerdict, String> {
    match judge {
        crate::fastbrain::Judge::Offline => Ok(offline_familiarity(input)),
        crate::fastbrain::Judge::Jev => match super::humility_transport::familiarity(input) {
            Ok(verdict) => Ok(verdict),
            Err(failure) => {
                let mut degraded = offline_familiarity(input);
                degraded.judged_by = Backend::Offline;
                degraded.notes = Some(format!("Jev unavailable ({failure}); offline verdict"));
                Ok(degraded)
            }
        },
    }
}