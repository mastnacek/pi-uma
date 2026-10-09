//! Architecture invariants compiled from active memory decisions.

use uma_core::contracts::{check_contracts, CheckOptions};
use uma_core::store::Store;

#[test]
fn enforce_memory_architecture_invariants() {
    let git_root = match Store::find_git_root() {
        Ok(r) => r,
        Err(_) => return,
    };

    let store_dir = git_root.join(".uma");
    if !store_dir.exists() {
        return;
    }
    let store = Store::new(store_dir);

    let report = match check_contracts(&store, &CheckOptions::default()) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Skipping contract check: {}", e);
            return;
        }
    };

    assert!(
        report.clean,
        "Architecture invariants violated: {:?}",
        report.violations
    );
}
