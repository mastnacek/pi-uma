use anyhow::Result;
use uma_core::{domain::Scope, store::Store};

/// Resolves a CLI scope argument into a `Scope` domain model.
/// If `Some("global")` -> `Scope::Global`.
/// If `Some("project")` | `Some("current")` | `Some("cwd")` | `None` ->
/// tries to detect git root for the project name; falls back to `Scope::Global`.
/// If `Some(name)` -> `Scope::Project(name)`.
pub fn resolve_scope(scope_arg: Option<String>) -> Result<Scope> {
    match scope_arg {
        Some(s) if s.eq_ignore_ascii_case("global") => Ok(Scope::Global),
        Some(s)
            if s.eq_ignore_ascii_case("project")
                || s.eq_ignore_ascii_case("current")
                || s.eq_ignore_ascii_case("cwd") =>
        {
            detect_project_scope()
        }
        Some(s) => Ok(Scope::Project(s)),
        None => detect_project_scope(),
    }
}

fn detect_project_scope() -> Result<Scope> {
    match Store::find_git_root() {
        Ok(git_root) => {
            let project_name = git_root
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();
            Ok(Scope::Project(project_name))
        }
        Err(_) => Ok(Scope::Global),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_explicit_global() {
        let scope = resolve_scope(Some("global".to_string())).unwrap();
        assert_eq!(scope, Scope::Global);
    }

    #[test]
    fn test_resolve_explicit_project() {
        let scope = resolve_scope(Some("custom-repo".to_string())).unwrap();
        assert_eq!(scope, Scope::Project("custom-repo".to_string()));
    }

    #[test]
    fn test_resolve_project_keyword_detects_git_root() {
        let scope = resolve_scope(Some("project".to_string())).unwrap();
        assert_ne!(scope, Scope::Project("project".to_string()));

        let scope_cur = resolve_scope(Some("current".to_string())).unwrap();
        assert_ne!(scope_cur, Scope::Project("current".to_string()));
    }
}
