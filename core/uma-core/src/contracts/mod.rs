//! Executable AST Invariant Contracts (Proposal 03a).
//!
//! Important architectural decisions in UMA can carry an executable `contract:`
//! frontmatter block with an AST pattern (e.g. for `ast-grep`).
//!
//! This module provides:
//! 1. [`export_contracts`] — Compiles all active contracts into `.uma/contracts/sgconfig.yml`
//!    and individual rule YAML files, plus a `tests/architecture_invariants.rs` test harness.
//! 2. [`check_contracts`] — Discovers the `ast-grep` binary and runs deterministic
//!    contract checks against the codebase or a specific path.
//! 3. Structured violation reporting for CI, pre-commit, and the Cognitive Immune Interceptor.

use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

use crate::domain::{Contract, ContractSeverity};

mod ops;
#[cfg(test)]
mod tests;

pub use ops::{check_contracts, export_contracts, rule_to_yaml};

/// One rule violation found by `check_contracts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContractViolation {
    pub fact_id: String,
    pub rule_id: String,
    pub file: String,
    pub line: usize,
    pub message: String,
    pub severity: ContractSeverity,
    pub snippet: String,
}

/// Overall report returned by [`check_contracts`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContractCheckReport {
    pub engine: String,
    pub rules_checked: usize,
    pub violations: Vec<ContractViolation>,
    pub clean: bool,
    pub notes: Option<String>,
}

/// Report returned by [`export_contracts`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportReport {
    pub contracts_exported: usize,
    pub target_dir: PathBuf,
    pub test_harness: Option<PathBuf>,
}

/// Options for running a contract check.
#[derive(Debug, Clone, Default)]
pub struct CheckOptions {
    /// Specific path or directory to check (defaults to repository root)
    pub path_filter: Option<PathBuf>,
    /// Optional specific rule ID or fact ID to narrow check
    pub rule_filter: Option<String>,
}

fn find_in_path(binary: &str) -> Option<PathBuf> {
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let full = dir.join(binary);
            if full.is_file() {
                return Some(full);
            }
        }
    }
    None
}

/// Discovers an available `ast-grep` executable.
pub fn find_ast_grep() -> Option<PathBuf> {
    let binary_name = if cfg!(windows) { "ast-grep.exe" } else { "ast-grep" };
    let alias_name = if cfg!(windows) { "sg.exe" } else { "sg" };

    if let Some(path) = find_in_path(binary_name).or_else(|| find_in_path(alias_name)) {
        return Some(path);
    }

    if let Some(home) = directories::BaseDirs::new().map(|d| d.home_dir().to_path_buf()) {
        let pi_npm = home.join(".pi").join("agent").join("npm").join("node_modules");

        let candidates = [
            pi_npm.join("@ast-grep").join("cli-win32-x64-msvc").join("ast-grep.exe"),
            pi_npm.join("@ast-grep").join("cli-linux-x64-gnu").join("ast-grep"),
            pi_npm.join("@ast-grep").join("cli-darwin-x64").join("ast-grep"),
            pi_npm.join("@ast-grep").join("cli-darwin-arm64").join("ast-grep"),
            pi_npm.join(".bin").join(if cfg!(windows) { "ast-grep.cmd" } else { "ast-grep" }),
        ];

        for candidate in candidates {
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }

    None
}

/// Derives default language from a file's extension or rule inside/pattern.
pub fn infer_language(contract: &Contract, path_hint: Option<&Path>) -> &'static str {
    if let Some(ref lang) = contract.rule.language {
        match lang.to_lowercase().as_str() {
            "rust" | "rs" => return "Rust",
            "typescript" | "ts" => return "TypeScript",
            "javascript" | "js" => return "JavaScript",
            "python" | "py" => return "Python",
            "go" => return "Go",
            _ => {}
        }
    }

    if let Some(path) = path_hint {
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            match ext {
                "rs" => return "Rust",
                "ts" | "tsx" => return "TypeScript",
                "js" | "jsx" => return "JavaScript",
                "py" => return "Python",
                "go" => return "Go",
                _ => {}
            }
        }
    }

    if let Some(ref inside) = contract.rule.inside {
        if inside.ends_with(".rs") || inside.contains(".rs") {
            return "Rust";
        }
        if inside.ends_with(".ts") || inside.contains(".ts") {
            return "TypeScript";
        }
    }

    "Rust"
}
