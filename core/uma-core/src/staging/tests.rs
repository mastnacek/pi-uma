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
