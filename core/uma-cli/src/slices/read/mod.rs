use anyhow::Result;
use clap::Args;
use std::str::FromStr;
use uma_core::{domain::FactId, store::Store};

use crate::shared::format::print_fact;

#[derive(Args, Debug, Clone)]
pub struct ReadArgs {
    /// Fact ID (ULID)
    pub id: String,

    /// Point-in-time check: evaluate fact validity as of this moment
    /// (RFC 3339, bare date, or relative +Nd, e.g. +30d)
    #[arg(long = "as-of")]
    pub as_of: Option<String>,

    /// Emit the fact as JSON instead of a human-readable summary
    #[arg(long = "json")]
    pub json: bool,
}

/// Executes the Read vertical slice: finds and displays a fact by its ID.
pub fn run(args: ReadArgs) -> Result<()> {
    let fact_id = FactId::from_str(&args.id)?;
    let fact = Store::find_by_id(&fact_id)?;

    let as_of = args
        .as_of
        .as_deref()
        .map(crate::shared::parse::parse_as_of)
        .transpose()?;

    if args.json {
        let mut val = serde_json::to_value(&fact)?;
        if let Some(target) = as_of {
            val["is_active_as_of"] = serde_json::json!(fact.is_active_at(target));
            val["effective_weight_as_of"] = serde_json::json!(fact.effective_weight(target));
        }
        println!("{}", serde_json::to_string(&val)?);
    } else {
        print_fact(&fact);
        if let Some(target) = as_of {
            let active = fact.is_active_at(target);
            let weight = fact.effective_weight(target);
            println!(
                "\nValidity as of {}:\n  active: {}\n  effective weight: {:.2}",
                target.to_rfc3339(),
                if active { "yes (stable)" } else { "no (inactive/rotted)" },
                weight
            );
        }
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
        args: ReadArgs,
    }

    #[test]
    fn test_read_args_parsing() -> Result<(), clap::Error> {
        let cli = TestCli::try_parse_from(["test", "01M4D6K8J6QGDFC0Y11FW45R87"])?;
        assert_eq!(cli.args.id, "01M4D6K8J6QGDFC0Y11FW45R87");
        assert!(!cli.args.json);

        let cli_json = TestCli::try_parse_from(["test", "01M4D6K8J6QGDFC0Y11FW45R87", "--json"])?;
        assert!(cli_json.args.json);
        Ok(())
    }
}
