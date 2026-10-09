//! Staging CLI: list, inspect, approve, and discard shadow worker drafts (Proposal 02).

use anyhow::Result;
use clap::{Args, Subcommand};
use std::str::FromStr;
use uma_core::domain::{Fact, FactType, Scope};
use uma_core::staging::{approve_draft, delete_draft, list_drafts, load_draft, save_draft, StagedDraft, StagedProvenance};
use uma_core::store::Store;

#[derive(Args, Debug, Clone)]
pub struct StagingArgs {
    #[command(subcommand)]
    pub command: StagingCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub enum StagingCommand {
    /// List staged memory drafts waiting for review
    List(ListDraftsArgs),
    /// Show a specific staged draft
    Show(ShowDraftArgs),
    /// Approve a staged draft and promote it to permanent memory
    Approve(ApproveDraftArgs),
    /// Discard and delete a staged draft
    Discard(DiscardDraftArgs),
    /// Create a new staged draft (called by shadow telemetry worker)
    Create(CreateDraftArgs),
}

#[derive(Args, Debug, Clone)]
pub struct ListDraftsArgs {
    /// Emit drafts as JSON
    #[arg(long = "json")]
    pub json: bool,
}

#[derive(Args, Debug, Clone)]
pub struct ShowDraftArgs {
    /// Fact ID of the draft
    pub id: String,
    /// Emit as JSON
    #[arg(long = "json")]
    pub json: bool,
}

#[derive(Args, Debug, Clone)]
pub struct ApproveDraftArgs {
    /// Fact ID of the draft to promote
    pub id: String,
}

#[derive(Args, Debug, Clone)]
pub struct DiscardDraftArgs {
    /// Fact ID of the draft to delete
    pub id: String,
}

#[derive(Args, Debug, Clone)]
pub struct CreateDraftArgs {
    #[arg(short = 't', long = "type", default_value = "correction")]
    pub fact_type: String,

    #[arg(short = 'T', long = "title")]
    pub title: String,

    #[arg(short = 'b', long = "body")]
    pub body: String,

    #[arg(long = "trigger", default_value = "shadow_telemetry")]
    pub trigger: String,

    #[arg(long = "session")]
    pub session_id: Option<String>,

    #[arg(long = "confidence", default_value_t = 0.9)]
    pub confidence: f64,

    #[arg(long = "tags", value_delimiter = ',')]
    pub tags: Vec<String>,
}

fn resolve_store() -> Result<Store> {
    if let Some(project) = Store::current_project_name() {
        if let Ok(store) = Store::project(project) {
            return Ok(store);
        }
    }
    Store::global()
}

pub fn run(args: StagingArgs) -> Result<()> {
    let store = resolve_store()?;

    match args.command {
        StagingCommand::List(list) => {
            let drafts = list_drafts(&store)?;
            if list.json {
                println!("{}", serde_json::to_string_pretty(&drafts)?);
                return Ok(());
            }

            if drafts.is_empty() {
                println!("No staged drafts in .uma/.staging/");
                return Ok(());
            }

            println!("Staged memory drafts ({} pending review):\n", drafts.len());
            for (idx, d) in drafts.iter().enumerate() {
                println!(
                    "{}. [{}] {} (confidence: {:.0}%)",
                    idx + 1,
                    d.fact.fact_type,
                    d.fact.title,
                    d.confidence * 100.0
                );
                println!("   ID: {}", d.id);
                println!("   Trigger: {}", d.provenance.trigger_type);
                println!();
            }
            println!("Review interactively in Pi via `/uma review` or approve with `uma staging approve <ID>`.");
        }
        StagingCommand::Show(show) => {
            let draft = load_draft(&store, &show.id)?;
            if show.json {
                println!("{}", serde_json::to_string_pretty(&draft)?);
                return Ok(());
            }

            println!("Staged Draft: {}", draft.id);
            println!("Type: {}", draft.fact.fact_type);
            println!("Title: {}", draft.fact.title);
            println!("Confidence: {:.0}%", draft.confidence * 100.0);
            println!("Trigger: {}", draft.provenance.trigger_type);
            println!("\nBody:\n{}\n", draft.fact.body);
        }
        StagingCommand::Approve(app) => {
            let fact = approve_draft(&store, &app.id)?;
            println!("Approved and promoted draft {} to {}", app.id, fact.id);
        }
        StagingCommand::Discard(disc) => {
            delete_draft(&store, &disc.id)?;
            println!("Discarded draft {}", disc.id);
        }
        StagingCommand::Create(create) => {
            let fact_type = FactType::from_str(&create.fact_type)?;
            let project = Store::current_project_name().unwrap_or_else(|| "project".to_string());
            let mut fact = Fact::new(Scope::Project(project), fact_type, create.title, create.body);
            fact.tags = create.tags;

            let draft = StagedDraft::new(
                create.confidence,
                StagedProvenance {
                    session_id: create.session_id,
                    trigger_type: create.trigger,
                    context: None,
                },
                fact,
            );

            let path = save_draft(&store, &draft)?;
            println!("Created staged draft: {} at {:?}", draft.id, path);
        }
    }

    Ok(())
}
