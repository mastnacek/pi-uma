//! Contract operations: export rules and check code invariants with ast-grep.

use std::path::Path;
use std::process::Command;

use anyhow::{Context, Result};
use serde::Deserialize;

use crate::domain::{Contract, ContractSeverity, Fact, FactId};
use crate::store::Store;

use super::harness::{self, safe_title_of};
use super::{
    find_ast_grep, infer_language, pattern_blind_spot, CheckOptions, ContractCheckReport,
    ContractViolation, ExportReport, UnverifiableRule,
};

/// Generates the YAML representation of a single ast-grep rule.
pub fn rule_to_yaml(fact_id: &FactId, title: &str, contract: &Contract) -> String {
    let rule_id = format!("uma-{}", fact_id.to_string().to_lowercase());
    let severity = match contract.severity {
        ContractSeverity::Deny => "error",
        ContractSeverity::Warn => "warning",
    };
    let language = infer_language(contract, None).to_lowercase();

    let mut out = String::new();
    out.push_str(&format!("id: {rule_id}\n"));
    out.push_str(&format!(
        "message: \"{}\"\n",
        contract.rule.message.replace('"', "\\\"")
    ));
    out.push_str(&format!("severity: {severity}\n"));
    out.push_str(&format!("language: {language}\n"));
    out.push_str("metadata:\n");
    out.push_str(&format!("  fact_id: \"{}\"\n", fact_id));
    out.push_str(&format!("  title: \"{}\"\n", title.replace('"', "\\\"")));
    out.push_str("rule:\n");
    out.push_str(&format!(
        "  pattern: \"{}\"\n",
        contract.rule.pattern.replace('"', "\\\"")
    ));
    // `contract.rule.inside` is the FILE GLOB, not an ast-grep `inside` matcher.
    // A top-level `pattern` already matches at any AST depth, so emitting an
    // `inside` matcher here is both redundant and — with the old hardcoded
    // `pattern: "$$$"` — invalid YAML that made ast-grep reject the whole rule
    // ("Standalone multi meta variable $$$ is invalid"), silently disabling the
    // contract.
    if let Some(ref inside) = contract.rule.inside {
        out.push_str(&format!("files:\n  - \"{}\"\n", inside));
    }
    out
}

/// Compiles and exports all active contracts from `store` into `target_dir`.
pub fn export_contracts(store: &Store, target_dir: &Path) -> Result<ExportReport> {
    std::fs::create_dir_all(target_dir)
        .with_context(|| format!("Failed to create contract directory {:?}", target_dir))?;

    // Rules live in a dedicated subdirectory. With `ruleDirs: [.]` ast-grep also
    // parses `sgconfig.yml` (and any other yaml) as a rule, which aborts the
    // entire scan — the original reason every contract silently checked nothing.
    let rules_dir = target_dir.join("rules");
    std::fs::create_dir_all(&rules_dir)
        .with_context(|| format!("Failed to create rules directory {:?}", rules_dir))?;

    // Clear generated rules so a retired contract cannot leave a ghost rule.
    if let Ok(entries) = std::fs::read_dir(&rules_dir) {
        for entry in entries.flatten() {
            if entry.path().extension().is_some_and(|e| e == "yml") {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }

    let sgconfig_path = target_dir.join("sgconfig.yml");
    std::fs::write(&sgconfig_path, "ruleDirs:\n  - rules\n")
        .with_context(|| format!("Failed to write {:?}", sgconfig_path))?;

    let now = chrono::Utc::now();
    let facts = store.list_all()?;
    let mut count = 0usize;
    let mut test_cases = Vec::new();
    let mut unverifiable: Vec<UnverifiableRule> = Vec::new();
    let mut unverifiable_cases: Vec<(String, String, String, String)> = Vec::new();

    for fact in &facts {
        if !fact.is_active_at(now) {
            continue;
        }
        let Some(ref contract) = fact.contract else {
            continue;
        };

        // SPAI-055: a blind-spot pattern can never match under real ast-grep.
        // Emitting it would create a dead rule whose empty findings look like
        // a passing invariant — skip the YAML and report the rule as
        // UNVERIFIABLE instead (the harness gets a fail-closed test below).
        if let Some(reason) = pattern_blind_spot(&contract.rule.pattern) {
            unverifiable.push(UnverifiableRule {
                fact_id: fact.id.to_string(),
                reason: reason.to_string(),
            });
            unverifiable_cases.push((
                fact.id.to_string(),
                safe_title_of(&fact.title),
                fact.title.clone(),
                reason.to_string(),
            ));
            continue;
        }

        let file_name = format!("{}.yml", fact.id.to_string().to_lowercase());
        let rule_path = rules_dir.join(&file_name);
        let yaml = rule_to_yaml(&fact.id, &fact.title, contract);

        std::fs::write(&rule_path, yaml)
            .with_context(|| format!("Failed to write rule to {:?}", rule_path))?;
        count += 1;

        let safe_title = fact
            .title
            .chars()
            .map(|c| {
                if c.is_alphanumeric() {
                    c.to_ascii_lowercase()
                } else {
                    '_'
                }
            })
            .collect::<String>();
        test_cases.push((
            fact.id.to_string(),
            safe_title,
            format!("rules/{file_name}"),
            fact.title.clone(),
        ));
    }

    let test_harness = harness::write_harness(&test_cases, &unverifiable_cases);

    Ok(ExportReport {
        contracts_exported: count,
        target_dir: target_dir.to_path_buf(),
        test_harness,
        unverifiable,
    })
}

/// Runs a deterministic contract check against the codebase or a specific path.
pub fn check_contracts(store: &Store, options: &CheckOptions) -> Result<ContractCheckReport> {
    let now = chrono::Utc::now();
    let facts = store.list_all()?;
    let contract_facts: Vec<&Fact> = facts
        .iter()
        .filter(|f| f.is_active_at(now) && f.contract.is_some())
        .collect();

    if contract_facts.is_empty() {
        return Ok(ContractCheckReport {
            engine: "none".to_string(),
            rules_checked: 0,
            violations: Vec::new(),
            unverifiable: Vec::new(),
            clean: true,
            notes: Some("No active memory facts with contracts found.".to_string()),
        });
    }

    let Some(ast_grep_bin) = find_ast_grep() else {
        // Fail CLOSED: active contracts exist but cannot be verified. Reporting
        // `clean: true` here would let `uma contracts check --strict` and the
        // generated CI harness pass on a machine that never actually checked
        // anything.
        return Ok(ContractCheckReport {
            engine: "ast-grep (unavailable)".to_string(),
            rules_checked: contract_facts.len(),
            violations: Vec::new(),
            unverifiable: blind_spot_rules(&contract_facts),
            clean: false,
            notes: Some(
                "ast-grep executable not found — contracts could NOT be verified. Install via \
                 'npm install -g @ast-grep/cli' or cargo."
                    .to_string(),
            ),
        });
    };

    let git_root =
        Store::find_git_root().unwrap_or_else(|_| std::env::current_dir().unwrap_or_default());
    let contracts_dir = git_root.join(".uma").join("contracts");

    if !contracts_dir.join("sgconfig.yml").exists() {
        let _ = export_contracts(store, &contracts_dir);
    }

    let sgconfig_path = contracts_dir.join("sgconfig.yml");
    let mut cmd = Command::new(&ast_grep_bin);
    cmd.current_dir(&git_root);
    cmd.args(["scan", "--json=compact", "--config"]);
    cmd.arg(&sgconfig_path);

    if let Some(ref path) = options.path_filter {
        cmd.arg(path);
    }

    if let Some(ref filter) = options.rule_filter {
        cmd.args(["--filter", filter]);
    }

    let output = cmd.output().context("Failed to execute ast-grep scan")?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    // Fail CLOSED on an unverifiable run: a non-zero exit with no JSON output
    // means the scan itself failed (bad config, wrong binary), not that the
    // codebase is clean. An empty parse would otherwise look like "no
    // violations". Findings-only scans emit JSON and are handled below.
    if !output.status.success() && stdout.trim().is_empty() {
        return Ok(ContractCheckReport {
            engine: "ast-grep (scan failed)".to_string(),
            rules_checked: contract_facts.len(),
            violations: Vec::new(),
            unverifiable: blind_spot_rules(&contract_facts),
            clean: false,
            notes: Some(format!(
                "ast-grep exited {} with no findings output — contracts could NOT be verified: {}",
                output.status.code().unwrap_or(-1),
                String::from_utf8_lossy(&output.stderr).trim()
            )),
        });
    }

    #[derive(Deserialize)]
    struct AstGrepMatch {
        file: String,
        lines: String,
        #[serde(rename = "ruleId")]
        rule_id: String,
        severity: String,
        message: Option<String>,
        range: AstGrepRange,
    }

    #[derive(Deserialize)]
    struct AstGrepRange {
        start: AstGrepPos,
    }

    #[derive(Deserialize)]
    struct AstGrepPos {
        line: usize,
    }

    let matches: Vec<AstGrepMatch> = serde_json::from_str(stdout.trim()).unwrap_or_default();
    let mut violations = Vec::new();

    for m in matches {
        let fact_id = m
            .rule_id
            .strip_prefix("uma-")
            .unwrap_or(&m.rule_id)
            .to_uppercase();

        let matching_fact = contract_facts.iter().find(|f| {
            f.id.to_string().to_uppercase() == fact_id
                || f.id.to_string().to_lowercase() == fact_id.to_lowercase()
        });

        let severity = matching_fact
            .and_then(|f| f.contract.as_ref().map(|c| c.severity))
            .unwrap_or(if m.severity == "error" {
                ContractSeverity::Deny
            } else {
                ContractSeverity::Warn
            });

        let message = m.message.unwrap_or_else(|| {
            matching_fact
                .and_then(|f| f.contract.as_ref().map(|c| c.rule.message.clone()))
                .unwrap_or_else(|| "Architecture invariant violation".to_string())
        });

        violations.push(ContractViolation {
            fact_id,
            rule_id: m.rule_id,
            file: m.file,
            line: m.range.start.line + 1,
            message,
            severity,
            snippet: m.lines.trim().to_string(),
        });
    }

    // SPAI-055: blind-spot patterns produce no violations BY CONSTRUCTION —
    // an empty findings list says nothing about them. Surface them here so a
    // report is clean only when every rule was genuinely verified.
    let unverifiable = blind_spot_rules(&contract_facts);
    let clean = violations.is_empty() && unverifiable.is_empty();
    Ok(ContractCheckReport {
        engine: "ast-grep".to_string(),
        rules_checked: contract_facts.len(),
        violations,
        unverifiable,
        clean,
        notes: None,
    })
}

/// Collects the active contract rules whose patterns real ast-grep can never
/// match (SPAI-055).
fn blind_spot_rules(contract_facts: &[&Fact]) -> Vec<UnverifiableRule> {
    contract_facts
        .iter()
        .filter_map(|f| {
            f.contract
                .as_ref()
                .and_then(|c| pattern_blind_spot(&c.rule.pattern))
                .map(|reason| UnverifiableRule {
                    fact_id: f.id.to_string(),
                    reason: reason.to_string(),
                })
        })
        .collect()
}
