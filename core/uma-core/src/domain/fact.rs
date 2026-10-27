use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::cognitive::{Contract, Plasticity, Saliency};
use super::types::{ActorEvent, FactId, FactStatus, FactType, Scope, Validity};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fact {
    pub id: FactId,
    pub scope: Scope,
    pub fact_type: FactType,
    pub title: String,
    pub description: Option<String>,
    /// Invocation template for `skill` facts. Placeholders are written `{{name}}`.
    /// It is data only — UMA expands it and prints the result, but never executes it.
    pub template: Option<String>,
    /// Executable AST invariant contract (Proposal 03a). When present with severity=deny,
    /// it gates the cognitive immune interceptor block-mode and generates CI integration tests.
    pub contract: Option<Contract>,
    /// Synaptic plasticity metadata (Proposal 03b / Hebbian learning): dynamic fitness weight and decay.
    pub plasticity: Option<Plasticity>,
    /// Saliency and emotional valence (Proposal 05a): shock level and decay immunity.
    pub saliency: Option<Saliency>,
    pub body: String,
    pub status: FactStatus,
    pub supersedes: Option<FactId>,
    pub generated: Option<ActorEvent>,
    /// Provenance entries. Absent in older records and legitimately empty when
    /// no review happened — a missing collection must never make a record
    /// unreadable. (2026-10-15: adding `spai` without a default silently
    /// orphaned every draft written before it; the staging reader then dropped
    /// them without a word.)
    #[serde(default)]
    pub verified: Vec<ActorEvent>,
    pub validity: Validity,
    pub tags: Vec<String>,
    #[serde(default)]
    pub links: Vec<FactId>,
    /// SPAI backlog item IDs this fact is linked to (e.g. "SPAI-035").
    /// Cross-reference only — SPAI stays the work ledger, UMA the knowledge base;
    /// task state itself must never enter the fact space (decision 01M4WVY8NVB2WNKKZH3497Y8K9).
    #[serde(default)]
    pub spai: Vec<String>,
    /// Domain tags restricting recall to projects that declare matching domains.
    #[serde(default)]
    pub domains: Vec<String>,
}

impl Fact {
    pub fn new(scope: Scope, fact_type: FactType, title: String, body: String) -> Self {
        Self {
            id: FactId::new(),
            scope,
            fact_type,
            title,
            description: None,
            template: None,
            contract: None,
            plasticity: None,
            saliency: None,
            body,
            status: FactStatus::Stable,
            supersedes: None,
            generated: Some(ActorEvent::new("pi-agent/1.1")),
            // Provenance is NOT fabricated here. A plain `Fact::new` is created
            // by an agent/MCP/distillation path, which is not human review; the
            // operator-approved slices (CLI write/supersede, staging approve)
            // record `human:operator` explicitly. The review flagged the old
            // blanket `verified: [human:operator]` as forged provenance.
            verified: Vec::new(),
            validity: Validity::default(),
            tags: Vec::new(),
            links: Vec::new(),
            spai: Vec::new(),
            domains: Vec::new(),
        }
    }

    /// Checks whether the fact is active and non-deprecated at the specified timestamp.
    pub fn is_active_at(&self, at: DateTime<Utc>) -> bool {
        if self.validity.since > at {
            return false;
        }
        if let Some(until) = self.validity.until {
            if at >= until {
                return false;
            }
        }
        if let Some(stale) = self.validity.stale_after {
            if at >= stale {
                return false;
            }
        }
        self.status == FactStatus::Stable
    }

    /// Computes the decay-only synaptic weight at the given timestamp.
    ///
    /// Plasticity decay (and saliency's decay immunity) only — no retrieval
    /// boost. This is the honest signal for zombie detection.
    pub fn decayed_weight(&self, now: DateTime<Utc>) -> f64 {
        let immune = self
            .saliency
            .as_ref()
            .map(|s| s.immune_to_decay)
            .unwrap_or(false);
        self.plasticity
            .as_ref()
            .map(|p| p.effective_weight(now, immune))
            .unwrap_or(1.0)
    }

    /// Computes the effective retention-review weight at the given timestamp.
    ///
    /// Decayed fitness boosted by the saliency multiplier, so a fact tagged
    /// as a painful regression is prioritized for doctor/dream retention
    /// review without becoming decay-immune. Bounded to [0.0, 1.0].
    ///
    /// SPAI-051: presented as RETENTION telemetry, never as a retrieval-
    /// priority number — search ranking deliberately does not consume this
    /// (see Saliency::effective_multiplier for the feedback-loop rationale).
    pub fn effective_weight(&self, now: DateTime<Utc>) -> f64 {
        let multiplier = self
            .saliency
            .as_ref()
            .map(|s| s.effective_multiplier())
            .unwrap_or(1.0);
        (self.decayed_weight(now) * multiplier).clamp(0.0, 1.0)
    }

    /// True if the fact is a rotting zombie rule (decayed weight below threshold).
    ///
    /// Uses the decay-only weight: a saliency boost must not hide a rule that
    /// has genuinely decayed out of use.
    pub fn is_zombie(&self, now: DateTime<Utc>, threshold: f64) -> bool {
        self.status == FactStatus::Stable && self.decayed_weight(now) < threshold
    }
}
