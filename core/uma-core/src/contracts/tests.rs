use tempfile::tempdir;

use super::*;
use crate::domain::{Contract, ContractRule, ContractSeverity, Fact, FactType, Scope};
use crate::store::Store;

fn make_contract_fact() -> Fact {
    let mut fact = Fact::new(
        Scope::Project("test-proj".to_string()),
        FactType::Decision,
        "No raw unwraps in core".to_string(),
        "Use anyhow or thiserror instead of .unwrap().".to_string(),
    );
    fact.contract = Some(Contract {
        engine: "ast-grep".to_string(),
        severity: ContractSeverity::Deny,
        rule: ContractRule {
            pattern: "$EXPR.unwrap()".to_string(),
            inside: Some("src/**/*.rs".to_string()),
            message: "Raw .unwrap() is forbidden; use anyhow or thiserror.".to_string(),
            language: Some("rust".to_string()),
        },
    });
    fact
}

#[test]
fn test_rule_to_yaml_generation() {
    let fact = make_contract_fact();
    let contract = fact.contract.as_ref().unwrap();
    let yaml = rule_to_yaml(&fact.id, &fact.title, contract);

    assert!(yaml.contains(&format!("id: uma-{}", fact.id.to_string().to_lowercase())));
    assert!(yaml.contains("pattern: \"$EXPR.unwrap()\""));
    assert!(yaml.contains("severity: error"));
    assert!(yaml.contains("language: Rust"));
    assert!(yaml.contains("files:\n  - \"src/**/*.rs\""));
    assert!(yaml.contains("Raw .unwrap() is forbidden"));
}

#[test]
fn test_export_contracts_writes_sgconfig_and_rules() {
    let dir = tempdir().unwrap();
    let store_dir = dir.path().join(".uma");
    let store = Store::new(store_dir);

    let fact = make_contract_fact();
    store.write(&fact).unwrap();

    let export_dir = dir.path().join(".uma").join("contracts");
    let report = export_contracts(&store, &export_dir).unwrap();

    assert_eq!(report.contracts_exported, 1);
    assert!(export_dir.join("sgconfig.yml").exists());

    let rule_file = export_dir.join(format!("{}.yml", fact.id.to_string().to_lowercase()));
    assert!(rule_file.exists());

    let content = std::fs::read_to_string(rule_file).unwrap();
    assert!(content.contains("$EXPR.unwrap()"));
}

#[test]
fn test_infer_language() {
    let mut contract = Contract {
        engine: "ast-grep".to_string(),
        severity: ContractSeverity::Warn,
        rule: ContractRule {
            pattern: "import ...".to_string(),
            inside: None,
            message: "msg".to_string(),
            language: None,
        },
    };

    assert_eq!(infer_language(&contract, Some(Path::new("file.ts"))), "TypeScript");
    assert_eq!(infer_language(&contract, Some(Path::new("file.rs"))), "Rust");
    assert_eq!(infer_language(&contract, Some(Path::new("file.py"))), "Python");

    contract.rule.language = Some("go".to_string());
    assert_eq!(infer_language(&contract, None), "Go");
}
