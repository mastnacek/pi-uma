use super::*;

fn input(intent: &str, files: &[&str], coverage: usize) -> HumilityInput {
    HumilityInput {
        intent: intent.to_string(),
        files: files.iter().map(|f| (*f).to_string()).collect(),
        fact_coverage: coverage,
    }
}

fn strvec(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| (*s).to_string()).collect()
}

#[test]
fn test_offline_familiarity_bands_over_coverage() {
    let low = offline_familiarity(&input("rewrite the parser", &["src/new_sub/parser.rs"], 0));
    assert_eq!(low.familiarity, Familiarity::Low);
    assert!(low.exploration_required);
    assert!(low.hypothesis_required);

    let medium = offline_familiarity(&input("tweak the parser", &["src/x.rs"], 2));
    assert_eq!(medium.familiarity, Familiarity::Medium);
    assert!(medium.exploration_required);

    let high = offline_familiarity(&input("tweak the parser", &["src/x.rs"], 5));
    assert_eq!(high.familiarity, Familiarity::High);
    assert!(!high.exploration_required);
}

#[test]
fn test_complexity_signals_detected() {
    let signals = complexity_signals(
        "add extern FFI binding for the wasm runtime",
        &strvec(&["src/bindings.rs"]),
    );
    assert!(signals.contains(&"ffi".to_string()));
    assert!(signals.contains(&"extern".to_string()));
    assert!(signals.contains(&"wasm".to_string()));
    assert!(signals.contains(&"binding".to_string()));

    assert!(complexity_signals("add a doc comment", &strvec(&["src/plain.rs"])).is_empty());
}

#[test]
fn test_low_familiarity_advice_names_explorative_mode() {
    let verdict = offline_familiarity(&input("touch the unsafe FFI layer", &["src/ffi.rs"], 0));
    assert!(
        verdict.advice.contains("Read-Only Explorative Mode"),
        "advice: {}",
        verdict.advice
    );
    assert!(verdict.advice.contains("3"));
}

#[test]
fn test_judge_offline_matches_direct_call() {
    let input = input("work", &["a.rs"], 0);
    let via_judge = assess_familiarity(&input, crate::fastbrain::Judge::Offline).unwrap();
    assert_eq!(via_judge, offline_familiarity(&input));
}

/// Live Familiarity Index verification against the real OpenRouter
/// `typesafe/jev-router` endpoint. Skips loudly without credentials.
#[test]
fn test_live_jev_familiarity() {
    if crate::embeddings::resolve_api_key().is_none() {
        eprintln!("skipping live humility check: no OpenRouter credentials");
        return;
    }

    let verdict = assess_familiarity(
        &input(
            "Rewrite the proc-macro expansion inside the unsafe FFI binding layer",
            &["src/macros/expand.rs", "src/ffi/napi.rs"],
            0,
        ),
        crate::fastbrain::Judge::Jev,
    )
    .expect("live humility call");

    assert_eq!(verdict.judged_by, crate::fastbrain::Backend::Jev);
    assert_eq!(verdict.familiarity, Familiarity::Low, "{verdict:?}");
    assert!(verdict.exploration_required);
    assert!(!verdict.advice.is_empty());
}