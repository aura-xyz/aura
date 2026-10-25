use std::fs;
use std::path::Path;

use serde_json::Value;

use super::{scope::AccessScope, ToolOutput};

const SKIP_DIRS: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    "vendor",
    "__pycache__",
    ".venv",
    "venv",
    ".idea",
    ".vscode",
];
const MAX_FILES: usize = 5000;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const TOP_K: usize = 5;
const CONTEXT_LINES: usize = 1;
const MAX_OUTPUT: usize = 6000;

struct Hit {
    path: String,
    line: usize,
    score: u32,
}

struct Segment {
    path: String,
    start: usize,
    end: usize,
    body: String,
}

pub fn search_workspace(scope: &AccessScope, args: &Value) -> Result<ToolOutput, String> {
    let query = args
        .get("query")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .unwrap_or("");
    if query.is_empty() {
        return Err("缺少参数 `query`".into());
    }
    let root_c = scope
        .workspace
        .canonicalize()
        .map_err(|e| format!("工作区不可用: {}", e))?;
    let terms: Vec<String> = query
        .to_lowercase()
        .split_whitespace()
        .map(|s| s.to_string())
        .collect();

    let mut hits = collect_hits(&root_c, &terms);
    let label = format!("Search '{}'", query);
    if hits.is_empty() {
        return Ok(ToolOutput {
            label,
            result: "未找到匹配内容，可尝试更换关键词，或先用 list_files 查看目录结构。".into(),
        
            diff: None,});
    }
    hits.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| a.path.cmp(&b.path))
            .then(a.line.cmp(&b.line))
    });

    let mut segments: Vec<Segment> = Vec::new();
    let mut budget = 0usize;
    'outer: for hit in &hits {
        if segments.len() >= TOP_K {
            break;
        }
        let idx0 = hit.line - 1;
        let start = idx0.saturating_sub(CONTEXT_LINES);
        let end = idx0 + CONTEXT_LINES;
        if segments.iter().any(|s| {
            s.path == hit.path && !(end < s.start || start > s.end)
        }) {
            continue;
        }
        let Ok(content) = fs::read_to_string(root_c.join(&hit.path)) else {
            continue;
        };
        let all: Vec<&str> = content.lines().collect();
        let end = end.min(all.len().saturating_sub(1));
        if start >= all.len() || start > end {
            continue;
        }
        let mut body = String::new();
        for i in start..=end {
            body.push_str(&format!("{}: {}\n", i + 1, all[i]));
        }
        let header = format!("{}:{}-{}\n", hit.path, start + 1, end + 1);
        if budget + header.len() + body.len() > MAX_OUTPUT {
            break 'outer;
        }
        budget += header.len() + body.len();
        segments.push(Segment {
            path: hit.path.clone(),
            start,
            end,
            body,
        });
    }

    let mut result = String::new();
    for seg in &segments {
        result.push_str(&format!("{}:{}-{}\n", seg.path, seg.start + 1, seg.end + 1));
        result.push_str(&seg.body);
        result.push('\n');
    }
    result.push_str("(可对上述文件使用 read_file 查看完整上下文)");
    Ok(ToolOutput { label, result, diff: None })
}

fn collect_hits(root_c: &Path, terms: &[String]) -> Vec<Hit> {
    let mut hits = Vec::new();
    let mut scanned = 0usize;
    let mut queue = vec![root_c.to_path_buf()];
    while let Some(dir) = queue.pop() {
        if scanned >= MAX_FILES {
            break;
        }
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            if scanned >= MAX_FILES {
                break;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry.path();
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            // 跳过符号链接/junction，防止通过链接把工作区外内容带入搜索结果
            if ft.is_symlink() {
                continue;
            }
            if ft.is_dir() {
                if !SKIP_DIRS.contains(&name.as_str()) && !name.starts_with('.') {
                    queue.push(path);
                }
                continue;
            }
            if name.starts_with('.') {
                continue;
            }
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if meta.len() > MAX_FILE_BYTES {
                continue;
            }
            scanned += 1;
            let Ok(content) = fs::read_to_string(&path) else {
                continue;
            };
            let rel = path
                .strip_prefix(root_c)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            for (idx, line) in content.lines().enumerate() {
                let lower = line.to_lowercase();
                let score = terms.iter().filter(|t| lower.contains(t.as_str())).count() as u32;
                if score > 0 {
                    hits.push(Hit {
                        path: rel.clone(),
                        line: idx + 1,
                        score,
                    });
                }
            }
        }
    }
    hits
}

/// 遍历目录树，收集相对路径（正斜杠）。
///
/// 与 `collect_hits` 同样跳过符号链接与噪音目录——符号链接会把
/// 工作区外的内容带进结果，噪音目录（node_modules 等）只会拖慢遍历。
fn collect_paths(root: &Path, out: &mut Vec<String>, scanned: &mut usize) {
    let mut queue = vec![root.to_path_buf()];
    while let Some(dir) = queue.pop() {
        if *scanned >= MAX_FILES {
            break;
        }
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            if *scanned >= MAX_FILES {
                break;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry.path();
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            if ft.is_symlink() {
                continue;
            }
            if ft.is_dir() {
                if !SKIP_DIRS.contains(&name.as_str()) && !name.starts_with('.') {
                    queue.push(path);
                }
                continue;
            }
            if name.starts_with('.') {
                continue;
            }
            *scanned += 1;
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            out.push(rel);
        }
    }
}

/// 文件列表的缓存。
///
/// `@` 面板每敲一个键都要查一次文件；每次重走一遍目录树，在大仓库里
/// 会明显卡顿（几百毫秒起步）。缓存 30 秒：改文件后 30 秒内看不到
/// 新文件，对「引用一个文件」这个场景完全够用。
struct PathCache {
    root: String,
    at: std::time::Instant,
    paths: Vec<String>,
}

static PATH_CACHE: std::sync::OnceLock<std::sync::Mutex<Option<PathCache>>> =
    std::sync::OnceLock::new();

const PATH_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(30);

/// 取目录下的全部文件路径（带缓存），相对路径、正斜杠。
pub fn all_paths(root: &Path) -> Vec<String> {
    let key = root.to_string_lossy().to_string();
    let cell = PATH_CACHE.get_or_init(|| std::sync::Mutex::new(None));
    if let Ok(guard) = cell.lock() {
        if let Some(c) = guard.as_ref() {
            if c.root == key && c.at.elapsed() < PATH_CACHE_TTL {
                return c.paths.clone();
            }
        }
    }
    let mut paths = Vec::new();
    let mut scanned = 0usize;
    collect_paths(root, &mut paths, &mut scanned);
    if let Ok(mut guard) = cell.lock() {
        *guard = Some(PathCache {
            root: key,
            at: std::time::Instant::now(),
            paths: paths.clone(),
        });
    }
    paths
}

/// 按文件名/路径匹配列出文件（`@` 引用用）。
///
/// 排序：**文件名命中优先于路径命中**。用户打 `store` 想找的是
/// `store.tsx` 而不是 `src/store/notes.md`。
pub fn list_paths(root: &Path, query: &str, limit: usize) -> Vec<String> {
    let q = query.trim().to_lowercase();
    let mut scored: Vec<(u8, String)> = Vec::new();
    for rel in all_paths(root) {
        let lower = rel.to_lowercase();
        let file = lower.rsplit('/').next().unwrap_or(&lower).to_string();
        let score = if q.is_empty() {
            2
        } else if file.contains(&q) {
            0
        } else if lower.contains(&q) {
            1
        } else {
            continue;
        };
        scored.push((score, rel));
    }
    scored.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    scored.into_iter().take(limit).map(|(_, p)| p).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::scope::testutil::scope as test_scope;
    use serde_json::json;

    #[test]
    fn finds_matches_with_path_and_line() {
        let root = std::env::temp_dir().join("aura_search_test");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("node_modules").join("pkg")).unwrap();
        fs::write(root.join("src").join("db.rs"), "fn init_db() {}\nlet conn = open();\n").unwrap();
        fs::write(root.join("node_modules").join("pkg").join("index.js"), "init_db\n").unwrap();

        let out = search_workspace(&test_scope(root.clone()), &json!({ "query": "init_db" })).unwrap();
        assert_eq!(out.label, "Search 'init_db'");
        assert!(out.result.contains("src/db.rs:1-2"), "result: {}", out.result);
        assert!(!out.result.contains("node_modules"), "应跳过 node_modules: {}", out.result);

        let empty = search_workspace(&test_scope(root.clone()), &json!({ "query": "不存在的词xyz" })).unwrap();
        assert!(empty.result.contains("未找到匹配内容"));

        assert!(search_workspace(&test_scope(root.clone()), &json!({})).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn search_skips_symlink_files() {
        use std::os::windows::fs::symlink_file;
        let base = std::env::temp_dir().join("aura_search_symlink");
        let _ = fs::remove_dir_all(&base);
        let root = base.join("ws");
        let outside = base.join("out");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(root.join("real.txt"), "needle_real content").unwrap();
        fs::write(outside.join("secret.txt"), "secret_needle content").unwrap();

        match symlink_file(outside.join("secret.txt"), root.join("link.txt")) {
            Ok(()) => {
                let out =
                    search_workspace(&test_scope(root.clone()), &json!({ "query": "secret_needle" })).unwrap();
                assert!(
                    !out.result.contains("secret_needle"),
                    "符号链接指向沙盒外的内容必须被跳过: {}",
                    out.result
                );
            }
            Err(e) => {
                eprintln!("skip symlink assertion (需要开发者模式或管理员权限): {}", e);
            }
        }

        let out = search_workspace(&test_scope(root.clone()), &json!({ "query": "needle_real" })).unwrap();
        assert!(out.result.contains("real.txt"), "正常文件必须可搜: {}", out.result);

        let _ = fs::remove_dir_all(&base);
    }

    /// `@` 文件面板用的路径列举。
    #[test]
    fn list_paths_matches_file_name_first() {
        let root = std::env::temp_dir().join("aura_list_paths_test");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("src").join("store")).unwrap();
        fs::create_dir_all(root.join("node_modules")).unwrap();
        fs::write(root.join("src").join("store.tsx"), "").unwrap();
        fs::write(root.join("src").join("store").join("notes.md"), "").unwrap();
        fs::write(root.join("node_modules").join("pkg.js"), "").unwrap();

        // 文件名命中优先于路径命中
        let hits = list_paths(&root, "store", 10);
        assert_eq!(hits[0], "src/store.tsx");
        assert!(hits.contains(&"src/store/notes.md".to_string()));
        // 噪音目录不出现
        assert!(!hits.iter().any(|h| h.contains("node_modules")));

        // 空查询返回全部（按路径排序）
        let all = list_paths(&root, "", 10);
        assert_eq!(all.len(), 2);

        // limit 生效
        assert_eq!(list_paths(&root, "", 1).len(), 1);

        let _ = fs::remove_dir_all(&root);
    }

    /// 符号链接指向工作区外时不能出现在列表里。
    #[test]
    fn list_paths_skips_symlinks() {
        use std::os::windows::fs::symlink_file;
        let base = std::env::temp_dir().join("aura_list_paths_symlink");
        let _ = fs::remove_dir_all(&base);
        let root = base.join("ws");
        let outside = base.join("out");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(root.join("real.txt"), "").unwrap();
        fs::write(outside.join("secret.txt"), "").unwrap();

        match symlink_file(outside.join("secret.txt"), root.join("link.txt")) {
            Ok(()) => {
                let hits = list_paths(&root, "", 10);
                assert!(hits.contains(&"real.txt".to_string()));
                assert!(!hits.iter().any(|h| h.contains("link")));
            }
            Err(e) => {
                eprintln!("skip symlink assertion (需要开发者模式或管理员权限): {}", e);
            }
        }
        let _ = fs::remove_dir_all(&base);
    }
}
