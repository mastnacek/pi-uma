//! L0 concurrency stress: the index is shared by several clients at once.
//!
//! The production topology is one `index.db` opened simultaneously by the CLI,
//! the Pi plugin, and the MCP server — separate processes, separate SQLite
//! connections. WAL plus `busy_timeout` (see `Indexer::open`) is what keeps
//! that from collapsing into "database is locked". These tests hammer exactly
//! that configuration:
//!
//! 1. many writer threads, each with its own connection, on one db file;
//! 2. readers searching while a writer is mid-flight;
//! 3. write → immediate read visibility across connections;
//! 4. true cross-process writers (the test binary re-spawns itself).
//!
//! Everything runs against temp-directory databases, never the real index.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;

use anyhow::Result;
use tempfile::tempdir;
use uma_core::domain::{Fact, FactType, Scope};
use uma_core::indexer::Indexer;
use uma_core::search::{search_keyword, SearchOptions};

fn fact(title: &str, body: &str) -> Fact {
    Fact::new(
        Scope::Global,
        FactType::Decision,
        title.to_string(),
        body.to_string(),
    )
}

fn search_options(query: &str) -> SearchOptions<'_> {
    SearchOptions {
        query,
        scope: None,
        current_project: None,
        fact_type: None,
        include_deprecated: false,
        as_of: None,
        limit: 10,
    }
}

fn writer_batch(db_path: &Path, label: &str, count: usize) -> Result<()> {
    let indexer = Indexer::open(db_path)?;
    for i in 0..count {
        let f = fact(
            &format!("{label} rule {i}"),
            &format!("Body for {label} rule {i}: concurrency stress payload."),
        );
        indexer.index_fact(&f, None)?;
    }
    Ok(())
}

#[test]
fn concurrent_writers_never_see_database_locked() -> Result<()> {
    let dir = tempdir()?;
    let db_path = Arc::new(dir.path().join("index.db"));

    // Create the schema up front so the threads contend on writes, not on
    // initialization.
    Indexer::open(db_path.as_ref())?;

    const THREADS: usize = 8;
    const PER_THREAD: usize = 25;

    let failures = Arc::new(AtomicUsize::new(0));
    let mut handles = Vec::new();
    for t in 0..THREADS {
        let db_path = Arc::clone(&db_path);
        let failures = Arc::clone(&failures);
        handles.push(thread::spawn(move || {
            let label = format!("thread{t}");
            if let Err(err) = writer_batch(&db_path, &label, PER_THREAD) {
                let msg = err.to_string();
                assert!(
                    !msg.contains("locked"),
                    "WAL + busy_timeout must absorb contention, got: {msg}"
                );
                failures.fetch_add(1, Ordering::SeqCst);
            }
        }));
    }
    for handle in handles {
        handle.join().expect("writer thread panicked");
    }
    assert_eq!(failures.load(Ordering::SeqCst), 0, "writer errors");

    let indexer = Indexer::open(db_path.as_ref())?;
    assert_eq!(indexer.indexed_count()?, (THREADS * PER_THREAD) as i64);

    Ok(())
}

#[test]
fn readers_proceed_while_a_writer_is_mid_flight() -> Result<()> {
    let dir = tempdir()?;
    let db_path = Arc::new(dir.path().join("index.db"));
    Indexer::open(db_path.as_ref())?;

    // Seed something to read.
    writer_batch(&db_path, "seed", 10)?;

    let stop = Arc::new(AtomicUsize::new(0));
    let read_errors = Arc::new(AtomicUsize::new(0));

    let writer = {
        let db_path = Arc::clone(&db_path);
        let stop = Arc::clone(&stop);
        thread::spawn(move || {
            let result = writer_batch(&db_path, "writer", 200);
            stop.store(1, Ordering::SeqCst);
            result
        })
    };

    let mut readers = Vec::new();
    for _ in 0..3 {
        let db_path = Arc::clone(&db_path);
        let stop = Arc::clone(&stop);
        let read_errors = Arc::clone(&read_errors);
        readers.push(thread::spawn(move || {
            let indexer = Indexer::open(db_path.as_ref()).expect("reader opens index");
            while stop.load(Ordering::SeqCst) == 0 {
                if search_keyword(indexer.connection(), &search_options("concurrency")).is_err() {
                    read_errors.fetch_add(1, Ordering::SeqCst);
                }
            }
        }));
    }

    writer.join().expect("writer panicked")?;
    for reader in readers {
        reader.join().expect("reader panicked");
    }
    assert_eq!(read_errors.load(Ordering::SeqCst), 0, "reader errors during writes");

    Ok(())
}

#[test]
fn write_is_immediately_visible_to_another_connection() -> Result<()> {
    // WAL contract: a committed write on connection A is readable on
    // connection B without reopening the database. The Pi plugin and the CLI
    // rely on this for write-then-recall in the same turn.
    let dir = tempdir()?;
    let db_path = dir.path().join("index.db");

    let writer = Indexer::open(&db_path)?;
    let reader = Indexer::open(&db_path)?;

    let f = fact(
        "Cross-connection visibility rule",
        "A write must be searchable from a second connection at once.",
    );
    writer.index_fact(&f, None)?;

    let hits = search_keyword(reader.connection(), &search_options("visibility"))?;
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, f.id);

    Ok(())
}

/// Entry point the parent test re-spawns as a separate process. Marked
/// `#[ignore]` so a plain `cargo test` never runs it directly; the parent
/// invokes it with `--ignored --exact`.
#[test]
#[ignore]
fn cross_process_child_entry() {
    let db_path = PathBuf::from(
        std::env::var("UMA_STRESS_DB").expect("UMA_STRESS_DB must point at the shared db"),
    );
    let label = std::env::var("UMA_STRESS_LABEL").unwrap_or_else(|_| "child".to_string());
    writer_batch(&db_path, &label, 15).expect("child writer must finish without lock errors");
}

#[test]
fn cross_process_writers_share_one_index() -> Result<()> {
    let dir = tempdir()?;
    let db_path = dir.path().join("index.db");
    Indexer::open(&db_path)?;

    const CHILDREN: usize = 4;
    let exe = std::env::current_exe()?;
    let mut children = Vec::new();
    for n in 0..CHILDREN {
        let child = Command::new(&exe)
            .args([
                "--ignored",
                "--exact",
                "cross_process_child_entry",
                "--nocapture",
            ])
            .env("UMA_STRESS_DB", &db_path)
            .env("UMA_STRESS_LABEL", format!("proc{n}"))
            .spawn()?;
        children.push(child);
    }
    for (n, mut child) in children.into_iter().enumerate() {
        let status = child.wait()?;
        assert!(status.success(), "child process {n} failed: {status}");
    }

    let indexer = Indexer::open(&db_path)?;
    assert_eq!(indexer.indexed_count()?, (CHILDREN * 15) as i64);

    // And the parent's search sees every child's rows.
    let hits = search_keyword(indexer.connection(), &search_options("proc2"))?;
    assert!(!hits.is_empty());

    Ok(())
}
