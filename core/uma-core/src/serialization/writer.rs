use hashlink::LinkedHashMap;
use yaml_rust2::Yaml;

use crate::domain::Fact;

pub fn build_frontmatter_yaml(fact: &Fact) -> Yaml {
    let mut map = LinkedHashMap::new();

    map.insert(Yaml::String("id".to_string()), Yaml::String(fact.id.to_string()));
    map.insert(Yaml::String("scope".to_string()), Yaml::String(fact.scope.to_string()));
    map.insert(Yaml::String("type".to_string()), Yaml::String(fact.fact_type.to_string()));
    map.insert(Yaml::String("title".to_string()), Yaml::String(fact.title.clone()));

    if let Some(ref desc) = fact.description {
        map.insert(Yaml::String("description".to_string()), Yaml::String(desc.clone()));
    }
    if let Some(ref template) = fact.template {
        map.insert(Yaml::String("template".to_string()), Yaml::String(template.clone()));
    }

    if let Some(ref contract) = fact.contract {
        let mut contract_map = LinkedHashMap::new();
        contract_map.insert(Yaml::String("engine".to_string()), Yaml::String(contract.engine.clone()));
        contract_map.insert(Yaml::String("severity".to_string()), Yaml::String(contract.severity.to_string()));
        let mut rule_map = LinkedHashMap::new();
        rule_map.insert(Yaml::String("pattern".to_string()), Yaml::String(contract.rule.pattern.clone()));
        if let Some(ref inside) = contract.rule.inside {
            rule_map.insert(Yaml::String("inside".to_string()), Yaml::String(inside.clone()));
        }
        rule_map.insert(Yaml::String("message".to_string()), Yaml::String(contract.rule.message.clone()));
        if let Some(ref lang) = contract.rule.language {
            rule_map.insert(Yaml::String("language".to_string()), Yaml::String(lang.clone()));
        }
        contract_map.insert(Yaml::String("rule".to_string()), Yaml::Hash(rule_map));
        map.insert(Yaml::String("contract".to_string()), Yaml::Hash(contract_map));
    }

    if let Some(ref plasticity) = fact.plasticity {
        let mut p_map = LinkedHashMap::new();
        p_map.insert(Yaml::String("weight".to_string()), Yaml::Real(format!("{:.4}", plasticity.weight)));
        p_map.insert(Yaml::String("reinforcements".to_string()), Yaml::Integer(plasticity.reinforcements as i64));
        p_map.insert(Yaml::String("frustrations".to_string()), Yaml::Integer(plasticity.frustrations as i64));
        if let Some(ref last) = plasticity.last_activated {
            p_map.insert(Yaml::String("last_activated".to_string()), Yaml::String(last.to_rfc3339()));
        }
        p_map.insert(Yaml::String("half_life_days".to_string()), Yaml::Integer(plasticity.half_life_days as i64));
        map.insert(Yaml::String("plasticity".to_string()), Yaml::Hash(p_map));
    }

    if let Some(ref saliency) = fact.saliency {
        let mut s_map = LinkedHashMap::new();
        s_map.insert(Yaml::String("shock_level".to_string()), Yaml::Integer(saliency.shock_level as i64));
        s_map.insert(Yaml::String("multiplier".to_string()), Yaml::Real(format!("{:.2}", saliency.multiplier)));
        s_map.insert(Yaml::String("immune_to_decay".to_string()), Yaml::Boolean(saliency.immune_to_decay));
        map.insert(Yaml::String("saliency".to_string()), Yaml::Hash(s_map));
    }

    if !fact.tags.is_empty() {
        map.insert(
            Yaml::String("tags".to_string()),
            Yaml::Array(fact.tags.iter().map(|t| Yaml::String(t.clone())).collect()),
        );
    }

    map.insert(Yaml::String("status".to_string()), Yaml::String(fact.status.to_string()));

    if let Some(ref sup) = fact.supersedes {
        map.insert(Yaml::String("supersedes".to_string()), Yaml::String(sup.to_string()));
    }

    if let Some(ref gen) = fact.generated {
        let mut gen_map = LinkedHashMap::new();
        gen_map.insert(Yaml::String("by".to_string()), Yaml::String(gen.by.clone()));
        gen_map.insert(Yaml::String("at".to_string()), Yaml::String(gen.at.to_rfc3339()));
        map.insert(Yaml::String("generated".to_string()), Yaml::Hash(gen_map));
    }

    if !fact.verified.is_empty() {
        let ver_arr = fact
            .verified
            .iter()
            .map(|v| {
                let mut v_map = LinkedHashMap::new();
                v_map.insert(Yaml::String("by".to_string()), Yaml::String(v.by.clone()));
                v_map.insert(Yaml::String("at".to_string()), Yaml::String(v.at.to_rfc3339()));
                Yaml::Hash(v_map)
            })
            .collect();
        map.insert(Yaml::String("verified".to_string()), Yaml::Array(ver_arr));
    }

    map.insert(Yaml::String("since".to_string()), Yaml::String(fact.validity.since.to_rfc3339()));
    if let Some(until) = fact.validity.until {
        map.insert(Yaml::String("until".to_string()), Yaml::String(until.to_rfc3339()));
    }
    if let Some(stale) = fact.validity.stale_after {
        map.insert(Yaml::String("stale_after".to_string()), Yaml::String(stale.to_rfc3339()));
    }

    if !fact.links.is_empty() {
        map.insert(
            Yaml::String("links".to_string()),
            Yaml::Array(fact.links.iter().map(|l| Yaml::String(l.to_string())).collect()),
        );
    }

    Yaml::Hash(map)
}
