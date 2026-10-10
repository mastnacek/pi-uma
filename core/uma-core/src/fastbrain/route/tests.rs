//! Offline router tests: same prompt, same verdict, on every machine.

use super::*;

fn candidates() -> Vec<Specialist> {
    vec![
        Specialist::from_scope_name("pi-uma"),
        Specialist::from_scope_name("mozek_rust"),
        Specialist::from_scope_name("gemma2"),
    ]
}

#[test]
fn prompt_naming_the_project_routes_to_it() {
    let judgment = route_task(
        "Fix the recall markers in pi-uma fastbrain",
        &candidates(),
        Judge::Offline,
    )
    .unwrap();
    assert_eq!(judgment.answer.specialist.as_deref(), Some("pi-uma"));
    assert_eq!(judgment.judged_by, Backend::Offline);
}

#[test]
fn domain_keywords_route_without_a_name_mention() {
    // 'mozek' and 'rust' are both mozek_rust keywords; pi-uma shares 'rust'
    // via nothing, so the margin must be clear.
    let judgment = route_task(
        "mozek needs its indexer rebuilt, the rust crate fails",
        &candidates(),
        Judge::Offline,
    )
    .unwrap();
    assert_eq!(judgment.answer.specialist.as_deref(), Some("mozek_rust"));
}

#[test]
fn ambiguous_prompt_escalates_instead_of_guessing() {
    let judgment = route_task("Fix the button", &candidates(), Judge::Offline).unwrap();
    assert_eq!(judgment.answer.specialist, None);
    assert!(judgment.confidence < MIN_WINNING_SCORE);
}

#[test]
fn contested_prompt_escalates_and_names_the_runner_up() {
    // Names two projects with equal evidence: no confident route, but the
    // runner-up must be visible so the escalation can offer a choice.
    let judgment = route_task(
        "Should pi-uma or mozek_rust own the new indexer?",
        &candidates(),
        Judge::Offline,
    )
    .unwrap();
    assert_eq!(judgment.answer.specialist, None);
    assert!(judgment.answer.runner_up.is_some());
}

#[test]
fn empty_candidate_list_escalates() {
    let judgment = route_task("anything", &[], Judge::Offline).unwrap();
    assert_eq!(judgment.answer.specialist, None);
    assert_eq!(judgment.answer.runner_up, None);
    assert!(judgment.answer.scores.is_empty());
}

#[test]
fn scores_are_deterministic() {
    let first = route_task("pi-uma memory store work", &candidates(), Judge::Offline).unwrap();
    let second = route_task("pi-uma memory store work", &candidates(), Judge::Offline).unwrap();
    assert_eq!(first.answer, second.answer);
    assert_eq!(first.confidence, second.confidence);
}

#[test]
fn jev_degrades_visibly_until_faze_d() {
    // The Jev branch must never hit the network yet — it degrades to the
    // offline verdict with a note and halved confidence.
    let judgment = route_task("pi-uma memory store work", &candidates(), Judge::Jev).unwrap();
    assert_eq!(judgment.judged_by, Backend::Offline);
    assert!(judgment.notes.is_some_and(|n| n.contains("Fáze D")));
}

#[test]
fn specialist_keywords_come_from_the_scope_name() {
    let specialist = Specialist::from_scope_name("mozek_rust");
    assert_eq!(specialist.keywords, vec!["mozek", "rust"]);

    // Short tokens are dropped — they match everything and decide nothing.
    let specialist = Specialist::from_scope_name("pi-uma");
    assert_eq!(specialist.keywords, vec!["uma"]);
}
