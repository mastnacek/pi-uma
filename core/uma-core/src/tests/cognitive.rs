//! Cognitive / domain tests: plasticity, saliency, decay, zombie detection.

use crate::domain::{Fact, FactType, Plasticity, Saliency, Scope};
use crate::serialization::{fact_to_markdown, markdown_to_fact};

#[test]
fn test_fact_with_plasticity_and_saliency_roundtrip() {
    let mut fact = Fact::new(
        Scope::Global,
        FactType::Pattern,
        "Always use Result for error handling".to_string(),
        "Never panic in production libraries.".to_string(),
    );
    fact.plasticity = Some(Plasticity {
        weight: 0.85,
        reinforcements: 12,
        frustrations: 1,
        last_activated: Some(chrono::Utc::now()),
        half_life_days: 60,
    });
    fact.saliency = Some(Saliency {
        shock_level: 4,
        multiplier: 2.5,
        immune_to_decay: true,
    });

    let markdown = fact_to_markdown(&fact).unwrap();
    assert!(markdown.contains("plasticity:"));
    assert!(markdown.contains("weight: 0.85"));
    assert!(markdown.contains("reinforcements: 12"));
    assert!(markdown.contains("saliency:"));
    assert!(markdown.contains("shock_level: 4"));
    assert!(markdown.contains("immune_to_decay: true"));

    let parsed = markdown_to_fact(&markdown).unwrap();
    assert_eq!(fact.id, parsed.id);
    let p = parsed.plasticity.expect("plasticity must be parsed");
    assert_eq!(p.weight, 0.85);
    assert_eq!(p.reinforcements, 12);
    assert_eq!(p.frustrations, 1);
    assert_eq!(p.half_life_days, 60);

    let s = parsed.saliency.expect("saliency must be parsed");
    assert_eq!(s.shock_level, 4);
    assert_eq!(s.multiplier, 2.5);
    assert!(s.immune_to_decay);
}

#[test]
fn test_plasticity_decay_and_reinforcement() {
    use chrono::Duration;
    let now = chrono::Utc::now();
    let past = now - Duration::days(90);

    let mut p = Plasticity {
        weight: 0.8,
        reinforcements: 5,
        frustrations: 0,
        last_activated: Some(past),
        half_life_days: 90,
    };

    // After 1 half-life (90 days), weight should be halved (0.8 * 0.5 = 0.4)
    let decayed = p.effective_weight(now, false);
    assert!(
        (decayed - 0.4).abs() < 0.01,
        "expected ~0.4, got {}",
        decayed
    );

    // Immune to decay stays at full weight
    let immune_weight = p.effective_weight(now, true);
    assert_eq!(immune_weight, 0.8);

    // LTP reinforcement applies to the DECAYED weight (0.4 + 0.05), not to the
    // pre-decay 0.8: the gain is a delta on current fitness, and restarting the
    // decay clock must not silently restore the old weight.
    p.reinforce(now);
    assert!((p.weight - 0.45).abs() < 0.001, "got {}", p.weight);
    assert_eq!(p.reinforcements, 6);

    // LTD frustration subtracts 0.25 from the now-undecayed weight (0.45).
    p.frustrate(now);
    assert!((p.weight - 0.20).abs() < 0.001, "got {}", p.weight);
    assert_eq!(p.frustrations, 1);
}

#[test]
fn test_frustration_never_raises_effective_weight() {
    use chrono::Duration;
    let now = chrono::Utc::now();
    // An idle fact deep into its decay curve. The old implementation reset
    // `last_activated`, erasing all accumulated decay and *raising* the
    // effective weight (0.125 → 0.25). Frustration must never increase fitness.
    let mut p = Plasticity {
        weight: 0.8,
        reinforcements: 0,
        frustrations: 0,
        last_activated: Some(now - Duration::days(180)),
        half_life_days: 90,
    };
    let before = p.effective_weight(now, false);
    p.frustrate(now);
    let after = p.effective_weight(now, false);
    assert!(
        after <= before + 1e-9,
        "frustrating an idle fact raised its effective weight ({before} -> {after})"
    );
}

#[test]
fn test_saliency_multiplier_boosts_retention_review_weight_only() {
    let now = chrono::Utc::now();
    let mut fact = Fact::new(
        Scope::Global,
        FactType::Note,
        "Salient rule".to_string(),
        "Body.".to_string(),
    );
    fact.plasticity = Some(Plasticity {
        weight: 0.4,
        reinforcements: 0,
        frustrations: 0,
        last_activated: Some(now),
        half_life_days: 90,
    });
    assert!((fact.decayed_weight(now) - 0.4).abs() < 1e-9);

    // shock 5 derives multiplier 1.8: retention-review weight is boosted, bounded by 1.
    fact.saliency = Some(Saliency {
        shock_level: 5,
        multiplier: 1.0,
        immune_to_decay: false,
    });
    let boosted = fact.effective_weight(now);
    assert!(
        boosted > fact.decayed_weight(now),
        "saliency must boost retention-review weight"
    );
    assert!(boosted <= 1.0);
    // Zombie detection uses the decay-only signal, so the boost cannot hide rot.
    assert!((fact.decayed_weight(now) - 0.4).abs() < 1e-9);
}

#[test]
fn test_fact_zombie_detection() {
    use chrono::Duration;
    let now = chrono::Utc::now();
    let old = now - Duration::days(200);

    let mut fact = Fact::new(
        Scope::Global,
        FactType::Note,
        "Old legacy pattern".to_string(),
        "Nobody uses this anymore.".to_string(),
    );
    fact.plasticity = Some(Plasticity {
        weight: 0.3,
        reinforcements: 0,
        frustrations: 2,
        last_activated: Some(old),
        half_life_days: 60,
    });

    // Threshold 0.25: decaying from 0.3 over 200 days drops below 0.25
    assert!(fact.is_zombie(now, 0.25));

    // When immune to decay, weight stays 0.3 (above threshold 0.25)
    fact.saliency = Some(Saliency {
        shock_level: 1,
        multiplier: 1.0,
        immune_to_decay: true,
    });
    assert!(!fact.is_zombie(now, 0.25));
}
