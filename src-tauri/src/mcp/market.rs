//! MCP 服务器市场与一键安装（v0.8.2 · M3-07）。
//!
//! 复用技能市场的镜像与来源体系：`mirrors::official_candidates` 生成
//! 同一批 GitHub 加速候选，不新造镜像表。安装前跑一期 M-06 的
//! `audit_server` / M3-02 的 `audit_url` 静态审查；**一键安装的语义固定为
//! 「写入 `mcp_servers` + 默认禁用 + 默认 strict」**，绝不自动连接、
//! 绝不自动放宽信任等级，启用必须由用户在卡片上显式操作。

use serde::{Deserialize, Serialize};

use super::config::{self, McpServerConfig, RemoteConfig, ServerPolicy};

/// 官方远端清单；拉不到就只用内置清单，失败静默不弹错。
const CATALOG_URL: &str =
    "https://raw.githubusercontent.com/aura-xyz/aura-registry/main/mcp-servers.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MarketEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    /// stdio 启动命令；远程条目为空
    pub command: String,
    pub args: Vec<String>,
    /// 非空表示远程服务器
    pub server_url: String,
    /// `builtin` | `remote`
    pub source: String,
}

fn entry(
    id: &str,
    name: &str,
    desc: &str,
    command: &str,
    args: &[&str],
) -> MarketEntry {
    MarketEntry {
        id: id.to_string(),
        name: name.to_string(),
        description: desc.to_string(),
        command: command.to_string(),
        args: args.iter().map(|s| s.to_string()).collect(),
        server_url: String::new(),
        source: "builtin".to_string(),
    }
}

/// 内置清单：只放社区通用、无需凭据即可启动的 stdio 服务器。
pub fn builtin() -> Vec<MarketEntry> {
    vec![
        entry(
            "filesystem",
            "Filesystem",
            "按工作区限定读写本地文件；安装后请在编辑表单里补上允许的路径",
            "npx",
            &["-y", "@modelcontextprotocol/server-filesystem", "."],
        ),
        entry(
            "git",
            "Git",
            "读取与查询 Git 仓库历史",
            "uvx",
            &["mcp-server-git"],
        ),
        entry(
            "fetch",
            "Fetch",
            "抓取网页并转成模型可读文本",
            "uvx",
            &["mcp-server-fetch"],
        ),
        entry(
            "memory",
            "Memory",
            "跨轮次的本地知识图谱记忆",
            "npx",
            &["-y", "@modelcontextprotocol/server-memory"],
        ),
    ]
}

/// 解析远端清单。缺字段、类型不对的条目一律跳过，不因一条坏数据整表失败。
pub fn parse_catalog(body: &str) -> Vec<MarketEntry> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(body) else {
        return Vec::new();
    };
    let Some(arr) = v.as_array() else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|item| {
            let id = item.get("id")?.as_str()?.trim();
            let name = item.get("name")?.as_str()?.trim();
            if id.is_empty() || name.is_empty() {
                return None;
            }
            let command = item
                .get("command")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            let server_url = item
                .get("server_url")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            if command.trim().is_empty() && server_url.trim().is_empty() {
                return None;
            }
            let args = item
                .get("args")
                .and_then(|x| x.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            Some(MarketEntry {
                id: id.to_string(),
                name: name.to_string(),
                description: item
                    .get("description")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string(),
                command,
                args,
                server_url,
                source: "remote".to_string(),
            })
        })
        .collect()
}

/// 内置清单 + 官方直连/镜像候选；任一成功即停，全失败只回内置。
pub async fn load_catalog() -> Vec<MarketEntry> {
    let mut out = builtin();
    let mut urls = vec![CATALOG_URL.to_string()];
    urls.extend(
        crate::mirrors::official_candidates(CATALOG_URL, &[])
            .into_iter()
            .take(3),
    );
    for u in urls {
        let Ok(resp) = reqwest::Client::new()
            .get(&u)
            .timeout(std::time::Duration::from_secs(4))
            .send()
            .await
        else {
            continue;
        };
        if !resp.status().is_success() {
            continue;
        }
        if let Ok(body) = resp.text().await {
            let extra = parse_catalog(&body);
            if !extra.is_empty() {
                out.extend(extra);
                break;
            }
        }
    }
    out
}

/// 生成不冲突的服务器名：同名时追加 `-2` / `-3`，不覆盖既有配置。
pub fn unique_name(existing: &[McpServerConfig], base: &str) -> String {
    if !existing.iter().any(|c| c.name == base) {
        return base.to_string();
    }
    (2..100)
        .map(|i| format!("{base}-{i}"))
        .find(|n| !existing.iter().any(|c| &c.name == n))
        .unwrap_or_else(|| format!("{base}-{}", std::process::id()))
}

/// 写入配置。默认 `enabled=false` + `strict`，调用方负责让用户显式启用。
pub fn install(
    conn: &rusqlite::Connection,
    e: &MarketEntry,
) -> Result<McpServerConfig, String> {
    if e.command.trim().is_empty() && e.server_url.trim().is_empty() {
        return Err("该条目既没有启动命令也没有远程地址".to_string());
    }
    let warning = if e.server_url.is_empty() {
        config::audit_server(&e.command, &e.args)?
    } else {
        config::audit_url(&e.server_url)?
    };
    if let Some(w) = warning {
        crate::mcp::diag(&format!("市场安装提示 {}: {w}", e.id));
    }
    let name = unique_name(&config::list(conn)?, &e.name);
    let remote = RemoteConfig {
        server_url: e.server_url.clone(),
        auth_mode: "none".to_string(),
        oauth_client_id: String::new(),
    };
    config::insert(
        conn,
        &name,
        &e.command,
        e.args.clone(),
        std::collections::BTreeMap::new(),
        Vec::new(),
        false,
        ServerPolicy::default(),
        remote,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> rusqlite::Connection {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE mcp_servers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                command TEXT NOT NULL,
                args_json TEXT NOT NULL DEFAULT '[]',
                env_encrypted TEXT NOT NULL DEFAULT '',
                enabled INTEGER NOT NULL DEFAULT 1,
                workspaces_json TEXT,
                trust_level TEXT NOT NULL DEFAULT 'strict',
                auto_reconnect INTEGER NOT NULL DEFAULT 0,
                tool_limit INTEGER NOT NULL DEFAULT 50,
                concurrent INTEGER NOT NULL DEFAULT 0,
                server_url TEXT NOT NULL DEFAULT '',
                auth_mode TEXT NOT NULL DEFAULT 'none',
                oauth_client_id TEXT NOT NULL DEFAULT '',
                oauth_token_encrypted TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0
            );",
        )
        .unwrap();
        c
    }

    #[test]
    fn catalog_parsing_skips_bad_entries() {
        let json = r#"[
            {"id":"a","name":"A","command":"npx","args":["-y","x"]},
            {"id":"b","name":"B","server_url":"https://mcp.example.com/mcp"},
            {"id":"c","name":"C"},
            {"id":"","name":"D","command":"npx"}
        ]"#;
        let out = parse_catalog(json);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].args, vec!["-y", "x"]);
        assert_eq!(out[1].server_url, "https://mcp.example.com/mcp");
        assert!(parse_catalog("not json").is_empty());
        assert!(parse_catalog(r#"{"a":1}"#).is_empty());
    }

    #[test]
    fn install_is_disabled_strict_and_preserves_policy_defaults() {
        let c = mem();
        let e = &builtin()[0];
        let cfg = install(&c, e).unwrap();
        assert!(!cfg.enabled, "一键安装不得自动连接");
        assert!(!cfg.policy.is_trusted());
        assert!(!cfg.policy.auto_reconnect);
        assert!(!cfg.policy.concurrent);
        assert_eq!(cfg.policy.tool_limit, 50);
        assert_eq!(cfg.name, "Filesystem");
    }

    #[test]
    fn install_rejects_hard_block_and_avoids_name_clash() {
        let c = mem();
        let risky = MarketEntry {
            id: "bad".into(),
            name: "Bad".into(),
            description: String::new(),
            command: "mkfs.ext4".into(),
            args: vec!["/dev/sda1".into()],
            server_url: String::new(),
            source: "remote".into(),
        };
        assert!(install(&c, &risky).is_err());

        let e = &builtin()[0];
        install(&c, e).unwrap();
        let second = install(&c, e).unwrap();
        assert_eq!(second.name, "Filesystem-2");
    }

    #[test]
    fn unique_name_starts_from_two() {
        let existing = vec![];
        assert_eq!(unique_name(&existing, "X"), "X");
    }
}
