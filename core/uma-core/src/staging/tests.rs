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
    assert_eq!(drafts[0].confidence, 0.95);
    assert_eq!(drafts[0].fact.title, "Direct Store integration tests");

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
