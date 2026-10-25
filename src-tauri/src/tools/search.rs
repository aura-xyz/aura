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

/// 一个路径条目（文件或目录）。
#[derive(Debug, Clone)]
pub struct PathEntry {
    /// 相对路径（正斜杠）。**目录以 `/` 结尾**。
    pub path: String,
    /// 是目录吗
    pub is_dir: bool,
}

/// 遍历目录树，收集相对路径（正斜杠）。
///
/// 与 `collect_hits` 同样跳过符号链接与噪音目录——符号链接会把
/// 工作区外的内容带进结果，噪音目录（node_modules 等）只会拖慢遍历。
///
/// **目录也收集**：`@` 面板要能列出文件夹（用户打 `@app` 想看的是
/// app 这个目录及其内容），只列文件的话目录就永远选不到。
fn collect_paths(root: &Path, out: &mut Vec<PathEntry>, scanned: &mut usize) {
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
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            if ft.is_dir() {
                if SKIP_DIRS.contains(&name.as_str()) || name.starts_with('.') {
                    continue;
                }
                out.push(PathEntry {
                    path: format!("{rel}/"),
                    is_dir: true,
                });
                queue.push(path);
                continue;
            }
            if name.starts_with('.') {
                continue;
            }
            *scanned += 1;
            out.push(PathEntry {
                path: rel,
                is_dir: false,
            });
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
    paths: Vec<PathEntry>,
}

static PATH_CACHE: std::sync::OnceLock<std::sync::Mutex<Option<PathCache>>> =
    std::sync::OnceLock::new();

const PATH_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(30);

/// 取目录下的全部路径（带缓存），相对路径、正斜杠。
pub fn all_paths(root: &Path) -> Vec<PathEntry> {
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

/// 匹配打分。分值越小越靠前；`None` 表示不匹配。
///
/// 排序的取舍（每一条都对应一种用户意图）：
///
/// | 分值 | 命中方式 | 例子 | 用户意图 |
/// |---|---|---|---|
/// | 0 | 文件名完全等于 | `store.tsx` | 就要这个 |
/// | 1 | 目录名完全等于 | `store/` | 要这个目录 |
/// | 2 | **首段等于**（目录前缀） | `app/main.rs` | 打 `@app` 要 app 下的东西 |
/// | 3 | 名字以此开头 | `store-utils.ts` | 名字像 |
/// | 4 | 首段以此开头 | `src/main.rs` | 目录像 |
/// | 5 | 名字包含 | `my-store.tsx` | 名字里有 |
/// | 6 | 路径任意处包含 | `src/app/x.ts` | 路径里有 |
/// | 7 | 空查询 | 全部 | 先看个大概 |
///
/// 第 2 条是用户明确提的需求：输入 `@app` 要看到 **app 下的所有文件/文件夹**。
fn match_score(entry: &PathEntry, q: &str) -> Option<u8> {
    if q.is_empty() {
        return Some(7);
    }
    let lower = entry.path.to_lowercase();
    let name = entry
        .path
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_lowercase();
    let first = lower.split('/').next().unwrap_or("").to_string();

    if name == q {
        return Some(if entry.is_dir { 1 } else { 0 });
    }
    if q.contains('/') {
        // 带斜杠 → 按路径前缀理解（`src/ap` → src/app/...）
        return if lower.starts_with(q) { Some(2) } else { None };
    }
    if first == q {
        return Some(2);
    }
    if name.starts_with(q) {
        return Some(3);
    }
    if first.starts_with(q) {
        return Some(4);
    }
    if name.contains(q) {
        return Some(5);
    }
    if lower.contains(q) {
        return Some(6);
    }
    None
}

/// 按名字/路径匹配列出路径（`@` 引用用）。
///
/// 同分时**浅的在前**：`@` 刚打开时（空查询）先看到目录结构，
/// 而不是一堆深处的文件名。
pub fn list_paths(root: &Path, query: &str, limit: usize) -> Vec<PathEntry> {
    let q = query
        .trim()
        .trim_start_matches("./")
        .replace('\\', "/")
        .to_lowercase();
    let mut scored: Vec<(u8, usize, PathEntry)> = Vec::new();
    for entry in all_paths(root) {
        let Some(score) = match_score(&entry, &q) else {
            continue;
        };
        let depth = entry.path.matches('/').count();
        scored.push((score, depth, entry));
    }
    // 同分时：浅的在前 → 同深度时**文件在前**（先看到能直接引用的文件，
    // 而不是一堆子目录）→ 最后按路径名稳定排序。
    scored.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then_with(|| a.1.cmp(&b.1))
            .then_with(|| a.2.is_dir.cmp(&b.2.is_dir))
            .then_with(|| a.2.path.cmp(&b.2.path))
    });
    scored
        .into_iter()
        .take(limit)
        .map(|(_, _, e)| e)
        .collect()
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

        // 完全同名的目录排最前（用户打 store 要的就是这个 store）
        let hits = list_paths(&root, "store", 10);
        assert_eq!(hits[0].path, "src/store/");
        assert!(hits[0].is_dir);
        // 名字命中的文件排在只靠路径命中的前面
        let names: Vec<&str> = hits.iter().map(|h| h.path.as_str()).collect();
        let i_file = names.iter().position(|p| *p == "src/store.tsx").unwrap();
        let i_path = names.iter().position(|p| *p == "src/store/notes.md").unwrap();
        assert!(i_file < i_path, "{names:?}");
        // 噪音目录不出现
        assert!(!hits.iter().any(|h| h.path.contains("node_modules")));

        // limit 生效
        assert_eq!(list_paths(&root, "", 1).len(), 1);

        let _ = fs::remove_dir_all(&root);
    }

    /// **打 `@app` 要看到 app 下的所有文件与文件夹**（用户明确提的需求）。
    #[test]
    fn list_paths_supports_directory_prefix() {
        let root = std::env::temp_dir().join("aura_list_paths_dir");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("app").join("lib")).unwrap();
        fs::create_dir_all(root.join("other")).unwrap();
        fs::write(root.join("app").join("main.rs"), "").unwrap();
        fs::write(root.join("app").join("lib").join("util.rs"), "").unwrap();
        fs::write(root.join("other").join("x.rs"), "").unwrap();

        let hits = list_paths(&root, "app", 20);
        let paths: Vec<&str> = hits.iter().map(|h| h.path.as_str()).collect();
        // app 目录本身
        assert!(paths.contains(&"app/"), "{paths:?}");
        // app 下的文件与子目录都在
        assert!(paths.contains(&"app/main.rs"), "{paths:?}");
        assert!(paths.contains(&"app/lib/"), "{paths:?}");
        assert!(paths.contains(&"app/lib/util.rs"), "{paths:?}");
        // 别的目录不出现
        assert!(!paths.contains(&"other/x.rs"), "{paths:?}");

        // 目录条目带 is_dir 与结尾斜杠
        let dir = hits.iter().find(|h| h.path == "app/").unwrap();
        assert!(dir.is_dir);
        assert!(!hits.iter().find(|h| h.path == "app/main.rs").unwrap().is_dir);

        // 带斜杠的查询按路径前缀理解
        let sub = list_paths(&root, "app/lib", 20);
        let sub_paths: Vec<&str> = sub.iter().map(|h| h.path.as_str()).collect();
        assert!(sub_paths.contains(&"app/lib/util.rs"), "{sub_paths:?}");
        assert!(!sub_paths.contains(&"app/main.rs"), "{sub_paths:?}");

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
                assert!(hits.iter().any(|h| h.path == "real.txt"));
                assert!(!hits.iter().any(|h| h.path.contains("link")));
            }
            Err(e) => {
                eprintln!("skip symlink assertion (需要开发者模式或管理员权限): {}", e);
            }
        }
        let _ = fs::remove_dir_all(&base);
    }
}
