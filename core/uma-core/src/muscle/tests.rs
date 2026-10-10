use super::*;
use tempfile::tempdir;

fn routine_template() -> &'static str {
    r#"[
      {"command": "echo", "args": ["one"], "label": "step one"},
      {"command": "echo", "args": ["two"], "label": "step two"}
    ]"#
}

#[test]
fn test_parse_routine_json() {
    let routine = parse_routine("verify", routine_template()).unwrap();
    assert_eq!(routine.name, "verify");
    assert_eq!(routine.steps.len(), 2);
    assert_eq!(routine.steps[0].command, "echo");
    assert_eq!(routine.steps[0].args, vec!["one"]);
    assert_eq!(routine.steps[0].label.as_deref(), Some("step one"));
}

#[test]
fn test_parse_routine_plain_yaml_list() {
    let template = "- echo one\n- cargo test\n";
    let routine = parse_routine("check", template).unwrap();
    assert_eq!(routine.steps.len(), 2);
    assert_eq!(routine.steps[0].command, "echo");
    assert_eq!(routine.steps[0].args, vec!["one"]);
    assert_eq!(routine.steps[1].command, "cargo");
    assert_eq!(routine.steps[1].args, vec!["test"]);
}

#[test]
fn test_parse_routine_yaml_with_labels_and_args() {
    let template = "- command: cargo\n  args: test,--release\n  label: cargo test release\n- echo done\n";
    let routine = parse_routine("full", template).unwrap();
    assert_eq!(routine.steps[0].command, "cargo");
    assert_eq!(routine.steps[0].args, vec!["test", "--release"]);
    assert_eq!(routine.steps[0].label.as_deref(), Some("cargo test release"));
}

#[test]
fn test_parse_routine_rejects_empty() {
    assert!(parse_routine("empty", "[]").is_err());
    assert!(parse_routine("empty", "- \"\"\n").is_err());
}

#[test]
fn test_run_routine_dry_run_executes_nothing() {
    let routine = parse_routine("verify", routine_template()).unwrap();
    let dir = tempdir().unwrap();
    let report = run_routine(&routine, dir.path(), false).unwrap();
    assert!(report.dry_run);
    assert_eq!(report.steps_run, 0);
    assert!(report.summary.contains("DRY-RUN"));
    assert!(report.summary.contains("echo one"));
}

#[test]
fn test_run_routine_confirm_executes_all_steps() {
    let routine = parse_routine("verify", routine_template()).unwrap();
    let dir = tempdir().unwrap();
    let report = run_routine(&routine, dir.path(), true).unwrap();
    assert!(!report.dry_run);
    assert!(report.success);
    assert_eq!(report.steps_run, 2);
    assert!(report.summary.contains("step(s) OK"));
}

#[test]
fn test_run_routine_stops_on_first_failure() {
    let template = r#"[
      {"command": "false"},
      {"command": "echo", "args": ["never"]}
    ]"#;
    let routine = parse_routine("failing", template).unwrap();
    let dir = tempdir().unwrap();
    let report = run_routine(&routine, dir.path(), true).unwrap();
    assert!(!report.success);
    assert_eq!(report.steps_run, 1, "first failure stops the pass");
    assert!(report.summary.contains("stopped at step 1/2"));
}

#[test]
fn test_curate_routine_validates_template_before_store() {
    let fact = curate_routine(
        "verify",
        routine_template(),
        Scope::Project("p".to_string()),
        Some("desc".to_string()),
    )
    .unwrap();
    assert_eq!(fact.title, "muscle:verify");
    assert_eq!(fact.fact_type, FactType::Skill);
    assert!(fact.tags.contains(&"muscle".to_string()));
    assert!(fact.template.is_some());

    assert!(curate_routine("bad", "not a template [", Scope::Global, None).is_err());
}

#[test]
fn test_find_routine_ignores_deprecated_predecessor() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let store = Store::new(dir.path().to_path_buf());

    // Write original routine with 1 step.
    let mut original = curate_routine(
        "sample",
        r#"[{"command":"echo","args":["v1"]}]"#,
        Scope::Project("p".to_string()),
        None,
    )?;
    store.write(&original)?;

    // Supersede: mark original deprecated, write revision with 2 steps.
    original.status = crate::domain::FactStatus::Deprecated;
    original.validity.until = Some(chrono::Utc::now() - chrono::Duration::seconds(10));
    store.write(&original)?;

    let revision = curate_routine(
        "sample",
        r#"[{"command":"echo","args":["v2"]},{"command":"echo","args":["v2b"]}]"#,
        Scope::Project("p".to_string()),
        None,
    )?;
    store.write(&revision)?;

    let found = find_routine(Some(&store), "sample")?;
    assert_eq!(found.steps.len(), 2, "must pick the active 2-step revision, not the deprecated 1-step predecessor");
    assert_eq!(found.steps[0].args, vec!["v2"]);

    Ok(())
}
