//! Plasticity: reinforcement and frustration of synaptic fitness (SPAI-050).
//!
//! The Hebbian counters (`Plasticity.reinforcements` / `.frustrations`) had
//! zero call sites — computed, displayed, never driven. This slice gives them
//! their two honest, observable triggers:
//!
//! - **reinforce** — an outcome that confirmed the fact's usefulness: the
//!   operator *upheld* a contract rule in the immune consent dialog, or the
//!   recall gate *activated* the fact into a live session (once per session,
//!   bounded by the anti-echo exclusion).
//! - **frustrate** — an outcome that contradicted it: the operator *overrode*
//!   a rule and proceeded with the edit it warned about.
//!
//! These are observable-outcome bookkeeping, not semantic content: nothing
//! the operator reads as a memory claim changes, so the writes stay exempt
//! from the approval modal (which guards fact bodies/rules). Everything else
//! about a mutation still applies: the secrets gate runs on every store
//! write, and the CLI bash-bypass guard treats this subcommand as mutating.

use anyhow::{Context, Result};
use chrono::Utc;
use clap::{Args, Subcommand};
use std::str::FromStr as _;
use uma_core::domain::{FactId, Plasticity};
use uma_core::store::Store;

use crate::shared::store_helper::get_store;

#[derive(Args, Debug, Clone)]
pub struct PlasticityArgs {
    #[command(subcommand)]
    pub command: PlasticityCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub enum PlasticityCommand {
    /// Reinforce facts after an outcome that confirmed their usefulness
    Reinforce(OutcomeArgs),
    /// Frustrate facts after an outcome that contradicted them (LTD)
    Frustrate(OutcomeArgs),
}

#[derive(Args, Debug, Clone)]
pub struct OutcomeArgs {
    /// Fact IDs (ULIDs); several may be given for one outcome event
    pub ids: Vec<String>,

    /// Emit results as JSON
    #[arg(long = "json")]
    pub json: bool,
}

/// Executes the Plasticity vertical slice.
pub fn run(args: PlasticityArgs) -> Result<()> {
    match args.command {
        PlasticityCommand::Reinforce(outcome) => apply(outcome, Kind::Reinforce),
        PlasticityCommand::Frustrate(outcome) => apply(outcome, Kind::Frustrate),
    }
}

enum Kind {
    Reinforce,
    Frustrate,
}

impl Kind {
    fn name(&self) -> &'static str {
        match self {
            Kind::Reinforce => "reinforce",
            Kind::Frustrate => "frustrate",
        }
    }
}

struct Outcome {
    id: String,
    weight: f64,
    reinforcements: u32,
    frustrations: u32,
}

/// Applies one outcome event to every named fact. One event, one transaction
/// feel: each fact is read, decay-baked, adjusted, and written independently,
/// so a bad ID among good ones degrades to a per-ID error, never the batch.
fn apply(args: OutcomeArgs, kind: Kind) -> Result<()> {
    let mut outcomes: Vec<Outcome> = Vec::new();
    let mut failures: Vec<String> = Vec::new();

    for raw in &args.ids {
        let result = apply_one(raw, &kind);
        match result {
            Ok(outcome) => outcomes.push(outcome),
            Err(err) => failures.push(format!("{}: {}", raw, err)),
        }
    }

    if args.json {
        println!(
            "{}",
            serde_json::json!({
                "command": kind.name(),
                "applied": outcomes.iter().map(|o| serde_json::json!({
                    "id": o.id,
                    "weight": o.weight,
                    "reinforcements": o.reinforcements,
                    "frustrations": o.frustrations,
                })).collect::<Vec<_>>(),
                "failed": failures,
            })
        );
    } else {
        for outcome in &outcomes {
            println!(
                "{} {}: weight {:.2} (reinforced {}x, frustrated {}x)",
                kind.name(),
                outcome.id,
                outcome.weight,
                outcome.reinforcements,
                outcome.frustrations,
            );
        }
        for failure in &failures {
            eprintln!("failed: {failure}");
        }
    }

    if outcomes.is_empty() && !failures.is_empty() {
        anyhow::bail!("no fact was updated");
    }
    Ok(())
}

fn apply_one(raw: &str, kind: &Kind) -> Result<Outcome> {
    let fact_id = FactId::from_str(raw).with_context(|| format!("invalid fact id {raw}"))?;
    let mut fact = Store::find_by_id(&fact_id)?;

    let now = Utc::now();
    // A fact written before Proposal 03b carries no plasticity metadata; the
    // default (weight 0.5, half-life 90d) is the honest starting state for it.
    let plasticity = fact.plasticity.take().unwrap_or_else(Plasticity::default);
    let mut plasticity = plasticity;
    match kind {
        Kind::Reinforce => plasticity.reinforce(now),
        Kind::Frustrate => plasticity.frustrate(now),
    }
    let outcome = Outcome {
        id: fact.id.to_string(),
        weight: if fact
            .saliency
            .as_ref()
            .map(|s| s.immune_to_decay)
            .unwrap_or(false)
        {
            plasticity.weight
        } else {
            plasticity.effective_weight(now, false)
        },
        reinforcements: plasticity.reinforcements,
        frustrations: plasticity.frustrations,
    };
    fact.plasticity = Some(plasticity);

    // The fact's own scope routes the write: find_by_id searches project,
    // global and the central index, and the write must land where it lives.
    let store = get_store(&fact.scope)?;
    store.write(&fact)?;
    Ok(outcome)
}
