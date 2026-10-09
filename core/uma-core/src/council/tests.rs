use super::*;

fn input(intent: &str, mentions: usize, reverts: usize) -> SkepticInput {
    SkepticInput {
        intent: intent.to_string(),
        files: vec!["src/indexer/mod.rs".to_string()],
        correction_mentions: mentions,
        reverts,
    }
}

#[test]
fn test_offline_skeptic_clean_files_are_benign() {
    let critique = offline_skeptic(&input("add a helper function", 0, 0)).unwrap();
    assert_eq!(critique.risk_level, RiskLevel::Benign);
    assert!(!critique.warrants_warning());
    assert_eq!(critique.failure_mode, FailureMode::NoneAcceptableRisk);
}

#[test]
fn test_offline_skeptic_pain_history_is_dangerous() {
    // 3 corrections (45) + 2 reverts (40) = 85 → dangerous, objection 0.85
    let critique = offline_skeptic(&input("rewrite the sqlite locking", 3, 2)).unwrap();
    assert_eq!(critique.risk_level, RiskLevel::Dangerous);
    assert!(critique.warrants_warning());
    assert!((critique.devil_objection - 0.85).abs() < 0.001);
    assert_eq!(critique.failure_mode, FailureMode::ConcurrencyDeadlock);
}

#[test]
fn test_offline_skeptic_medium_band_is_questionable() {
    // 1 correction (15) + 1 revert (20) = 35 → questionable
    let critique = offline_skeptic(&input("adjust serialization", 1, 1)).unwrap();
    assert_eq!(critique.risk_level, RiskLevel::Questionable);
    assert!(!critique.warrants_warning());
}

#[test]
fn test_offline_skeptic_failure_mode_keywords() {
    let unwrap_intent = offline_skeptic(&input("unwrap the option value directly", 0, 0)).unwrap();
    assert_eq!(unwrap_intent.failure_mode, FailureMode::UnhandledNullEdgeCase);

    let api_intent = offline_skeptic(&input("change the public api schema", 0, 0)).unwrap();
    assert_eq!(api_intent.failure_mode, FailureMode::BreakingPublicContract);
}

#[test]
fn test_judge_offline_matches_direct_call() {
    let via_judge = consult_skeptic(&input("locking work", 3, 2), Judge::Offline).unwrap();
    let direct = offline_skeptic(&input("locking work", 3, 2)).unwrap();
    assert_eq!(via_judge, direct);
}

/// Live Skeptic verification against the real OpenRouter `typesafe/jev-router`
/// endpoint (the canonical System-1 transport). Skips loudly without credentials.
#[test]
fn test_live_jev_skeptic_critique() {
    if crate::embeddings::resolve_api_key().is_none() {
        eprintln!("skipping live Skeptic check: no OpenRouter credentials");
        return;
    }

    let critique = consult_skeptic(
        &SkepticInput {
            intent: "Rewrite the shared SQLite indexer to allow concurrent writes without WAL mode"
                .to_string(),
            files: vec!["src/indexer/mod.rs".to_string(), "src/store/ops.rs".to_string()],
            correction_mentions: 3,
            reverts: 2,
        },
        Judge::Jev,
    )
    .expect("live skeptic call");

    assert_eq!(critique.judged_by, crate::fastbrain::Backend::Jev);
    assert!((0.0..=1.0).contains(&critique.devil_objection));
    // A no-WAL concurrent-write rewrite on a painful file must raise a flag.
    assert!(critique.warrants_warning(), "expected the devil to object: {critique:?}");
    assert!(!critique.advice.is_empty());
}
