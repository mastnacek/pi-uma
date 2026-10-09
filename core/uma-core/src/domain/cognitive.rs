use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ContractSeverity {
    Deny,
    Warn,
}

impl fmt::Display for ContractSeverity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ContractSeverity::Deny => write!(f, "deny"),
            ContractSeverity::Warn => write!(f, "warn"),
        }
    }
}

impl std::str::FromStr for ContractSeverity {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_lowercase().as_str() {
            "deny" => Ok(ContractSeverity::Deny),
            "warn" => Ok(ContractSeverity::Warn),
            other => anyhow::bail!("Unknown contract severity: {}", other),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContractRule {
    pub pattern: String,
    pub inside: Option<String>,
    pub message: String,
    pub language: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Contract {
    pub engine: String,
    pub severity: ContractSeverity,
    pub rule: ContractRule,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Plasticity {
    /// Synaptic fitness weight in [0.0, 1.0].
    pub weight: f64,
    /// Number of successful applications (Long-Term Potentiation).
    pub reinforcements: u32,
    /// Number of regressions or rejections (Long-Term Depression).
    pub frustrations: u32,
    /// Last time this fact was activated or referenced.
    pub last_activated: Option<DateTime<Utc>>,
    /// Half-life in days for exponential decay without activation (default 90).
    pub half_life_days: u32,
}

impl Default for Plasticity {
    fn default() -> Self {
        Self {
            weight: 0.5,
            reinforcements: 0,
            frustrations: 0,
            last_activated: Some(Utc::now()),
            half_life_days: 90,
        }
    }
}

impl Plasticity {
    /// Computes the effective weight taking exponential decay into account:
    /// W(t) = W_0 * (0.5)^(elapsed_days / half_life)
    pub fn effective_weight(&self, now: DateTime<Utc>, immune: bool) -> f64 {
        if immune || self.half_life_days == 0 {
            return self.weight;
        }
        let Some(last) = self.last_activated else {
            return self.weight;
        };
        let elapsed_seconds = (now - last).num_seconds().max(0) as f64;
        let elapsed_days = elapsed_seconds / 86400.0;
        let decay = 0.5f64.powf(elapsed_days / self.half_life_days as f64);
        (self.weight * decay).clamp(0.0, 1.0)
    }

    /// Reinforces the fact on successful use (LTP): min(1.0, W + 0.05).
    pub fn reinforce(&mut self, now: DateTime<Utc>) {
        self.weight = (self.weight + 0.05).min(1.0);
        self.reinforcements += 1;
        self.last_activated = Some(now);
    }

    /// Penalizes the fact on error or rejection (LTD): max(0.0, W - 0.25).
    pub fn frustrate(&mut self, now: DateTime<Utc>) {
        self.weight = (self.weight - 0.25).max(0.0);
        self.frustrations += 1;
        self.last_activated = Some(now);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Saliency {
    /// Emotional / operational shock level (1: low .. 5: critical / traumatic regression).
    pub shock_level: u8,
    /// Saliency multiplier for retrieval priority.
    pub multiplier: f64,
    /// If true, the fact is completely immune to temporal decay.
    pub immune_to_decay: bool,
}

impl Default for Saliency {
    fn default() -> Self {
        Self {
            shock_level: 1,
            multiplier: 1.0,
            immune_to_decay: false,
        }
    }
}
