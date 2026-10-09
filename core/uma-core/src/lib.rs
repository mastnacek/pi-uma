pub mod consolidate;
pub mod contracts;
pub mod domain;
pub mod embeddings;
pub mod fastbrain;
pub mod health;
pub mod indexer;
pub mod risk;
pub mod search;
pub mod secrets;
pub mod serialization;
pub mod similarity;
pub mod skill;
pub mod sources;
pub mod staging;
pub mod store;
pub mod timeline;
pub mod vector_store;

#[cfg(test)]
mod tests {
    use crate::domain::{
        Contract, ContractRule, ContractSeverity, Fact, FactType, Plasticity, Saliency, Scope,
    };
    use crate::serialization::{fact_to_markdown, markdown_to_fact};
    use crate::store::Store;
    use tempfile::tempdir;

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
                message: "Inviolable VSA Rule: Slices must NEVER import each other directly!".to_string(),
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
        assert_eq!(parsed_contract.rule.inside.as_deref(), Some("src/slices/**"));
        assert_eq!(
            parsed_contract.rule.message,
            "Inviolable VSA Rule: Slices must NEVER import each other directly!"
        );
        assert_eq!(parsed_contract.rule.language.as_deref(), Some("rust"));
    }

    #[test]
    fn test_fact_with_plasticity_and_saliency_roundtrip() {
        let mut fact = Fact::new(
            Scope::Global,
            FactType::Pattern,
            "Always use Result for error handling".to_string(),
            "Never panic in production libraries.".to_string(),
        );
        fact.plasticity = Some(Plasticity {
            weight: 0.85,
            reinforcements: 12,
            frustrations: 1,
            last_activated: Some(chrono::Utc::now()),
            half_life_days: 60,
        });
        fact.saliency = Some(Saliency {
            shock_level: 4,
            multiplier: 2.5,
            immune_to_decay: true,
        });

        let markdown = fact_to_markdown(&fact).unwrap();
        assert!(markdown.contains("plasticity:"));
        assert!(markdown.contains("weight: 0.85"));
        assert!(markdown.contains("reinforcements: 12"));
        assert!(markdown.contains("saliency:"));
        assert!(markdown.contains("shock_level: 4"));
        assert!(markdown.contains("immune_to_decay: true"));

        let parsed = markdown_to_fact(&markdown).unwrap();
        assert_eq!(fact.id, parsed.id);
        let p = parsed.plasticity.expect("plasticity must be parsed");
        assert_eq!(p.weight, 0.85);
        assert_eq!(p.reinforcements, 12);
        assert_eq!(p.frustrations, 1);
        assert_eq!(p.half_life_days, 60);

        let s = parsed.saliency.expect("saliency must be parsed");
        assert_eq!(s.shock_level, 4);
        assert_eq!(s.multiplier, 2.5);
        assert!(s.immune_to_decay);
    }

    #[test]
    fn test_plasticity_decay_and_reinforcement() {
        use chrono::Duration;
        let now = chrono::Utc::now();
        let past = now - Duration::days(90);

        let mut p = Plasticity {
            weight: 0.8,
            reinforcements: 5,
            frustrations: 0,
            last_activated: Some(past),
            half_life_days: 90,
        };

        // After 1 half-life (90 days), weight should be halved (0.8 * 0.5 = 0.4)
        let decayed = p.effective_weight(now, false);
        assert!((decayed - 0.4).abs() < 0.01, "expected ~0.4, got {}", decayed);

        // Immune to decay stays at full weight
        let immune_weight = p.effective_weight(now, true);
        assert_eq!(immune_weight, 0.8);

        // LTP reinforcement increases weight by 0.05
        p.reinforce(now);
        assert!((p.weight - 0.85).abs() < 0.001);
        assert_eq!(p.reinforcements, 6);

        // LTD frustration decreases weight by 0.25
        p.frustrate(now);
        assert!((p.weight - 0.60).abs() < 0.001);
        assert_eq!(p.frustrations, 1);
    }

    #[test]
    fn test_fact_zombie_detection() {
        use chrono::Duration;
        let now = chrono::Utc::now();
        let old = now - Duration::days(200);

        let mut fact = Fact::new(
            Scope::Global,
            FactType::Note,
            "Old legacy pattern".to_string(),
            "Nobody uses this anymore.".to_string(),
        );
        fact.plasticity = Some(Plasticity {
            weight: 0.3,
            reinforcements: 0,
            frustrations: 2,
            last_activated: Some(old),
            half_life_days: 60,
        });

        // Threshold 0.25: decaying from 0.3 over 200 days drops below 0.25
        assert!(fact.is_zombie(now, 0.25));

        // When immune to decay, effective weight stays 0.3 (above threshold 0.25)
        fact.saliency = Some(Saliency {
            shock_level: 1,
            multiplier: 1.0,
            immune_to_decay: true,
        });
        assert!(!fact.is_zombie(now, 0.25));
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
                fact_type: None,
                include_deprecated: false,
                as_of: None,
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
}
