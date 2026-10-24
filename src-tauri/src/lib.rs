pub mod agent;
pub mod api;
pub mod audit;
pub mod commands;
pub mod db;
pub mod market;
pub mod secure;
pub mod tools;

use commands::{
    add_skill_source, delete_skill, fetch_remote_models, get_api_config, get_global_rules,
    get_models, get_provider_statuses, get_providers, get_selected_model, get_workspace,
    inspect_market_skill, install_market_skill, list_market_skills, list_skill_sources,
    list_skills, load_sessions, pull_ollama_model, refresh_provider_models, remove_session,
    remove_skill_source, remove_workspace, save_session, save_todos, send_message,
    set_api_config, set_global_rules, set_pinned_models, set_providers, set_selected_model,
    set_skill_enabled, set_workspace, stop_message, AppState,
};
use tauri::Manager;

#[cfg(windows)]
mod win_icon {
    #[link(name = "user32")]
    extern "system" {
        fn SendMessageW(hWnd: isize, msg: u32, wParam: usize, lParam: isize) -> isize;
        fn CreateIconFromResourceEx(
            presbits: *mut u8,
            cb_size: u32,
            is_icon: i32,
            version: u32,
            cx_desired: i32,
            cy_desired: i32,
            ui_flags: u32,
        ) -> isize;
    }

    /// Tauri 仅设置窗口 Small 图标；任务栏/跳转列表使用的 Big 图标缺失时
    /// Windows 会回退到系统默认图标，这里手动补设。
    pub unsafe fn set_taskbar_icon(hwnd: isize, png: &[u8]) {
        let hicon = CreateIconFromResourceEx(
            png.as_ptr() as *mut u8,
            png.len() as u32,
            1,
            0x0003_0000,
            0,
            0,
            0x0000_0040, // LR_DEFAULTSIZE
        );
        if hicon != 0 {
            SendMessageW(hwnd, 0x0080 /* WM_SETICON */, 1 /* ICON_BIG */, hicon);
        }
    }
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// 判断是否为应用自身的地址（允许 WebView 导航）。
///
/// - 生产：自定义协议 `tauri://`，或 Windows 上的 `http://tauri.localhost`
/// - 开发：`http://localhost:1420`（tauri.conf.json 的 devUrl）
/// 其余一律视为外部链接，交系统浏览器打开并阻止导航。
fn is_app_url(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" | "file" => true,
        "http" | "https" => {
            let host = url.host_str().unwrap_or("");
            host == "localhost"
                || host == "127.0.0.1"
                || host == "tauri.localhost"
        }
        _ => false,
    }
}

#[cfg(test)]
mod nav_tests {
    use super::is_app_url;

    #[test]
    fn allows_app_urls_only() {
        // 应用自身
        assert!(is_app_url(&"tauri://localhost/".parse().unwrap()));
        assert!(is_app_url(&"http://tauri.localhost/".parse().unwrap()));
        // 开发服务器
        assert!(is_app_url(&"http://localhost:1420/".parse().unwrap()));
        assert!(is_app_url(&"http://127.0.0.1:1420/".parse().unwrap()));
        // 外部链接必须拦截，否则 WebView 会跳走并失去标题栏
        assert!(!is_app_url(&"http://example.com/a".parse().unwrap()));
        assert!(!is_app_url(&"https://api.deepseek.com/models".parse().unwrap()));
        assert!(!is_app_url(&"http://localhost.evil.com/".parse().unwrap()));
        assert!(!is_app_url(&"ftp://files.example.com/".parse().unwrap()));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let api_key = std::env::var("OPENROUTER_API_KEY").ok();
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
.plugin(tauri_plugin_dialog::init())
    // v0.5.0：自动更新。update-check 需在 check 命令后调用以安装下载好的包，
    // relaunch 负责重启应用；perms 授予 updater 默认权限集
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;

            // v0.6.0：登记技能根目录。内置技能随安装包分发（只读）；
            // 市场/本地技能放应用数据目录，避开安装目录的 UAC 权限问题，
            // 且应用升级不丢失。工作区技能（.agents/skills/）由 runner
            // 每轮按会话工作区扫描，不进全局登记。
            {
                let mut roots: Vec<agent::skill::SkillRoot> = Vec::new();
                if let Ok(res) = app.path().resource_dir() {
                    roots.push(agent::skill::SkillRoot {
                        dir: res.join("builtin-skills"),
                        source: agent::skill::SkillSource::Builtin,
                    });
                }
                roots.push(agent::skill::SkillRoot {
                    dir: dir.join("skills").join("market"),
                    source: agent::skill::SkillSource::Market,
                });
                roots.push(agent::skill::SkillRoot {
                    dir: dir.join("skills").join("local"),
                    source: agent::skill::SkillSource::Local,
                });
                agent::skill::set_global_roots(roots);
            }

            let db = db::open(&dir.join("aura.db"))?;

            // 主窗口在代码中构建（而非 tauri.conf.json），因为 on_navigation
            // 只能在 Builder 阶段注册——Tauri 2 没有运行时 setter。
            //
            // 导航兜底的作用：模型输出里的链接一律交外部浏览器打开，阻止 WebView
            // 跟随。窗口为无边框，一旦跳到外部页面就会失去标题栏与关闭按钮，
            // 用户只能杀进程。即便前端漏掉 preventDefault，这里也能拦住。
            let handle = app.handle().clone();
            let window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::default(),
            )
            .title("aura")
            .inner_size(1280.0, 800.0)
            .maximized(true)
            .decorations(false)
            .on_navigation(move |url| {
                if is_app_url(url) {
                    return true;
                }
                use tauri_plugin_opener::OpenerExt;
                let _ = handle
                    .opener()
                    .open_url(url.to_string(), None::<&str>);
                false
            })
            .build()?;

            #[cfg(any(windows, target_os = "linux"))]
            {
                let icon = tauri::include_image!("icons/128x128.png");
                let _ = window.set_icon(icon);
                #[cfg(windows)]
                if let Ok(hwnd) = window.hwnd() {
                    unsafe {
                        win_icon::set_taskbar_icon(
                            hwnd.0 as isize,
                            include_bytes!("../icons/128x128.png"),
                        );
                    }
                }
            }
            let _ = &window;

            app.manage(AppState::new(api_key, db));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            send_message,
            stop_message,
            remove_session,
            load_sessions,
            save_session,
            save_todos,
            set_workspace,
            get_workspace,
            get_global_rules,
            set_global_rules,
            get_models,
            get_selected_model,
            set_selected_model,
            get_api_config,
            set_api_config,
            get_providers,
            set_providers,
            get_provider_statuses,
            refresh_provider_models,
            fetch_remote_models,
            set_pinned_models,
            pull_ollama_model,
            remove_workspace,
            list_skills,
            set_skill_enabled,
            delete_skill,
            list_market_skills,
            inspect_market_skill,
            install_market_skill,
            list_skill_sources,
            add_skill_source,
            remove_skill_source
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod manifest_tests {
    /// 更新清单结构必须与 tauri-plugin-updater 的预期完全一致。
    ///
    /// 直接用插件自己的反序列化类型校验仓库里的 `release/latest.json`：
    /// v0.6.0 及更早的清单写成 `platforms: [{architecture, url, signature}]`
    /// （数组），而插件要求 `platforms` 是 `HashMap<String, {url, signature}>`
    /// 且键为 `windows-x86_64` / `windows-x86_64-msi`。数组在反序列化时
    /// 直接失败 → 客户端「检查更新」永远报错，直到 v0.6.1 才发现
    /// （更新闭环此前从未被验证过）。这条测试会当场抓住那次错误。
    #[test]
    fn release_manifest_matches_updater_schema() {
        let raw = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../release/latest.json"
        ))
        .expect("release/latest.json 必须存在：兜底端点靠它");

        let inner: tauri_plugin_updater::RemoteReleaseInner =
            serde_json::from_str(&raw).expect("清单结构必须能被 updater 插件反序列化");

        match inner {
            tauri_plugin_updater::RemoteReleaseInner::Static { platforms } => {
                for target in ["windows-x86_64", "windows-x86_64-msi"] {
                    let p = platforms
                        .get(target)
                        .unwrap_or_else(|| panic!("缺少平台键 {target}"));
                    assert!(
                        p.url.as_str().starts_with("https://"),
                        "{target} 的 url 必须是绝对地址"
                    );
                    assert!(!p.signature.is_empty(), "{target} 的 signature 不能为空");
                }
            }
            tauri_plugin_updater::RemoteReleaseInner::Dynamic(_) => {
                panic!("应为 Static 格式（platforms 映射），不是单平台 Dynamic 格式")
            }
        }
    }
}
