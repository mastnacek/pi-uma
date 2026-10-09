//! Store and index inspection for the health report.
//!
//! All SQL lives in `uma_core::health`, so this slice needs no database
//! dependency of its own and the read-only guarantee is enforced in one place
//! (the index is opened with `SQLITE_OPEN_READ_ONLY`).

use std::path::Path;

use chrono::{DateTime, Utc};
use uma_core::domain::{Fact, FactStatus};
use uma_core::health::{inspect, IndexHealth};

use super::findings::{fail, ok, warn, Finding};

/// Reports whether a store root exists, without creating it.
pub fn root_finding(label: &'static str, root: &Path) -> Finding {
    if root.exists() {
        ok(label, format!("{}", root.display()))
    } else {
        warn(
            label,
            format!(
                "{} does not exist (nothing stored in this scope yet)",
                root.display()
            ),
            "Nothing to do — the directory is created on first write.",
        )
    }
}

/// Counts Markdown fact documents under a root. A missing root is simply zero.
pub fn count_fact_files(root: Option<&Path>) -> usize {
    let Some(root) = root else {
        return 0;
    };
    if !root.exists() {
        return 0;
    }
    walkdir::WalkDir::new(root)
        .into_iter()
        .flatten()
        .filter(|entry| {
            entry.file_type().is_file() && entry.path().extension().is_some_and(|x| x == "md")
        })
        .count()
}

/// Counts facts that are stable-status but past their `stale_after` date.
///
/// Pure, so it is testable without a store or an index. A stale fact is not
/// deprecated — it is a claim whose validity window has closed and which now
/// needs re-verification.
pub fn count_stale_facts(facts: &[Fact], now: DateTime<Utc>) -> usize {
    facts
        .iter()
        .filter(|fact| {
            fact.status == FactStatus::Stable
                && fact
                    .validity
                    .stale_after
                    .map(|deadline| deadline <= now)
                    .unwrap_or(false)
        })
        .count()
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ZombieCandidate {
    pub id: String,
    pub title: String,
    pub effective_weight: f64,
    pub base_weight: f64,
    pub half_life_days: u32,
    pub scope: String,
}

/// Finds facts whose effective synaptic weight has decayed below threshold (default 0.25).
pub fn find_zombie_facts(
    facts: &[Fact],
    now: DateTime<Utc>,
    threshold: f64,
) -> Vec<ZombieCandidate> {
    facts
        .iter()
        .filter(|fact| fact.is_zombie(now, threshold))
        .map(|fact| ZombieCandidate {
            id: fact.id.to_string(),
            title: fact.title.clone(),
            effective_weight: fact.effective_weight(now),
            base_weight: fact.plasticity.as_ref().map(|p| p.weight).unwrap_or(1.0),
            half_life_days: fact
                .plasticity
                .as_ref()
                .map(|p| p.half_life_days)
                .unwrap_or(90),
            scope: fact.scope.to_string(),
        })
        .collect()
}

/// Reads the index read-only and appends drift findings.
pub fn inspect_index(db_path: &Path, disk_facts: usize, findings: &mut Vec<Finding>) {
    let health = match inspect(db_path) {
        Ok(health) => health,
        Err(err) => {
            findings.push(fail(
                "index database",
                format!("Could not be opened read-only: {err}"),
                "Rebuild it with `uma search \"\" --reindex`.",
            ));
            return;
        }
    };

    findings.push(schema_finding(&health));
    findings.push(coverage_finding(health.indexed_facts, disk_facts));
    findings.push(embedding_finding(&health));
    findings.push(orphan_finding(health.orphan_embeddings));
    findings.push(stale_finding(health.stale_rows));
}

fn schema_finding(health: &IndexHealth) -> Finding {
    if health.schema_is_current() {
        ok(
            "index schema",
            format!("version {} matches this build", health.schema_version),
        )
    } else {
        warn(
            "index schema",
            format!(
                "stored version {}, this build expects {}",
                health.schema_version, health.expected_schema_version
            ),
            "Rebuild the cache with `uma search \"\" --reindex`.",
        )
    }
}

fn coverage_finding(indexed: usize, disk_facts: usize) -> Finding {
    if indexed == disk_facts {
        ok(
            "index coverage",
            format!("{indexed} indexed row(s) match {disk_facts} file(s) on disk"),
        )
    } else {
        warn(
            "index coverage",
            format!("{indexed} indexed row(s) but {disk_facts} file(s) on disk"),
            "Reconcile with `uma search \"\" --reindex`.",
        )
    }
}

fn embedding_finding(health: &IndexHealth) -> Finding {
    if health.embeddings == 0 {
        warn(
            "embeddings",
            "none stored — semantic and hybrid search will fall back to keyword only",
            "Generate them with `uma search \"\" --vectorize`.",
        )
    } else if health.unvectorized() > 0 {
        warn(
            "embeddings",
            format!(
                "{} vector(s) for {} fact(s); {} not vectorized",
                health.embeddings,
                health.indexed_facts,
                health.unvectorized()
            ),
            "Fill the gaps with `uma search \"\" --vectorize`.",
        )
    } else {
        ok(
            "embeddings",
            format!("{} vector(s) cover every indexed fact", health.embeddings),
        )
    }
}

fn orphan_finding(orphans: usize) -> Finding {
    if orphans == 0 {
        ok("orphan embeddings", "none")
    } else {
        warn(
            "orphan embeddings",
            format!("{orphans} vector(s) reference facts that are no longer indexed"),
            "Pruned automatically by the next `uma search \"\" --reindex`.",
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;
    use uma_core::domain::{FactType, Scope};

    fn fact() -> Fact {
        Fact::new(
            Scope::Global,
            FactType::Note,
            "title".to_string(),
            "body".to_string(),
        )
    }

    #[test]
    fn test_count_stale_facts_only_counts_stable_facts_past_their_deadline() {
        let mut fresh = fact();
        fresh.validity.stale_after = Some(Utc::now() + Duration::days(1));

        let mut stale = fact();
        stale.validity.stale_after = Some(Utc::now() - Duration::days(1));

        let mut deprecated_and_stale = fact();
        deprecated_and_stale.status = FactStatus::Deprecated;
        deprecated_and_stale.validity.stale_after = Some(Utc::now() - Duration::days(1));

        let facts = vec![fresh, stale, deprecated_and_stale, fact()];
        assert_eq!(
            count_stale_facts(&facts, Utc::now()),
            1,
            "only the stable fact past its deadline counts"
        );
    }

    #[test]
    fn test_find_zombie_facts_detects_decayed_weights() {
        let mut healthy = fact();
        healthy.plasticity = Some(uma_core::domain::Plasticity {
            weight: 0.8,
            reinforcements: 5,
            frustrations: 0,
            last_activated: Some(Utc::now()),
            half_life_days: 90,
        });

        let mut zombie = fact();
        zombie.plasticity = Some(uma_core::domain::Plasticity {
            weight: 0.2,
            reinforcements: 0,
            frustrations: 3,
            last_activated: Some(Utc::now() - Duration::days(100)),
            half_life_days: 60,
        });

        let facts = vec![healthy, zombie];
        let zombies = find_zombie_facts(&facts, Utc::now(), 0.25);
        assert_eq!(zombies.len(), 1);
        assert_eq!(zombies[0].base_weight, 0.2);
    }
}

fn stale_finding(stale: usize) -> Finding {
    if stale == 0 {
        ok("stale index rows", "none")
    } else {
        warn(
            "stale index rows",
            format!("{stale} row(s) point at files that no longer exist"),
            "Reconcile with `uma search \"\" --reindex`.",
        )
    }
}
