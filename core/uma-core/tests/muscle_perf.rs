//! L5 muscle performance: a routine's dry-run dispatch must stay under 10 ms.
//!
//! Muscle memory is procedural reflex — the operator trusts it because it is
//! instant. The SLA applies to the Rust dispatch path (parse + dry-run
//! report); actually executing steps is subprocess-bound and out of scope.
//! A dry-run must never touch the network, a shell, or the store.

use std::time::{Duration, Instant};

use anyhow::Result;
use tempfile::tempdir;
use uma_core::muscle::{parse_routine, run_routine};

/// The reflex SLA from Proposal 08: L5 muscle performance.
const SLA: Duration = Duration::from_millis(10);

const TEMPLATE: &str = r#"[
  {"command":"uma","args":["--version"],"label":"engine version"},
  {"command":"uma","args":["contracts","check"],"label":"AST contract check"},
  {"command":"uma","args":["doctor","--strict"],"label":"doctor strict"}
]"#;

#[test]
fn dry_run_dispatch_stays_under_the_reflex_sla() -> Result<()> {
    let dir = tempdir()?;
    let routine = parse_routine("verify-uma", TEMPLATE)?;

    // Warm-up: first call pays one-time costs we do not want to measure.
    let _ = run_routine(&routine, dir.path(), false)?;

    let start = Instant::now();
    const ITERATIONS: u32 = 100;
    for _ in 0..ITERATIONS {
        let report = run_routine(&routine, dir.path(), false)?;
        assert!(report.dry_run, "a dry-run must never execute steps");
        assert_eq!(report.steps_run, 0);
    }
    let per_call = start.elapsed() / ITERATIONS;

    assert!(
        per_call < SLA,
        "muscle dry-run took {per_call:?} per call, SLA is {SLA:?}"
    );
    Ok(())
}

#[test]
fn parse_then_dry_run_combined_stays_under_the_sla() -> Result<()> {
    // The full reflex path a cold invocation takes: template parse included.
    let dir = tempdir()?;

    let start = Instant::now();
    let routine = parse_routine("verify-uma", TEMPLATE)?;
    let report = run_routine(&routine, dir.path(), false)?;
    let elapsed = start.elapsed();

    assert!(elapsed < SLA, "cold parse+dry-run took {elapsed:?}, SLA is {SLA:?}");
    assert_eq!(report.steps_total, 3);
    Ok(())
}
