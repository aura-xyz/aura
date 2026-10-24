//! Provider 注册表（v0.6.2）
//!
//! 持有当前生效的所有源，负责**按源拉取**与**跨源合并**。
//!
//! ## 合并规则只有一条
//!
//! **官方排第一，同 slug 先到先得。**
//!
//! 这条规则同时解决了两个问题：
//! - 第三方源无法顶掉官方技能（安全）
//! - 同一技能不会显示两条（界面）
//!
//! 去重键是 **slug** 而不是 id —— slug 才是安装目录名，两个不同远端 id
//! 若规范化成同一个 slug，装到同一个目录会互相覆盖。
//!
//! ## 单源失败只影响自己
//!
//! 一个源挂了就把整个市场变成空白，比部分可用更糟。所以失败原因
//! 随清单一起返回，界面如实说明「哪个源挂了」。

use super::github::{GitHubProvider, RegistrySource};
use super::skillhub::SkillHubProvider;
use super::{ListPage, ListQuery, ProviderKind, SkillProvider, UnifiedSkill};

/// 一次聚合查询的结果。
#[derive(Debug, Default)]
pub struct AggregatedList {
    /// 合并后的条目
    pub skills: Vec<UnifiedSkill>,
    /// 每个源的失败原因
    pub errors: Vec<String>,
}

/// 当前的 Provider 集合。
pub struct ProviderRegistry {
    providers: Vec<Box<dyn SkillProvider>>,
}

impl ProviderRegistry {
    /// 按顺序构造。**官方源必须排第一个**（合并规则依赖这个顺序）。
    pub fn new(github_sources: Vec<RegistrySource>, with_skillhub: bool) -> Self {
        let mut providers: Vec<Box<dyn SkillProvider>> = Vec::new();
        for src in github_sources {
            providers.push(Box::new(GitHubProvider::new(src)));
        }
        if with_skillhub {
            providers.push(Box::new(SkillHubProvider::new()));
        }
        Self { providers }
    }

    /// 全部源。
    pub fn providers(&self) -> &[Box<dyn SkillProvider>] {
        &self.providers
    }

    /// 按 id 找源。
    pub fn find(&self, id: &str) -> Option<&dyn SkillProvider> {
        self.providers.iter().find(|p| p.id() == id).map(|p| p.as_ref())
    }

    /// 聚合全部源的清单。
    ///
    /// 串行是刻意的：源通常只有 1~2 个，并发省不了多少，
    /// 但串行能让「哪个源慢」直接体现在错误信息里。
    pub async fn list_all(&self, query: &ListQuery) -> AggregatedList {
        let mut groups: Vec<Vec<UnifiedSkill>> = Vec::new();
        let mut errors: Vec<String> = Vec::new();

        for p in &self.providers {
            match p.list(query).await {
                Ok(page) => groups.push(page.skills),
                Err(e) => errors.push(format!("{}：{e}", p.label())),
            }
        }

        AggregatedList {
            skills: merge_dedupe(groups),
            errors,
        }
    }

    /// 只拉某一个源的清单。
    pub async fn list_one(
        &self,
        provider_id: &str,
        query: &ListQuery,
    ) -> Result<ListPage, String> {
        let p = self
            .find(provider_id)
            .ok_or_else(|| format!("没有这个技能源：{provider_id}"))?;
        p.list(query).await
    }

    /// 按远端 id 找条目。找不到时把各源失败原因一并带出——
    /// 「清单里没有」有两种可能：真没有，或者那个源根本没拉到。
    pub async fn resolve(&self, id: &str) -> Result<UnifiedSkill, String> {
        let mut errors: Vec<String> = Vec::new();
        for p in &self.providers {
            match p.resolve(id).await {
                Ok(s) => return Ok(s),
                Err(e) => errors.push(format!("{}：{e}", p.label())),
            }
        }
        if errors.is_empty() {
            Err(format!("市场清单里没有技能 {id}，请刷新后重试"))
        } else {
            Err(format!(
                "市场清单里没有技能 {id}（{}）",
                errors.join("；")
            ))
        }
    }

    /// 下载包字节。
    pub async fn download(&self, skill: &UnifiedSkill) -> Result<Vec<u8>, String> {
        let p = self
            .find(&skill.provider_id)
            .ok_or_else(|| format!("没有这个技能源：{}", skill.provider_id))?;
        p.download(skill).await
    }
}

/// 按组顺序合并，同 slug 先到先得。
///
/// 官方源永远传在第一个，所以这条规则等价于「第三方源不能顶掉官方技能」。
pub fn merge_dedupe(groups: Vec<Vec<UnifiedSkill>>) -> Vec<UnifiedSkill> {
    let mut out: Vec<UnifiedSkill> = Vec::new();
    for group in groups {
        for skill in group {
            if out.iter().any(|x| x.slug == skill.slug) {
                continue;
            }
            out.push(skill);
        }
    }
    out
}

/// 源的展示信息（给界面用）。
pub struct ProviderInfo {
    pub id: String,
    pub label: String,
    pub kind: ProviderKind,
    pub removable: bool,
}

/// 列出全部源的信息。
pub fn provider_infos(registry: &ProviderRegistry) -> Vec<ProviderInfo> {
    registry
        .providers()
        .iter()
        .map(|p| ProviderInfo {
            id: p.id().to_string(),
            label: p.label().to_string(),
            kind: p.kind(),
            removable: p.removable(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::Integrity;

    fn skill(slug: &str, provider: &str) -> UnifiedSkill {
        UnifiedSkill {
            id: slug.to_string(),
            slug: slug.to_string(),
            name: slug.to_string(),
            description: String::new(),
            version: String::new(),
            tags: vec![],
            author: String::new(),
            integrity: Integrity::Sha256("x".into()),
            provider_id: provider.to_string(),
            provider_label: provider.to_string(),
        }
    }

    /// 官方优先：第三方源不能顶掉官方技能。
    #[test]
    fn merge_keeps_first_and_respects_source_order() {
        let official = vec![skill("shared", "official"), skill("only-official", "official")];
        let third = vec![skill("shared", "skillhub"), skill("only-third", "skillhub")];
        let merged = merge_dedupe(vec![official, third]);
        let slugs: Vec<&str> = merged.iter().map(|s| s.slug.as_str()).collect();
        assert_eq!(slugs, vec!["shared", "only-official", "only-third"]);
        // 同 slug 时保留先到的那个（官方）
        assert_eq!(merged[0].provider_id, "official");
    }

    /// 去重键是 slug 不是 id：两个不同 id 若同 slug，只留一个。
    #[test]
    fn dedupe_is_by_slug_not_id() {
        let a = skill("same-slug", "official");
        let mut b = skill("same-slug", "skillhub");
        b.id = "different/remote/id".into();
        let merged = merge_dedupe(vec![vec![a], vec![b]]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].provider_id, "official");
    }

    /// 注册表构造：官方源排第一。
    #[test]
    fn registry_puts_official_first() {
        let reg = ProviderRegistry::new(
            vec![
                crate::providers::github::official_source(),
                RegistrySource {
                    name: "team".into(),
                    url: "https://raw.githubusercontent.com/team/skills/HEAD/".into(),
                },
            ],
            true,
        );
        let infos = provider_infos(&reg);
        assert_eq!(infos.len(), 3);
        assert_eq!(infos[0].kind, ProviderKind::Official);
        assert!(!infos[0].removable);
        assert_eq!(infos[1].kind, ProviderKind::GitHub);
        assert!(infos[1].removable);
        assert_eq!(infos[2].kind, ProviderKind::Hub);
    }
}
