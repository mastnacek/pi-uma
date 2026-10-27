//! Recall-slice tests: argument surface and the two transports.

use super::*;
use clap::{Parser, Subcommand};

fn parse(args: &[&str]) -> Result<RecallArgs, clap::Error> {
    #[derive(Parser)]
    struct Cli {
        #[command(subcommand)]
        command: Top,
    }

    #[derive(Subcommand)]
    enum Top {
        Recall(RecallArgs),
    }

    let all = ["uma"]
        .iter()
        .chain(args.iter())
        .copied()
        .collect::<Vec<_>>();
    let parsed = Cli::try_parse_from(all)?;
    match parsed.command {
        Top::Recall(args) => Ok(args),
    }
}

#[test]
fn test_check_parses_message_and_flags() -> Result<(), clap::Error> {
    let args = parse(&[
        "recall", "check", "why", "did", "we", "--judge", "jev", "--json",
    ])?;
    match args.command {
        RecallCommand::Check(check) => {
            assert_eq!(check.prompt, vec!["why", "did", "we"]);
            assert_eq!(check.judge, "jev");
            assert!(check.json);
        }
    }
    Ok(())
}

#[test]
fn test_check_parses_judge_always() -> Result<(), clap::Error> {
    let args = parse(&["recall", "check", "test", "prompt", "--judge", "always"])?;
    match args.command {
        RecallCommand::Check(check) => {
            assert_eq!(check.judge, "always");
        }
    }
    Ok(())
}

#[test]
fn test_check_refuses_empty_message() -> Result<(), clap::Error> {
    let args = parse(&["recall", "check"])?;
    match args.command {
        RecallCommand::Check(check) => {
            assert!(
                check_prompt(check).is_err(),
                "empty message must be refused"
            );
        }
    }
    Ok(())
}

#[test]
fn test_offline_verdict_is_deterministic() -> anyhow::Result<()> {
    let args = parse(&["recall", "check", "again like last time with pnpm"])?;
    match args.command {
        RecallCommand::Check(check) => {
            let verdict = fastbrain::judge_recall_need(&check.prompt.join(" "), Judge::Offline)
                .map_err(|f| anyhow::anyhow!("{f}"))?;
            assert!(verdict.answer.search);
            assert_eq!(verdict.judged_by, fastbrain::Backend::Offline);
        }
    }
    Ok(())
}

#[test]
fn test_check_parses_repeated_excludes() -> Result<(), clap::Error> {
    // Anti-echo (SPAI-048): the gate passes every already-injected fact id
    // as a repeated --exclude flag; the engine removes them from the
    // ranking competition before applying the limit.
    let args = parse(&[
        "recall",
        "check",
        "how",
        "--max",
        "3",
        "--exclude",
        "01AAA",
        "--exclude",
        "01BBB",
        "--json",
    ])?;
    match args.command {
        RecallCommand::Check(check) => {
            assert_eq!(check.exclude, vec!["01AAA", "01BBB"]);
            assert_eq!(check.max, 3);
            assert!(check.json);
        }
    }
    Ok(())
}

#[test]
fn test_passes_recall_threshold_discards_non_positive_and_nan() {
    assert!(!passes_recall_threshold(0.0, 20.0));
    assert!(!passes_recall_threshold(-1.0, 20.0));
    assert!(!passes_recall_threshold(f64::NAN, 20.0));
    assert!(!passes_recall_threshold(-0.001, 10.0));
}

#[test]
fn test_passes_recall_threshold_discards_below_absolute_minimum() {
    // Repro case: "plasticity half-life" returned 7.4, 6.8, 6.6 — all below absolute min (8.0).
    let best = 7.4;
    assert!(!passes_recall_threshold(7.4, best));
    assert!(!passes_recall_threshold(6.8, best));
    assert!(!passes_recall_threshold(6.6, best));

    // Repro case: "What are the principles for plugin architecture?" skill scores 1.38, 0.00.
    assert!(!passes_recall_threshold(1.38, 1.38));
    assert!(!passes_recall_threshold(0.00, 1.38));

    // Valid hits at or above 8.0 pass when they match the best score.
    assert!(passes_recall_threshold(8.0, 8.0));
    assert!(passes_recall_threshold(8.44, 8.44));
}

#[test]
fn test_passes_recall_threshold_relative_50_percent_cutoff() {
    // Repro case: "frameworks for desktop" 24.7, 4.6, 4.4 -> only 24.7 should remain.
    let best = 24.7;
    assert!(
        passes_recall_threshold(24.7, best),
        "best hit must be retained"
    );
    assert!(
        !passes_recall_threshold(4.6, best),
        "4.6 is ~18.6% of best, far below 50%"
    );
    assert!(
        !passes_recall_threshold(4.4, best),
        "4.4 is ~17.8% of best, far below 50%"
    );

    // Score above MIN_ABSOLUTE_SCORE (8.0) but below 50% of best (12.35) must be discarded.
    assert!(
        !passes_recall_threshold(10.0, best),
        "10.0 is >= 8.0 but < 12.35 (50% of 24.7), must be discarded"
    );

    // Score at or above 50% of best is retained.
    assert!(
        passes_recall_threshold(13.0, best),
        "13.0 is >= 8.0 and >= 12.35 (50% of 24.7), must be retained"
    );
}

#[test]
fn test_priming_subject_to_same_threshold() {
    // Neighbor scores are scaled: neighbor_score = hit_score * activation.
    let best = 24.7;

    // Strong hit (24.7) with 0.5 activation gives neighbor_score = 12.35.
    // 12.35 >= MIN_ABSOLUTE_SCORE (8.0) and >= 50% of 24.7 -> passes!
    let strong_neighbor = best * 0.5;
    assert!(
        passes_recall_threshold(strong_neighbor, best),
        "strong neighbor scaled score 12.35 should pass threshold"
    );

    // Hit with lower score (12.0) with 0.5 activation gives neighbor_score = 6.0.
    // 6.0 < MIN_ABSOLUTE_SCORE (8.0) -> fails!
    let weak_neighbor = 12.0 * 0.5;
    assert!(
        !passes_recall_threshold(weak_neighbor, best),
        "weak neighbor score 6.0 is below MIN_ABSOLUTE_SCORE"
    );

    // Raw activation alone (0.5) without scaling fails absolute minimum.
    assert!(
        !passes_recall_threshold(0.5, best),
        "raw unscaled activation 0.5 is below MIN_ABSOLUTE_SCORE"
    );
}
