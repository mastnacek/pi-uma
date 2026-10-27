use crate::domain::{Contract, ContractRule, ContractSeverity, Fact, FactType, Scope};
use crate::serialization::{fact_to_markdown, markdown_to_fact};
use crate::store::Store;
use tempfile::tempdir;

mod cognitive;

#[test]
fn test_fact_serialization_roundtrip() {
    let fact = Fact::new(
        Scope::Global,
        FactType::Decision,
        "Test Decision".to_string(),
        "This is the body of the decision.".to_string(),
    );

    let markdown = fact_to_markdown(&fact).unwrap();
    let parsed = markdown_to_fact(&markdown).unwrap();

    assert_eq!(fact.id, parsed.id);
    assert_eq!(fact.scope, parsed.scope);
    assert_eq!(fact.fact_type, parsed.fact_type);
    assert_eq!(fact.title, parsed.title);
    assert_eq!(fact.body, parsed.body);
    assert!(parsed.contract.is_none());
}

#[test]
fn test_fact_with_contract_serialization_roundtrip() {
    let mut fact = Fact::new(
        Scope::Project("pi-uma".to_string()),
        FactType::Decision,
        "Strict Vertical Slice Architecture".to_string(),
        "Feature slices must never import each other.".to_string(),
    );
    fact.contract = Some(Contract {
        engine: "ast-grep".to_string(),
        severity: ContractSeverity::Deny,
        rule: ContractRule {
            pattern: "use crate::slices::$$$REST;".to_string(),
            inside: Some("src/slices/**".to_string()),
            message: "Inviolable VSA Rule: Slices must NEVER import each other directly!"
                .to_string(),
            language: Some("rust".to_string()),
        },
    });

    let markdown = fact_to_markdown(&fact).unwrap();
    assert!(markdown.contains("contract:"));
    assert!(markdown.contains("engine: ast-grep"));
    assert!(markdown.contains("severity: deny"));
    assert!(markdown.contains("pattern: \"use crate::slices::$$$REST;\""));

    let parsed = markdown_to_fact(&markdown).unwrap();
    assert_eq!(fact.id, parsed.id);
    assert_eq!(fact.title, parsed.title);
    let parsed_contract = parsed.contract.expect("contract must be parsed");
    assert_eq!(parsed_contract.engine, "ast-grep");
    assert_eq!(parsed_contract.severity, ContractSeverity::Deny);
    assert_eq!(parsed_contract.rule.pattern, "use crate::slices::$$$REST;");
    assert_eq!(
        parsed_contract.rule.inside.as_deref(),
        Some("src/slices/**")
    );
    assert_eq!(
        parsed_contract.rule.message,
        "Inviolable VSA Rule: Slices must NEVER import each other directly!"
    );
    assert_eq!(parsed_contract.rule.language.as_deref(), Some("rust"));
}

#[test]
fn test_store_write_read() {
    let dir = tempdir().unwrap();
    let store = Store::new(dir.path().to_path_buf());

    let fact = Fact::new(
        Scope::Global,
        FactType::Note,
        "Test Note".to_string(),
        "Note body content.".to_string(),
    );

    store.write(&fact).unwrap();
    let read_fact = store
        .read(&Scope::Global, &FactType::Note, &fact.id)
        .unwrap();

    assert_eq!(fact.id, read_fact.id);
    assert_eq!(fact.title, read_fact.title);
    assert_eq!(fact.body, read_fact.body);
}

#[test]
fn test_store_read_by_id() {
    let dir = tempdir().unwrap();
    let store = Store::new(dir.path().to_path_buf());

    let fact = Fact::new(
        Scope::Project("test-project".to_string()),
        FactType::Pattern,
        "Test Pattern".to_string(),
        "Pattern description.".to_string(),
    );

    store.write(&fact).unwrap();
    let read_fact = store.read_by_id(&fact.id).unwrap();

    assert_eq!(fact.id, read_fact.id);
    assert_eq!(fact.title, read_fact.title);
}

#[test]
fn test_store_list() {
    let dir = tempdir().unwrap();
    let store = Store::new(dir.path().to_path_buf());

    let fact1 = Fact::new(
        Scope::Global,
        FactType::Note,
        "Note 1".to_string(),
        "Body 1".to_string(),
    );
    let fact2 = Fact::new(
        Scope::Global,
        FactType::Note,
        "Note 2".to_string(),
        "Body 2".to_string(),
    );

    store.write(&fact1).unwrap();
    store.write(&fact2).unwrap();

    let facts = store.list(&Scope::Global, Some(&FactType::Note)).unwrap();
    assert_eq!(facts.len(), 2);
}

#[test]
fn test_scope_display() {
    assert_eq!(Scope::Global.to_string(), "global");
    assert_eq!(
        Scope::Project("my-proj".to_string()).to_string(),
        "project:my-proj"
    );
}

#[test]
fn test_fact_type_display() {
    assert_eq!(FactType::Decision.to_string(), "decision");
    assert_eq!(
        FactType::Custom("custom-type".to_string()).to_string(),
        "custom-type"
    );
}

#[test]
fn test_store_search() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let db_path = dir.path().join("index.db");
    let indexer = crate::indexer::Indexer::open(&db_path)?;

    let fact1 = Fact::new(
        Scope::Global,
        FactType::Decision,
        "Adopt SQLite for FTS5 Indexing".to_string(),
        "We use embedded SQLite FTS5 for fast BM25 keyword search.".to_string(),
    );
    let fact2 = Fact::new(
        Scope::Global,
        FactType::Preference,
        "Rust Tooling".to_string(),
        "Prefer standard cargo tools.".to_string(),
    );

    indexer.index_fact(&fact1, None)?;
    indexer.index_fact(&fact2, None)?;

    let hits = crate::search::search_keyword(
        indexer.connection(),
        &crate::search::SearchOptions {
            query: "FTS5",
            scope: None,
            current_project: None,
            project_domains: Vec::new(),
            fact_type: None,
            include_deprecated: false,
            as_of: None,
            exclude_ids: Vec::new(),
            limit: 10,
        },
    )?;
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, fact1.id);
    assert_eq!(hits[0].title, "Adopt SQLite for FTS5 Indexing");
    Ok(())
}

#[test]
fn test_non_canonical_store_does_not_pollute_central_index() -> anyhow::Result<()> {
    // A store created from an arbitrary path (tests, temp dirs) must never
    // write into the shared central index, or it leaves orphan rows behind.
    let dir = tempdir()?;
    let store = Store::new(dir.path().to_path_buf());
    assert!(!store.is_canonical());

    let fact = Fact::new(
        Scope::Global,
        FactType::Note,
        "Temp Note".to_string(),
        "Must stay out of the central index.".to_string(),
    );
    store.write(&fact)?;

    // The markdown landed on disk...
    assert!(store.read_by_id(&fact.id).is_ok());

    // ...but no row was written to the central index.
    let indexer = Store::central_indexer()?;
    let count: i64 = indexer.connection().query_row(
        "SELECT COUNT(*) FROM facts_fts WHERE id = ?1",
        [fact.id.to_string()],
        |r| r.get(0),
    )?;
    assert_eq!(count, 0, "temp store polluted the central index");
    Ok(())
}

#[test]
fn test_fact_type_rejects_path_traversal() {
    use std::str::FromStr;
    // The review's vector: `uma write --type ../../x` must not escape.
    for bad in ["../../x", "..", ".", "a/b", "a\\b", "C:\\evil", ""] {
        assert!(
            FactType::from_str(bad).is_err(),
            "unsafe fact type '{bad}' must be rejected"
        );
    }
    assert_eq!(
        FactType::from_str("custom-type_2").unwrap(),
        FactType::Custom("custom-type_2".to_string())
    );
}

#[test]
fn test_fact_path_rejects_unsafe_type_component() {
    let dir = tempdir().unwrap();
    let store = Store::new(dir.path().to_path_buf());
    let id = crate::domain::FactId::new();
    // A hand-constructed (serde-bypassing) Custom must still fail closed.
    let evil = FactType::Custom("../../escape".to_string());
    assert!(store.fact_path(&Scope::Global, &evil, &id).is_err());
}

#[test]
fn test_store_write_refuses_a_secret() {
    let dir = tempdir().unwrap();
    let store = Store::new(dir.path().to_path_buf());
    let fact = Fact::new(
        Scope::Global,
        FactType::Note,
        "Leaked key".to_string(),
        "token: ghp_0123456789abcdefghijklmnopqrstuvwxyzAB".to_string(),
    );
    assert!(
        store.write(&fact).is_err(),
        "the central write gate must refuse a credential on every path"
    );
}

#[test]
fn test_store_write_refuses_a_secret_in_tags() {
    let dir = tempdir().unwrap();
    let store = Store::new(dir.path().to_path_buf());
    let mut fact = Fact::new(
        Scope::Global,
        FactType::Note,
        "Clean title".to_string(),
        "Clean body.".to_string(),
    );
    fact.tags = vec!["ghp_0123456789abcdefghijklmnopqrstuvwxyzAB".to_string()];
    assert!(store.write(&fact).is_err(), "tags are scanned too");
}

#[test]
fn test_search_excludes_ids_from_competition() -> anyhow::Result<()> {
    // Anti-echo (SPAI-048): excluded IDs are removed BEFORE the limit is
    // applied, so the window fills entirely with eligible facts — and the
    // survivors keep the same relative order they would have had anyway
    // (BM25 scores are per-fact independent).
    let dir = tempdir()?;
    let db_path = dir.path().join("index.db");
    let indexer = crate::indexer::Indexer::open(&db_path)?;

    let facts: Vec<crate::domain::Fact> = [
        ("Injected One", "SQLite FTS5 index adoption decision."),
        ("Injected Two", "FTS5 index tuning pattern."),
        ("Fresh One", "SQLite FTS5 index storage layout."),
        ("Fresh Two", "FTS5 index rebuild recipe."),
    ]
    .iter()
    .map(|(title, body)| {
        Fact::new(
            Scope::Global,
            FactType::Note,
            title.to_string(),
            body.to_string(),
        )
    })
    .collect();
    for fact in &facts {
        indexer.index_fact(fact, None)?;
    }

    let opts = |limit: usize| crate::search::SearchOptions {
        query: "FTS5 index",
        scope: None,
        current_project: None,
        project_domains: Vec::new(),
        fact_type: None,
        include_deprecated: false,
        as_of: None,
        exclude_ids: vec![facts[0].id.to_string(), facts[1].id.to_string()],
        limit,
    };

    // The window fills with eligible facts only — an excluded fact never
    // occupies a slot, and the survivors keep their relative rank order.
    let hits = crate::search::search_keyword(indexer.connection(), &opts(3))?;
    assert_eq!(hits.len(), 2);
    let titles: Vec<&str> = hits.iter().map(|h| h.title.as_str()).collect();
    assert!(
        titles.contains(&"Fresh One") && titles.contains(&"Fresh Two"),
        "{titles:?}"
    );
    assert!(!hits
        .iter()
        .any(|h| h.id == facts[0].id || h.id == facts[1].id));

    // The limit applies to the ELIGIBLE set: a window of 1 still returns
    // exactly one eligible fact, not an excluded one.
    let hits1 = crate::search::search_keyword(indexer.connection(), &opts(1))?;
    assert_eq!(hits1.len(), 1);
    assert!(titles.contains(&hits1[0].title.as_str()));

    // Exclusion does not shrink the result when fewer facts were excluded
    // than the window asks for.
    let none_excluded = crate::search::SearchOptions {
        exclude_ids: Vec::new(),
        ..opts(10)
    };
    let all = crate::search::search_keyword(indexer.connection(), &none_excluded)?;
    assert_eq!(all.len(), 4);
    Ok(())
}
