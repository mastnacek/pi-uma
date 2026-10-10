//! Offline-judge tests: the deterministic floor.

use super::*;
use crate::fastbrain::judge_relationship;
use crate::fastbrain::{Backend, Judge};

#[test]
fn test_negation_flip_is_a_contradiction() {
    // The review's exact scenario, which pure Jaccard merged wrongly.
    let judgment = relationship("Vždy používat pnpm", "Nikdy nepoužívat pnpm").unwrap();
    assert_eq!(judgment.answer, Relationship::Contradiction);
    assert_eq!(judgment.judged_by, Backend::Offline);
}

#[test]
fn test_near_identical_texts_are_duplicates() {
    let judgment = relationship(
        "Use pnpm for dependency installs in this repo",
        "Use pnpm for dependency installs in this repo",
    )
    .unwrap();
    assert_eq!(judgment.answer, Relationship::Duplicate);
}

#[test]
fn test_unrelated_texts_stay_unrelated() {
    let judgment = relationship(
        "Sync is git-based over the global store only",
        "Prefer dark themes in editors",
    )
    .unwrap();
    assert_eq!(judgment.answer, Relationship::Unrelated);
}

#[test]
fn test_judge_offline_is_the_default_and_degrades_visibly() {
    // Offline never fails and never reports a Jev backend.
    let judgment = judge_relationship("a", "b", Judge::Offline).unwrap();
    assert_eq!(judgment.judged_by, Backend::Offline);
}

#[test]
fn test_recall_markers_trigger_search() {
    let judgment = recall_need("Let's do it again like last time with the theme work").unwrap();
    assert!(judgment.answer.search);

    let judgment = recall_need("What is 2+2?").unwrap();
    assert!(!judgment.answer.search);
}

#[test]
fn test_recall_type_hints() {
    let judgment = recall_need("Why did we decide on the sync architecture?").unwrap();
    assert!(judgment.answer.search);
    assert!(judgment.answer.fact_types.contains(&"decision".to_string()));
}

#[test]
fn test_recall_natural_past_tense_phrasings_trigger() {
    // Regression (SPAI-014): real-world phrasings that slipped through.
    let judgment = recall_need("How did we solve the WAL locking issue last time?").unwrap();
    assert!(judgment.answer.search, "bare 'last time' must trigger recall");
    assert!(judgment.answer.fact_types.contains(&"decision".to_string()));

    let judgment = recall_need("What did we agree on for the sync transport?").unwrap();
    assert!(judgment.answer.search);

    let judgment = recall_need("Minule jsme to řešili přes OpenRouter").unwrap();
    assert!(judgment.answer.search, "Czech 'minule' must trigger recall");

    let judgment = recall_need("We fixed this before, what was the fix?").unwrap();
    assert!(judgment.answer.search);
}

#[test]
fn test_recall_plain_work_requests_stay_quiet() {
    // Guard against over-triggering after widening the markers.
    let judgment = recall_need("Fix the parser bug in store/mod.rs").unwrap();
    assert!(!judgment.answer.search);

    let judgment = recall_need("Add a new CLI flag for output format").unwrap();
    assert!(!judgment.answer.search);

    let judgment = recall_need("What is 2+2?").unwrap();
    assert!(!judgment.answer.search);
}
