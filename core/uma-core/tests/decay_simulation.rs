//! L3 time-shift simulation: Ebbinghaus decay and stale-fact visibility.
//!
//! `cargo test` cannot wait 30 days, so time travel is explicit: every check
//! takes a timestamp. These tests pin the contracts `doctor` and `--as-of`
//! rely on:
//!
//! 1. synaptic weight decays with the configured half-life;
//! 2. an unused rule drops below the zombie threshold and `is_zombie` fires;
//! 3. immune rules never decay (operator-pinned memory survives neglect);
//! 4. a fact past `stale_after` is inactive at that timestamp, and search
//!    with `as_of` hides it while the present still sees it;
//! 5. a superseded fact's closed validity window holds at any later time.

use anyhow::Result;
use chrono::{Duration, Utc};
use tempfile::tempdir;
use uma_core::domain::{Fact, FactStatus, FactType, Plasticity, Scope};
use uma_core::indexer::Indexer;
use uma_core::search::{search_keyword, SearchOptions};
use uma_core::store::Store;

/// Zombie threshold from the doctor health report.
const ZOMBIE_THRESHOLD: f64 = 0.25;

fn fact(title: &str, body: &str) -> Fact {
    Fact::new(
        Scope::Global,
        FactType::Decision,
        title.to_string(),
        body.to_string(),
    )
}

fn search_options(query: &str, as_of: Option<chrono::DateTime<Utc>>) -> SearchOptions<'_> {
    SearchOptions {
        query,
        scope: None,
        current_project: None,
        fact_type: None,
        include_deprecated: false,
        as_of,
        limit: 10,
    }
}

#[test]
fn unused_rule_decays_below_the_zombie_threshold() -> Result<()> {
    let now = Utc::now();

    let mut stale_rule = fact("Always pin exact dependency versions", "Pin everything.");
    stale_rule.plasticity = Some(Plasticity {
        weight: 1.0,
        last_activated: Some(now),
        ..Default::default()
    });
    if let Some(ref mut p) = stale_rule.plasticity {
        p.half_life_days = 90;
    }

    // +30 days: one third of a half-life — faded but alive.
    let day30 = now + Duration::days(30);
    let w30 = stale_rule.effective_weight(day30);
    assert!(w30 < 1.0 && w30 > ZOMBIE_THRESHOLD, "day 30 weight {w30}");
    assert!(!stale_rule.is_zombie(day30, ZOMBIE_THRESHOLD));

    // +270 days: three half-lives — 0.125, well under the zombie line.
    let day270 = now + Duration::days(270);
    let w270 = stale_rule.effective_weight(day270);
    assert!(w270 < ZOMBIE_THRESHOLD, "day 270 weight {w270}");
    assert!(stale_rule.is_zombie(day270, ZOMBIE_THRESHOLD));

    Ok(())
}

#[test]
fn immune_rules_never_decay() -> Result<()> {
    let now = Utc::now();

    let mut pinned = fact("Never store secrets in memory", "Secrets gate runs first.");
    pinned.plasticity = Some(Plasticity {
        weight: 1.0,
        last_activated: Some(now),
        ..Default::default()
    });
    pinned
        .saliency
        .get_or_insert_with(Default::default)
        .immune_to_decay = true;

    let far_future = now + Duration::days(3650);
    assert_eq!(pinned.effective_weight(far_future), 1.0);
    assert!(!pinned.is_zombie(far_future, ZOMBIE_THRESHOLD));

    Ok(())
}

#[test]
fn stale_after_hides_the_fact_from_as_of_search() -> Result<()> {
    let dir = tempdir()?;
    let store = Store::new(dir.path().to_path_buf());
    let indexer = Indexer::open(&dir.path().join("index.db"))?;

    let mut timeboxed = fact(
        "Temporary workaround for the indexer race",
        "Valid only until the upstream fix lands.",
    );
    // Capture `now` after construction: Fact::new stamps validity.since with
    // its own clock read, and an earlier `now` would sit before the window.
    let now = Utc::now();
    timeboxed.validity.stale_after = Some(now + Duration::days(30));
    store.write(&timeboxed)?;
    indexer.index_fact(&timeboxed, None)?;

    // Now: active and searchable.
    assert!(timeboxed.is_active_at(now));
    let hits = search_keyword(indexer.connection(), &search_options("workaround", None))?;
    assert_eq!(hits.len(), 1, "fresh fact must be searchable");

    // +31 days: past stale_after — is_active_at closes the window…
    let day31 = now + Duration::days(31);
    assert!(!timeboxed.is_active_at(day31));

    // …and an as-of search at that time must not surface it.
    let hits = search_keyword(
        indexer.connection(),
        &search_options("workaround", Some(day31)),
    )?;
    assert!(hits.is_empty(), "stale fact leaked into as-of search: {hits:?}");

    Ok(())
}

#[test]
fn supersession_window_holds_at_any_future_time() -> Result<()> {
    let dir = tempdir()?;
    let store = Store::new(dir.path().to_path_buf());

    let original = fact("Use pnpm for installs", "Install with pnpm.");
    store.write(&original)?;
    let revision = fact("Use pnpm for installs (v2)", "Install with pnpm, pinned.");
    let stored = store.supersede_within(&original.id, revision)?;

    // Six months later the retired original stays retired, the revision active.
    let future = Utc::now() + Duration::days(180);
    let retired = store.read_by_id(&original.id)?;
    assert!(!retired.is_active_at(future));
    assert!(stored.is_active_at(future));
    assert_eq!(stored.supersedes, Some(original.id));

    Ok(())
}
