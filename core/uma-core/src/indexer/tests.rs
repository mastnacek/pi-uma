//! Indexer tests.

use super::*;
use crate::domain::{Fact, FactType, Scope};
use tempfile::tempdir;

#[test]
fn test_indexer_write_and_schema_version() -> Result<()> {
    let dir = tempdir()?;
    let db_path = dir.path().join("index.db");
    let indexer = Indexer::open(&db_path)?;

    let fact1 = Fact::new(
        Scope::Project("repo-a".to_string()),
        FactType::Decision,
        "Use PostgreSQL in Repo A".to_string(),
        "Repo A uses PostgreSQL for relational storage.".to_string(),
    );
    indexer.index_fact(&fact1, None)?;

    let count: i64 = indexer
        .connection()
        .query_row("SELECT COUNT(*) FROM facts_fts", [], |r| r.get(0))?;
    assert_eq!(count, 1);
    Ok(())
}

#[test]
fn test_reindex_preserves_foreign_roots_across_schema_drop() -> Result<()> {
    use crate::store::Store;
    let dir = tempdir()?;
    let db_path = dir.path().join("index.db");
    let indexer = Indexer::open(&db_path)?;

    // Create two separate project directories with facts
    let proj_a = dir.path().join("proj-a");
    let proj_b = dir.path().join("proj-b");
    let store_a = Store::new(proj_a.clone());
    let store_b = Store::new(proj_b.clone());

    let fact_a = Fact::new(
        Scope::Project("proj-a".to_string()),
        FactType::Decision,
        "Decision A".to_string(),
        "Body A".to_string(),
    );
    let fact_b = Fact::new(
        Scope::Project("proj-b".to_string()),
        FactType::Decision,
        "Decision B".to_string(),
        "Body B".to_string(),
    );
    store_a.write(&fact_a)?;
    store_b.write(&fact_b)?;

    // Index both files into the indexer with their file paths
    let path_a = store_a.fact_path(&fact_a.scope, &fact_a.fact_type, &fact_a.id);
    let path_b = store_b.fact_path(&fact_b.scope, &fact_b.fact_type, &fact_b.id);
    indexer.index_fact(&fact_a, Some(&path_a))?;
    indexer.index_fact(&fact_b, Some(&path_b))?;

    assert_eq!(indexer.indexed_count()?, 2);

    // Simulate schema mismatch by resetting fts_schema_version and reopening indexer
    indexer.connection().execute(
        "UPDATE uma_meta SET value = 0 WHERE key = 'fts_schema_version'",
        [],
    )?;
    let indexer = Indexer::open(&db_path)?;

    // Now reindex from dirs passing only proj_a:
    // proj_b should be remembered and restored from the persistent known_roots table!
    let count = indexer.reindex_from_dirs(&[proj_a])?;
    assert_eq!(count, 2, "Both projects should be reindexed via known_roots");
    assert_eq!(indexer.indexed_count()?, 2);

    Ok(())
}
