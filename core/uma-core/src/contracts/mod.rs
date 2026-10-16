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

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use crate::domain::{Contract, ContractSeverity};
use regex::Regex;

mod harness;
mod ops;
#[cfg(test)]
mod tests;

pub use harness::safe_title_of;
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

/// One contract rule that real ast-grep can never match (SPAI-055).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnverifiableRule {
    pub fact_id: String,
    pub reason: String,
}

/// Overall report returned by [`check_contracts`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContractCheckReport {
    pub engine: String,
    pub rules_checked: usize,
    pub violations: Vec<ContractViolation>,
    /// Rules whose pattern real ast-grep can never match (SPAI-055). They
    /// produce no violations by construction, so a report carrying them is
    /// NOT clean — the contracts were not verified.
    #[serde(default)]
    pub unverifiable: Vec<UnverifiableRule>,
    pub clean: bool,
    pub notes: Option<String>,
}

/// Report returned by [`export_contracts`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportReport {
    pub contracts_exported: usize,
    pub target_dir: PathBuf,
    pub test_harness: Option<PathBuf>,
    /// Blind-spot rules skipped at export time (SPAI-055).
    #[serde(default)]
    pub unverifiable: Vec<UnverifiableRule>,
}

/// Detects the two structural blind spots of a bare ast-grep `pattern:` rule
/// (SPAI-055) — shapes that are syntactically valid but silently match
/// NOTHING under real ast-grep:
///
/// 1. A metavariable inside a string literal: string contents are an atomic
///    token, so `from "../commands/$$$B"` never matches `"../commands/x.ts"`.
/// 2. A metavariable directly after `::`: scoped paths are RIGHT-NESTED nodes
///    (scoped_identifier(scoped_identifier, ::, id)), so the metavariable
///    binds only ONE trailing segment — `use crate::slices::$$$REST;` misses
///    `use crate::slices::doctor::checks::inspect_index;` entirely.
///
/// Both shipped VSA contract patterns hit these spots: `uma contracts check`
/// and the generated CI harness silently verified nothing for them while
/// reporting clean. Callers must surface such rules as UNVERIFIABLE instead
/// of trusting an empty findings list.
pub fn pattern_blind_spot(pattern: &str) -> Option<&'static str> {
    static RE_STRING: OnceLock<Regex> = OnceLock::new();
    static RE_PATH: OnceLock<Regex> = OnceLock::new();
    let re_string = RE_STRING
        .get_or_init(|| Regex::new(r#""[^"\n]*\$[A-Z]|'[^'\n]*\$[A-Z]"#).expect("static regex"));
    let re_path = RE_PATH.get_or_init(|| Regex::new(r#"::\s*\$+\{?[A-Z]"#).expect("static regex"));

    if re_string.is_match(pattern) {
        return Some("metavariable inside a string literal never matches (string contents are atomic tokens)");
    }
    // Path-anchored blind spot. Verified empirically (ast-grep 0.45): the
    // STATEMENT form `use crate::slices::$$$REST;` matches only shallow
    // imports, but the BARE-PATH form `crate::slices::$$$REST` matches deep
    // paths via subtree matching. Statement patterns contain whitespace;
    // bare paths do not — so only flag the former.
    if re_path.is_match(pattern) && pattern.chars().any(char::is_whitespace) {
        return Some("metavariable after '::' binds a single path segment only (scoped paths are right-nested)");
    }
    None
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
///
/// On Unix, the `sg` alias is deliberately rejected: `/usr/bin/sg` is
/// shadow-utils' "execute with different group ID" tool, not ast-grep. A
/// blind alias fallback would silently run the wrong program. ast-grep is
/// only trusted when it carries its unambiguous name, or via the known npm
/// package layout below.
pub fn find_ast_grep() -> Option<PathBuf> {
    let binary_name = if cfg!(windows) {
        "ast-grep.exe"
    } else {
        "ast-grep"
    };

    if let Some(path) = find_in_path(binary_name) {
        return Some(path);
    }

    // Windows: the npm `@ast-grep/cli` shim ships as `sg.exe`; there is no
    // shadow-utils collision there, so the alias is safe on that platform only.
    if cfg!(windows) {
        if let Some(path) = find_in_path("sg.exe") {
            return Some(path);
        }
    }

    if let Some(home) = directories::BaseDirs::new().map(|d| d.home_dir().to_path_buf()) {
        let pi_npm = home
            .join(".pi")
            .join("agent")
            .join("npm")
            .join("node_modules");

        let candidates = [
            pi_npm
                .join("@ast-grep")
                .join("cli-win32-x64-msvc")
                .join("ast-grep.exe"),
            pi_npm
                .join("@ast-grep")
                .join("cli-linux-x64-gnu")
                .join("ast-grep"),
            pi_npm
                .join("@ast-grep")
                .join("cli-darwin-x64")
                .join("ast-grep"),
            pi_npm
                .join("@ast-grep")
                .join("cli-darwin-arm64")
                .join("ast-grep"),
            pi_npm.join(".bin").join(if cfg!(windows) {
                "ast-grep.cmd"
            } else {
                "ast-grep"
            }),
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
