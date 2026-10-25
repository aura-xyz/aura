pub mod agent;
pub mod api;
pub mod audit;
pub mod commands;
pub mod db;
pub mod history;
pub mod market;
pub mod paths;
pub mod providers;
pub mod secure;
pub mod timeline;
pub mod tools;
pub mod updater;

use commands::{
    add_allowlist_path, add_skill_source, check_allowlist_path, delete_skill,
    export_timeline, fetch_remote_models, get_api_config, get_global_rules, get_models,
    get_provider_statuses, get_providers, get_selected_model, get_workspace,
    inspect_market_skill, inspect_side_effects, install_market_skill, list_allowlist_paths, list_market_providers,
    list_workspace_files,
    list_market_skills, list_skill_sources, list_skills, list_timeline, load_sessions,
    pull_ollama_model, refresh_provider_models, remove_allowlist_path, remove_session,
    remove_skill_source, remove_workspace, save_session, save_todos, send_message,
    set_api_config, set_global_rules, set_pinned_models, set_providers, set_selected_model,
    notify, quit_app, set_skill_enabled, set_workspace, stop_message, truncate_history,
    AppState,
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

            // v0.7.0：系统托盘。
            //
            // 托盘的意义是「应用可以常驻后台」：关掉窗口不等于退出，
            // 用户从托盘图标能找回窗口。这正是网页做不到的桌面能力。
            //
            // 菜单项：显示主窗口 / 退出。关闭窗口不退出（见下面的
            // on_window_event），退出只能从这里走。
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

            app.manage(AppState::new(api_key, db));
            Ok(())
        })
        .on_window_event(|window, event| {
            // v0.7.0：关闭按钮 = 隐藏到托盘，不是退出。
            //
            // 常驻后台是桌面软件的关键能力（长任务跑完还能收到系统通知）。
            // 但「关了就找不回来」也是真实的困惑，所以托盘必须有，
            // 且托盘左键单击能唤回窗口。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if let Some(w) = window.get_webview_window("main") {
                    let _ = w.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            send_message,
            stop_message,
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
            list_market_providers,
            inspect_market_skill,
            install_market_skill,
            list_skill_sources,
            add_skill_source,
            remove_skill_source,
            list_allowlist_paths,
            list_workspace_files,
            check_allowlist_path,
            add_allowlist_path,
            remove_allowlist_path,
            list_timeline,
            export_timeline
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
