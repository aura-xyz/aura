pub mod agent;
pub mod api;
pub mod apps;
pub mod audit;
pub mod commands;
pub mod db;
pub mod history;
pub mod market;
pub mod mcp;
pub mod paths;
pub mod proc_group;
pub mod power;
pub mod providers;
pub mod secure;
pub mod secure_store;
pub mod security;
pub mod terminal;
pub mod timeline;
pub mod tools;
pub mod update_log;
pub mod updater;

use commands::{
    add_allowlist_path, add_skill_source, check_allowlist_path, delete_skill,
    export_timeline, fetch_remote_models, get_api_config, get_global_rules, get_models,
    get_provider_statuses, get_providers, get_selected_model, get_system_settings,
    get_workspace,
    inspect_market_skill, inspect_side_effects, install_market_skill, list_allowlist_paths, list_directory, list_market_providers,
    list_open_apps, list_workspace_files, open_in_app, read_file_text,
    get_session_goal, set_session_goal, export_session_bundle, write_export_bundle,
    list_market_skills, list_skill_sources, list_skills, list_timeline, load_sessions,
    pull_ollama_model, refresh_provider_models, remove_allowlist_path, remove_session,
    remove_skill_source, remove_workspace, save_session, save_todos, send_message,
    set_api_config, set_global_rules, set_pinned_models, save_provider_catalog,
    set_providers, set_selected_model, set_system_settings,
    notify, quit_app, set_skill_enabled, set_workspace, stop_message, resolve_approval, get_keystore_status, get_approval_policy, set_approval_policy,
    clear_provider_key,
    security_list_events, security_export_events, truncate_history,
    AppState,
};
use terminal::{
    list_shells, terminal_close, terminal_create, terminal_resize, terminal_write, TerminalManager,
};
use updater::{check_update, download_update};
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
///
/// **`file:` 不再放行（v0.8.0 C35）**。放行它等于把 WebView 变成任意本地
/// 文件的渲染器：模型在回答里写一个 `[点我](file:///C:/Users/x/.ssh/id_rsa)`，
/// 用户点一下就把密钥内容渲染进页面；`file://` 下的脚本还能读到同源目录。
/// 本地文件统一走 opener（系统默认程序打开），拖动文件走 drag-drop 事件，
/// 两条路都不经过 WebView 导航，功能没有损失。
fn is_app_url(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" => true,
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

    /// **本地文件必须交给系统程序打开，不能让 WebView 渲染**。
    ///
    /// 放行 `file:` 时，模型输出里的一个 `file:///C:/Users/x/.ssh/id_rsa`
    /// 链接被点开就能把密钥内容画进页面；`file://` 页面里的脚本还能顺着
    /// 同源规则读同目录的其它文件。
    #[test]
    fn rejects_file_scheme() {
        assert!(!is_app_url(&"file:///C:/Users/x/.ssh/id_rsa".parse().unwrap()));
        assert!(!is_app_url(&"file:///etc/passwd".parse().unwrap()));
        assert!(!is_app_url(&"file://localhost/C:/Windows/win.ini".parse().unwrap()));
    }

    /// 自定义协议只认 `tauri:`，别给 `data:` / `blob:` / `javascript:` 开口子。
    #[test]
    fn rejects_other_schemes() {
        for raw in [
            "data:text/html,<script>alert(1)</script>",
            "blob:https://example.com/abc",
            "javascript:alert(1)",
            "about:blank",
        ] {
            assert!(!is_app_url(&raw.parse().unwrap()), "应拦截: {raw}");
        }
    }
}

/// C53：把工作区与白名单目录注册进 Tauri asset protocol 范围。
///
/// 前端图片预览走 `asset://`，目录必须先在协议 scope 内才可被加载；
/// 安全边界与 `read_file_text` 同一闸门（AccessScope：工作区 + 白名单），
/// 绝不放大访问范围——只放行已经授权读写的目录，未存在的目录跳过。
fn register_asset_scope(app: &tauri::AppHandle, db: &rusqlite::Connection) {
    let scope = app.asset_protocol_scope();
    // 注册时同时登记「原始路径」与「规范化路径」两种形态：
    // 资产协议侧会把请求路径 canonicalize 成 `\\?\...` 形态再做 scope 匹配，
    // 只登记一种会因前缀不一致而 403。两者都登记即可覆盖。
    let register = |scope: &tauri::scope::fs::Scope, p: std::path::PathBuf| {
        if !p.is_dir() {
            return;
        }
        let _ = scope.allow_directory(p.clone(), true);
        if let Ok(c) = std::fs::canonicalize(&p) {
            let _ = scope.allow_directory(c, true);
        }
    };
    if let Ok(ws) = db::list_workspaces(db) {
        for w in ws {
            register(&scope, std::path::PathBuf::from(&w));
        }
    }
    for p in crate::commands::allowlist_paths(db) {
        register(&scope, p);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let api_key = std::env::var("OPENROUTER_API_KEY").ok();
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // v0.6.3：窗口位置/大小/最大化状态记忆。
        // 放在 setup 之前：插件要在窗口创建时挂上监听，晚了就记不到首次状态。
        // 首次启动没有历史状态，仍按下方 inner_size + maximized 走。
        .plugin(tauri_plugin_window_state::Builder::new().build())
        // v0.7.0：系统原生通知。无人值守场景下这是关键能力——
        // 任务跑完时人不在电脑前，系统通知是唯一的反馈渠道。
        .plugin(tauri_plugin_notification::init())
        // v0.5.0：自动更新。update-check 需在 check 命令后调用以安装下载好的包，
        // relaunch 负责重启应用；perms 授予 updater 默认权限集
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;

            // v0.7.0：技能目录必须**真实存在**。
            //
            // 白名单的内置默认项指向 `skills/local`，目录不存在时：
            // 设置页会挂「目录不存在」的角标，模型也往里写不了东西
            // （用户实测反馈）。所以这里先把 market/local 都建出来。
            let skills_dir = dir.join("skills");
            let _ = std::fs::create_dir_all(&skills_dir.join("market"));
            let _ = std::fs::create_dir_all(&skills_dir.join("local"));

            // v0.7.2-rc.2：更新日志目录。日志写不进去不致命（`log_event`
            // 全程静默），但目录得有个地方——先建，省得第一次写的时候再判断。
            update_log::init(dir.join("logs"));

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

            // v0.6.2：把内置默认项（技能目录）补进路径白名单。
            // 老库升级过来时这张表是空的，得在这里补上。
            commands::ensure_builtin_allowlist(&db);

            // 主窗口在代码中构建（而非 tauri.conf.json），因为 on_navigation
            // 只能在 Builder 阶段注册——Tauri 2 没有运行时 setter。
            //
            // 导航兜底的作用：模型输出里的链接一律交外部浏览器打开，阻止 WebView
            // 跟随。窗口为无边框，一旦跳到外部页面就会失去标题栏与关闭按钮，
            // 用户只能杀进程。即便前端漏掉 preventDefault，这里也能拦住。
            let handle = app.handle().clone();
            let mut builder = tauri::WebviewWindowBuilder::new(
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
            });
            // Linux 的无边框窗口没有 DWM 那样的原生圆角，只能靠透明窗口 +
            // 前端 CSS 圆角裁剪（见 index.css 的 html[data-platform="linux"]）。
            // Windows / macOS 保持不透明：它们的圆角由系统负责，透明反而会丢阴影。
            #[cfg(target_os = "linux")]
            {
                builder = builder.transparent(true);
            }
            let window = builder.build()?;

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

            // v0.7.0：系统托盘。
            //
            if cfg!(windows) {
                // v0.7.0：系统托盘（仅 Windows）。Linux 上按用户确认关闭直接退出，
                // 不常驻托盘，因此不构建托盘图标。
                {
                    use tauri::menu::{Menu, MenuItem};
                    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

                    let show_i = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
                    let quit_i = MenuItem::with_id(app, "quit", "退出 Aura", true, None::<&str>)?;
                    let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

                    let mut builder = TrayIconBuilder::with_id("main-tray")
                        .menu(&menu)
                        .tooltip("Aura")
                        .on_menu_event(|app, event| match event.id().as_ref() {
                            "show" => {
                                if let Some(w) = app.get_webview_window("main") {
                                    let _ = w.show();
                                    let _ = w.unminimize();
                                    let _ = w.set_focus();
                                }
                            }
                            "quit" => app.exit(0),
                            _ => {}
                        })
                        .on_tray_icon_event(|tray, event| {
                            // 左键单击：显示/唤起主窗口
                            if let TrayIconEvent::Click {
                                button: MouseButton::Left,
                                button_state: MouseButtonState::Up,
                                ..
                            } = event
                            {
                                if let Some(w) = tray.app_handle().get_webview_window("main") {
                                    let _ = w.show();
                                    let _ = w.unminimize();
                                    let _ = w.set_focus();
                                }
                            }
                        });

                    if let Some(icon) = app.default_window_icon() {
                        builder = builder.icon(icon.clone());
                    }
                    let _ = builder.build(app)?;
                }
            }

            // 密钥存储降级档要在应用数据目录放主密钥（v0.8.1 C45）。
            // 目录可能还不存在，顺手建出来。
            if let Ok(dir) = app.path().app_data_dir() {
                let _ = std::fs::create_dir_all(&dir);
                crate::secure_store::set_data_dir(dir);
            }

            // v0.8.0 C53：把历史工作区与白名单目录注册进资产协议范围，
            // 供文件面板 / 附件的图片预览走 asset:// 直接加载。
            register_asset_scope(app.handle(), &db);

            app.manage(AppState::new(api_key, db));

            // 安全事件落库通道（v0.8.0 C42）。工具层是纯函数，拿不到
            // AppState，所以在这里装一个全局 sink：它们只管调
            // `security::log_simple`，落库失败静默——记录不能反过来
            // 影响主流程。
            {
                use tauri::Manager;
                let handle = app.handle().clone();
                crate::security::events::install(move |e| {
                    if let Some(state) = handle.try_state::<commands::AppState>() {
                        if let Ok(db) = state.db.lock() {
                            let _ = crate::db::add_security_event(
                                &db,
                                crate::security::events::now_ms(),
                                e.session_id,
                                e.kind.as_str(),
                                e.subject,
                                e.reason,
                                e.rule_id,
                            );
                        }
                    }
                });
            }
            // 终端会话表独立于 AppState：它的生命周期跟着窗口走，
            // 与会话/工作区状态无关。
            app.manage(TerminalManager::default());
            Ok(())
        })
        .on_window_event(|window, event| {
            // v0.7.0：关闭按钮在 Windows 上 = 隐藏到托盘，不是退出。
            // Linux 上按用户确认：关闭时直接退出，不常驻托盘。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if cfg!(windows) {
                    if let Some(w) = window.get_webview_window("main") {
                        let _ = w.hide();
                        // v0.7.1：首次关闭发托盘提示
                        let app_handle = window.app_handle().clone();
                        tokio::spawn(async move {
                            let shown = {
                                let state = app_handle.state::<AppState>();
                                let db = state.db.lock().ok();
                                db.and_then(|conn| db::get_setting(&conn, "tray_hint_shown").ok())
                                    .flatten()
                            };
                            if shown.is_none() {
                                // 发送托盘提示通知
                                use tauri_plugin_notification::NotificationExt;
                                let _ = app_handle
                                    .notification()
                                    .builder()
                                    .title("Aura")
                                    .body("Aura 已最小化到托盘，点击图标可唤回窗口")
                                    .show();
                                // 标记已显示
                                let state = app_handle.state::<AppState>();
                                let _ = state
                                    .db
                                    .lock()
                                    .ok()
                                    .and_then(|conn| db::set_setting(&conn, "tray_hint_shown", "true").ok());
                            }
                        });
                        api.prevent_close();
                    }
                }
                // Linux/macOS：不拦截关闭，允许窗口直接关闭，应用随之退出。
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            send_message,
            stop_message,
            resolve_approval,
            get_keystore_status,
            security_list_events,
            security_export_events,
            get_approval_policy,
            set_approval_policy,
            remove_session,
            truncate_history,
            inspect_side_effects,
            notify,
            quit_app,
            check_update,
            download_update,
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
            clear_provider_key,
            get_providers,
            set_providers,
            get_provider_statuses,
            refresh_provider_models,
            fetch_remote_models,
            set_pinned_models,
            save_provider_catalog,
            get_system_settings,
            set_system_settings,
            pull_ollama_model,
            remove_workspace,
            list_skills,
            set_skill_enabled,
            delete_skill,
            list_market_skills,
            list_market_providers,
            inspect_market_skill,
            install_market_skill,
            list_skill_sources,
            add_skill_source,
            remove_skill_source,
            list_allowlist_paths,
            list_workspace_files,
            list_directory,
            read_file_text,
            list_open_apps,
            open_in_app,
            get_session_goal,
            set_session_goal,
            export_session_bundle,
            write_export_bundle,
            check_allowlist_path,
            add_allowlist_path,
            remove_allowlist_path,
            list_timeline,
            export_timeline,
            list_shells,
            terminal_create,
            terminal_write,
            terminal_resize,
            terminal_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod command_registry_tests {
    /// **每个 `#[tauri::command]` 函数都必须出现在 `invoke_handler` 里。**
    ///
    /// v0.6.2 踩过这个坑：时间线的两个命令函数写在了 `commands.rs` 里，
    /// 但忘了加进 `invoke_handler`，编译**完全正常**（未注册的函数不会报错），
    /// 前端一调就是 `Command list_timeline not found`。
    ///
    /// 编译器抓不到这种「写了但没接线」的错误，所以必须自己查。
    /// 这里直接读源文件文本比对——比运行时反射简单可靠。
    #[test]
    fn every_tauri_command_is_registered() {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");

        // 1) 扫出**所有**源文件里 #[tauri::command] 标注的函数名。
        //    只扫 commands.rs 是不够的：命令函数可以放在任何模块里
        //    （v0.7.0 的 check_update / download_update 就在 updater.rs），
        //    漏扫等于漏保护。
        let src_root = std::path::Path::new(manifest_dir).join("src");
        let mut sources: Vec<(String, String)> = Vec::new();
        collect_rs_files(&src_root, &mut sources);
        assert!(!sources.is_empty(), "应至少扫到一个源文件");

        let mut declared: Vec<String> = Vec::new();
        for (_path, src) in &sources {
            let lines: Vec<&str> = src.lines().collect();
            for (i, line) in lines.iter().enumerate() {
                if line.trim() != "#[tauri::command]" {
                    continue;
                }
                // 属性之后（跳过其它属性与文档注释）的第一个 `pub fn` 就是命令函数
                for l in &lines[i + 1..] {
                    let t = l.trim_start();
                    if let Some(rest) = t.strip_prefix("pub fn ") {
                        if let Some(name) = rest.split('(').next() {
                            declared.push(name.trim().to_string());
                        }
                        break;
                    }
                    if t.starts_with("#[") || t.starts_with("///") || t.is_empty() {
                        continue;
                    }
                    break;
                }
            }
        }
        assert!(!declared.is_empty(), "应至少扫到一个命令");

        // 2) 扫出 lib.rs 的 invoke_handler 列表
        let lib_src = std::fs::read_to_string(format!("{manifest_dir}/src/lib.rs")).expect("读 lib.rs");
        let start = lib_src
            .find("generate_handler![")
            .expect("lib.rs 必须有 generate_handler!");
        let end = lib_src[start..]
            .find("])")
            .map(|i| start + i)
            .expect("generate_handler 必须闭合");
        let handler_block = &lib_src[start..end];

        // 3) 比对
        let mut missing: Vec<&String> = Vec::new();
        for name in &declared {
            if !handler_block.contains(name) {
                missing.push(name);
            }
        }
        assert!(
            missing.is_empty(),
            "这些 #[tauri::command] 函数没注册进 invoke_handler，前端调用会报 \
             `Command <name> not found`：{missing:?}"
        );
    }

    /// 递归收集 src 下的所有 `.rs` 文件。
    fn collect_rs_files(dir: &std::path::Path, out: &mut Vec<(String, String)>) {
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_rs_files(&path, out);
            } else if path.extension().map(|e| e == "rs").unwrap_or(false) {
                if let Ok(src) = std::fs::read_to_string(&path) {
                    out.push((path.to_string_lossy().to_string(), src));
                }
            }
        }
    }
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
        let raw = manifest_raw();
        let inner: tauri_plugin_updater::RemoteReleaseInner =
            serde_json::from_str(&raw).expect("清单结构必须能被 updater 插件反序列化");

        // 版本决定「要几个平台项」：
        // 正式版必须 NSIS + MSI 都有（v0.6.3 起的既定形态）；
        // rc 期 MSI 产不出来——WiX 要求 pre-release 标识纯数字，`rc.1` 不合规，
        // 只能 `--bundles nsis`（见 §22.41）。若这里硬要求两项，rc 清单一提交
        // 测试就红，而那是预期状态。
        let version = serde_json::from_str::<serde_json::Value>(&raw)
            .expect("清单必须是合法 JSON")["version"]
            .as_str()
            .expect("清单必须有字符串 version")
            .to_string();
        let is_prerelease = version.contains('-');

        match inner {
            tauri_plugin_updater::RemoteReleaseInner::Static { platforms } => {
                // NSIS 项**永远**必须有：已发布的所有客户端都是用 NSIS 装的
                let nsis = platforms
                    .get("windows-x86_64")
                    .unwrap_or_else(|| panic!("缺少平台键 windows-x86_64"));
                assert!(
                    nsis.url.as_str().starts_with("https://"),
                    "windows-x86_64 的 url 必须是绝对地址"
                );
                assert!(!nsis.signature.is_empty(), "windows-x86_64 的 signature 不能为空");

                if is_prerelease {
                    // rc 期允许缺 MSI 项，但**一旦有就必须完整**
                    if let Some(p) = platforms.get("windows-x86_64-msi") {
                        assert!(
                            p.url.as_str().starts_with("https://"),
                            "windows-x86_64-msi 的 url 必须是绝对地址"
                        );
                        assert!(!p.signature.is_empty(), "windows-x86_64-msi 的 signature 不能为空");
                    }
                } else {
                    let msi = platforms.get("windows-x86_64-msi").unwrap_or_else(|| {
                        panic!("正式版（{version}）必须同时提供 windows-x86_64-msi")
                    });
                    assert!(
                        msi.url.as_str().starts_with("https://"),
                        "windows-x86_64-msi 的 url 必须是绝对地址"
                    );
                    assert!(!msi.signature.is_empty(), "windows-x86_64-msi 的 signature 不能为空");
                }
            }
            tauri_plugin_updater::RemoteReleaseInner::Dynamic(_) => {
                panic!("应为 Static 格式（platforms 映射），不是单平台 Dynamic 格式")
            }
        }
    }

    /// 清单里加了 `mirrors` 这类**插件不认识**的顶层字段时，客户端仍必须能解析。
    ///
    /// 这条不是形式主义：`mirrors`（v0.7.2-rc.2）是给**我们自己**读的字段，
    /// 但清单同时喂给插件的 `RemoteRelease`。插件 v2.13.3 的 `RemoteReleaseInner`
    /// 是 `#[serde(untagged)]` 且全库无 `deny_unknown_fields`，未知字段被忽略 ——
    /// 所以老客户端（0.7.1）不受影响。**若哪天插件改成严格模式，加了 mirrors
    /// 的清单会让所有存量客户端检查更新直接失败**，这条测试负责提前发现。
    #[test]
    fn manifest_with_mirrors_still_deserializes() {
        let mut v: serde_json::Value = serde_json::from_str(&manifest_raw()).expect("清单必须是合法 JSON");
        v["mirrors"] = serde_json::json!([
            "https://v4.gh-proxy.org/",
            "https://ghfast.top/"
        ]);
        let parsed: Result<tauri_plugin_updater::RemoteReleaseInner, _> = serde_json::from_value(v);
        assert!(
            parsed.is_ok(),
            "含 mirrors 字段的清单必须仍能被 updater 插件反序列化（否则存量客户端全部更新失败）"
        );
    }

    fn manifest_raw() -> String {
        std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../release/latest.json"
        ))
        .expect("release/latest.json 必须存在：兜底端点靠它")
    }
}
