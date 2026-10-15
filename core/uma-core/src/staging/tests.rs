use tempfile::tempdir;

use super::*;
use crate::domain::{Fact, FactType, Scope};
use crate::store::Store;

#[test]
fn test_staging_draft_lifecycle() {
    let dir = tempdir().unwrap();
    let store = Store::new(dir.path().join(".uma"));

    let fact = Fact::new(
        Scope::Project("test-proj".to_string()),
        FactType::Correction,
        "Direct Store integration tests".to_string(),
        "Never mock Store in tests.".to_string(),
    );

    let draft = StagedDraft::new(
        0.95,
        StagedProvenance {
            session_id: Some("session-123".to_string()),
            trigger_type: "compiler_recovery".to_string(),
            context: Some("cargo test failed then passed".to_string()),
        },
        fact.clone(),
    );

    // 1. Save draft
    let file = save_draft(&store, &draft).unwrap();
    assert!(file.exists());

    // 2. List drafts
    let drafts = list_drafts(&store).unwrap();
    assert_eq!(drafts.len(), 1);
    assert_eq!(drafts.drafts[0].confidence, 0.95);
    assert_eq!(drafts.drafts[0].fact.title, "Direct Store integration tests");
    assert!(drafts.skipped.is_empty());

    // 3. Load draft
    let loaded = load_draft(&store, &fact.id.to_string()).unwrap();
    assert_eq!(loaded.id, fact.id);

    // 4. Approve draft
    let approved = approve_draft(&store, &fact.id.to_string()).unwrap();
    assert_eq!(approved.id, fact.id);

    // After approval, draft is deleted and permanent fact is readable
    let remaining = list_drafts(&store).unwrap();
    assert_eq!(remaining.len(), 0);

    let read_back = store.read_by_id(&fact.id).unwrap();
    assert_eq!(read_back.title, "Direct Store integration tests");
}

/// SPAI provenance must survive the whole curation path: a shadow-worker draft
/// records which task produced it, and the promoted fact still points back
/// (SPAI-037 — task → knowledge, never the other way round).
#[test]
fn test_staged_draft_preserves_spai_provenance_through_approval() {
    let dir = tempdir().unwrap();
    let store = Store::new(dir.path().join(".uma"));

    let mut fact = Fact::new(
        Scope::Project("test-proj".to_string()),
        FactType::Note,
        "Completed: read-only SPAI source".to_string(),
        "Task text preserved as the draft body.".to_string(),
    );
    fact.spai = vec!["SPAI-036".to_string()];
    fact.tags = vec!["spai".to_string()];

    let draft = StagedDraft::new(
        0.7,
        StagedProvenance {
            session_id: None,
            trigger_type: "spai_done".to_string(),
            context: None,
        },
        fact.clone(),
    );
    save_draft(&store, &draft).unwrap();

    let loaded = load_draft(&store, &fact.id.to_string()).unwrap();
    assert_eq!(loaded.provenance.trigger_type, "spai_done");
    assert_eq!(loaded.fact.spai, vec!["SPAI-036"]);

    let approved = approve_draft(&store, &fact.id.to_string()).unwrap();
    assert_eq!(approved.spai, vec!["SPAI-036"]);

    let read_back = store.read_by_id(&fact.id).unwrap();
    assert_eq!(
        read_back.spai,
        vec!["SPAI-036"],
        "the promoted fact must keep its task reference"
    );
}

/// Regression (2026-10-15): a draft written before the `spai` field existed
/// failed to deserialize, and `list_drafts` swallowed the error — so 21
/// `muscle_synthesis` drafts were invisible to `uma staging list` and to the
/// review modal. A legacy draft must still load, and a genuinely broken file
/// must be reported instead of hidden. (Store separation is untouched here:
/// the draft's fact carries an empty link list; task state never enters facts.)
#[test]
fn test_list_reports_legacy_and_corrupt_drafts() {
    let dir = tempdir().unwrap();
    let store = Store::new(dir.path().join(".uma"));
    let staging = staging_dir(&store);
    std::fs::create_dir_all(&staging).unwrap();

    // A real muscle_synthesis draft shape, with the link field absent (as
    // written by every engine before it was added).
    let legacy = r#"{
      "id": "01M4RMTNN90RWZQF5XWXFDPTKB",
      "status": "draft",
      "confidence": 0.8,
      "provenance": { "session_id": null, "trigger_type": "muscle_synthesis", "context": null },
      "fact": {
        "id": "01M4RMTNN90RWZQF5XWXFDPTKB",
        "scope": { "Project": "test-proj" },
        "fact_type": "Skill",
        "title": "muscle:ls--la-cd",
        "description": null,
        "template": "[]",
        "contract": null,
        "plasticity": null,
        "saliency": null,
        "body": "steps",
        "status": "Stable",
        "supersedes": null,
        "generated": { "by": "pi-agent/1.1", "at": "2026-10-12T10:00:00+00:00" },
        "verified": [],
        "validity": { "since": "2026-10-12T10:00:00+00:00", "stale_after": null, "until": null },
        "tags": ["muscle"],
        "links": []
      }
    }"#;
    std::fs::write(staging.join("01m4rmtnn90rwzqf5xwxfdptkb.json"), legacy).unwrap();

    // A genuinely broken file: no `fact`, no `confidence`.
    std::fs::write(
        staging.join("corrupt.json"),
        r#"{"id":"01M4RMTNN90RWZQF5XWXFDPTKB","status":"draft"}"#,
    )
    .unwrap();

    let listing = list_drafts(&store).unwrap();
    assert_eq!(listing.drafts.len(), 1, "the legacy draft must still load");
    assert_eq!(listing.drafts[0].provenance.trigger_type, "muscle_synthesis");
    assert_eq!(listing.drafts[0].fact.tags, vec!["muscle"]);
    assert!(
        listing.drafts[0].fact.spai.is_empty(),
        "a missing link list defaults to empty rather than failing the read"
    );
    assert_eq!(listing.skipped.len(), 1, "the corrupt file must be reported");
    assert!(
        listing.skipped[0].error.contains("missing field"),
        "the reason must survive: {}",
        listing.skipped[0].error
    );
    let warning = listing.warning().expect("a warning is owed");
    assert!(warning.contains("could not be read"));
    assert!(warning.contains("1 staging file(s)"));
}
