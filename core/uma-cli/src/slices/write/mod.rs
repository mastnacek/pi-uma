use anyhow::Result;
use clap::Args;
use std::io::{self, Read};
use std::str::FromStr;
use uma_core::domain::{ActorEvent, Fact, FactType};
use uma_core::secrets;

use crate::shared::{parse::parse_datetime_or_date, scope::resolve_scope, store_helper::get_store};

#[derive(Args, Debug, Clone)]
pub struct WriteArgs {
    /// Fact type (decision, preference, fact, skill, correction, note, pattern, reference, task)
    #[arg(short = 't', long = "type", default_value = "note")]
    pub fact_type: String,

    /// Fact title
    #[arg(short = 'T', long = "title")]
    pub title: String,

    /// Optional one-line description (OKF format)
    #[arg(short = 'd', long = "desc")]
    pub description: Option<String>,

    /// Fact body (if not provided, reads from stdin)
    #[arg(short = 'b', long = "body")]
    pub body: Option<String>,

    /// Scope (project name or "global")
    #[arg(short = 's', long = "scope")]
    pub scope: Option<String>,

    /// Tags (comma-separated)
    #[arg(long = "tags", value_delimiter = ',')]
    pub tags: Vec<String>,

    /// SPAI backlog item IDs this fact is linked to (comma-separated, e.g. SPAI-035,SPAI-036).
    /// Cross-reference only — SPAI stays the work ledger, UMA the knowledge base.
    #[arg(long = "spai", value_delimiter = ',')]
    pub spai: Vec<String>,

    /// Domain tags restricting recall to projects that declare matching domains (comma-separated, e.g. domino,lotus).
    #[arg(long = "domains", value_delimiter = ',')]
    pub domains: Vec<String>,

    /// Invocation template for `skill` facts (placeholders like {{tag}}).
    /// Stored as data only — UMA expands it elsewhere and never executes it.
    #[arg(long = "template")]
    pub template: Option<String>,

    /// When this claim stops being trusted without re-verification.
    /// Accepts RFC 3339 (2026-12-31T23:59:59Z) or a bare date (2026-12-31).
    #[arg(long = "stale-after", value_name = "WHEN")]
    pub stale_after: Option<String>,

    /// When the claim started to hold (imports use the session's date, so an
    /// imported decision does not masquerade as being made today)
    #[arg(long = "since", value_name = "WHEN")]
    pub since: Option<String>,
}

/// Executes the Write vertical slice: creates and stores a new fact.
pub fn run(args: WriteArgs) -> Result<()> {
    let fact_type = FactType::from_str(&args.fact_type)?;
    let body = match args.body {
        Some(b) => b,
        None => {
            let mut buffer = String::new();
            io::stdin().read_to_string(&mut buffer)?;
            buffer.trim().to_string()
        }
    };

    let scope = resolve_scope(args.scope)?;
    let mut fact = Fact::new(scope, fact_type, args.title, body);
    // The CLI write path is operator-driven (the plugin's approval modal, or the
    // operator's own terminal), so record human verification honestly.
    fact.verified = vec![ActorEvent::new("human:operator")];
    fact.description = args.description;
    fact.tags = args.tags;
    fact.spai = args.spai;
    fact.domains = args.domains;
    fact.template = args.template;
    if let Some(raw) = args.stale_after.as_deref() {
        fact.validity.stale_after = Some(parse_datetime_or_date(raw)?);
    }
    if let Some(raw) = args.since.as_deref() {
        fact.validity.since = parse_datetime_or_date(raw)?;
    }

    refuse_secrets(
        &fact.title,
        &fact.body,
        fact.description.as_deref(),
        fact.template.as_deref(),
    )?;

    let store = get_store(&fact.scope)?;
    store.write(&fact)?;
    println!("Created fact: {}", fact.id);
    Ok(())
}

/// Refuses the write when any text field carries a credential. Memory files
/// are re-injected into every future session and may be committed to git — a
/// leaked key is unrecoverable, so this fails closed.
fn refuse_secrets(
    title: &str,
    body: &str,
    description: Option<&str>,
    template: Option<&str>,
) -> Result<()> {
    let text = [
        title,
        body,
        description.unwrap_or(""),
        template.unwrap_or(""),
    ]
    .join(
        "
",
    );
    let literals: Vec<String> = secrets::env_secret_literals(&std::env::vars().collect::<Vec<_>>());
    let findings = secrets::scan(&text, &literals);
    if secrets::is_blocked(&findings) {
        let list = findings
            .iter()
            .map(|f| format!("{} ({})", f.label, f.preview))
            .collect::<Vec<_>>()
            .join(", ");
        anyhow::bail!(
            "Refusing to save: the fact contains what looks like {list}. Memory is re-injected into              every session and may be committed — never store credentials. Rephrase without the              secret (name the env var that holds it instead)."
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[derive(Parser, Debug)]
    struct TestCli {
        #[command(flatten)]
        args: WriteArgs,
    }

    #[test]
    fn test_write_args_parsing() -> Result<(), clap::Error> {
        let cli = TestCli::try_parse_from([
            "test",
            "--type",
            "decision",
            "--title",
            "Use VSA Architecture",
            "--body",
            "All components follow vertical slices.",
            "--scope",
            "global",
            "--tags",
            "vsa,arch,rust",
        ])?;

        assert_eq!(cli.args.fact_type, "decision");
        assert_eq!(cli.args.title, "Use VSA Architecture");
        assert_eq!(
            cli.args.body,
            Some("All components follow vertical slices.".to_string())
        );
        assert_eq!(cli.args.scope, Some("global".to_string()));
        assert_eq!(cli.args.tags, vec!["vsa", "arch", "rust"]);
        assert!(cli.args.spai.is_empty());
        Ok(())
    }

    #[test]
    fn test_spai_args_parsing() -> Result<(), clap::Error> {
        let cli = TestCli::try_parse_from([
            "test",
            "--title",
            "Linked decision",
            "--spai",
            "SPAI-035,SPAI-036",
        ])?;
        assert_eq!(cli.args.spai, vec!["SPAI-035", "SPAI-036"]);
        Ok(())
    }

    #[test]
    fn test_since_accepts_bare_date_and_rfc3339() -> Result<(), clap::Error> {
        let cli = TestCli::try_parse_from([
            "test",
            "--type",
            "decision",
            "--title",
            "Imported decision",
            "--since",
            "2026-02-11",
        ])?;
        assert_eq!(cli.args.since.as_deref(), Some("2026-02-11"));

        let cli = TestCli::try_parse_from([
            "test",
            "--type",
            "decision",
            "--title",
            "Imported decision",
            "--since",
            "2026-02-11T09:30:00Z",
        ])?;
        assert_eq!(cli.args.since.as_deref(), Some("2026-02-11T09:30:00Z"));
        Ok(())
    }
}
