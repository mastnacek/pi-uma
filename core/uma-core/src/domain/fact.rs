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
    pub verified: Vec<ActorEvent>,
    pub validity: Validity,
    pub tags: Vec<String>,
    pub links: Vec<FactId>,
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
            verified: vec![ActorEvent::new("human:operator")],
            validity: Validity::default(),
            tags: Vec::new(),
            links: Vec::new(),
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

    /// Computes the effective synaptic weight at the given timestamp.
    pub fn effective_weight(&self, now: DateTime<Utc>) -> f64 {
        let immune = self.saliency.as_ref().map(|s| s.immune_to_decay).unwrap_or(false);
        self.plasticity
            .as_ref()
            .map(|p| p.effective_weight(now, immune))
            .unwrap_or(1.0)
    }

    /// True if the fact is a rotting zombie rule (weight dropped below threshold).
    pub fn is_zombie(&self, now: DateTime<Utc>, threshold: f64) -> bool {
        self.status == FactStatus::Stable && self.effective_weight(now) < threshold
    }
}
