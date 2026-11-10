//! 子进程的**整树**终结（v0.8.1 C44）。
//!
//! 旧实现超时后只 `child.kill()`，杀掉的只是**直接子进程**。
//! `cmd /C "npm install"` 这类命令会再拉起一串子进程（npm → node → git），
//! 父进程被杀之后它们照样在后台跑着写文件——用户以为「已终止」，
//! 实际上半个安装还在往磁盘里写。
//!
//! ## Windows：作业对象（Job Object）
//!
//! 把子进程放进一个作业里，作业内的所有进程（包括后来派生的）都由系统
//! 统一管，`TerminateJobObject` 一次杀光；作业打上 `KILL_ON_JOB_CLOSE`，
//! Aura 崩溃退出时作业句柄关闭即连带杀干净，不留孤儿。
//!
//! **关键在于「先挂上作业，再让它跑起来」**：子进程一旦开始执行就可能
//! 在我们分配作业之前派生出后代，那部分后代不在作业里，作业也杀不到。
//! 所以这里用 `CREATE_SUSPENDED` 创建进程（创建了但没执行），分配进作业
//! 之后再恢复它的主线程——从那一刻起，它派生的所有子进程都会**继承
//! 作业**，一个都跑不掉。
//!
//! 分配失败（进程已在别的作业里、权限不足等）时：仍然恢复子线程让它
//! 正常执行，只是终结退回 `taskkill /T`（按系统父子关系杀整棵树）。
//!
//! ## Unix：进程组
//!
//! `setpgid` 让子进程成为新进程组的组长，`killpg` 一次把整组送走。
//! 自己 `setsid` 脱离进程组的程序逃得掉，所以还要单独 kill 直接子进程兜底。

use std::process::{Child, Command};

/// 进程组句柄。Windows 下是作业对象，Unix 下只是 pgid。
pub struct Group {
    inner: Inner,
}

enum Inner {
    /// Unix：进程组 id（pgid）。
    #[cfg(unix)]
    Unix(i32),
    /// Windows：作业对象句柄。
    #[cfg(windows)]
    Job(isize),
    /// 没有可用手段：退回 `taskkill /T` + 单进程 kill。
    None,
}

impl Group {
    /// 启动子进程并接管它的整棵进程树。
    ///
    /// 返回 `(子进程, 进程组)`。调用方负责在结束时 `terminate`。
    pub fn spawn(mut cmd: Command) -> Result<(Child, Group), String> {
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            // 0 = 以子进程自己的 pid 作为 pgid
            cmd.process_group(0);
            let child = cmd
                .spawn()
                .map_err(|e| format!("无法启动进程: {e}"))?;
            // process_group(0) 之后，pgid == 子进程 pid
            let group = Group {
                inner: Inner::Unix(child.id() as i32),
            };
            Ok((child, group))
        }
        #[cfg(windows)]
        {
            windows::spawn_managed(cmd)
        }
    }

    /// 终结整棵进程树。
    pub fn terminate(&self, child: &mut Child) {
        match self.inner {
            #[cfg(unix)]
            Inner::Unix(pgid) => {
                // 先杀整组，再单独 kill 直接子进程作为兜底：
                // 某些程序会自己 setsid 脱离进程组，那种情况下组杀不到它。
                unsafe {
                    libc::killpg(pgid, libc::SIGKILL);
                }
                let _ = child.kill();
            }
            #[cfg(windows)]
            Inner::Job(job) => {
                windows::terminate_job(job);
                let _ = child.kill();
            }
            Inner::None => {
                #[cfg(windows)]
                windows::taskkill_tree(child.id());
                let _ = child.kill();
            }
        }
    }
}

impl Drop for Group {
    fn drop(&mut self) {
        #[cfg(windows)]
        if let Inner::Job(job) = self.inner {
            // 关闭句柄。作业带 KILL_ON_JOB_CLOSE，关闭即杀光残余进程。
            windows::close_handle(job);
        }
    }
}

// ── Windows：作业对象 ─────────────────────────────────────────
#[cfg(windows)]
mod windows {
    use std::process::{Child, Command, Stdio};

    type Handle = isize;
    type Bool = i32;
    type DWORD = u32;

    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: i32 = 9;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: DWORD = 0x0000_2000;
    const PROCESS_TERMINATE: DWORD = 0x0001;
    const PROCESS_SET_QUOTA: DWORD = 0x0100;
    const PROCESS_TERMINATE_ALL: DWORD = 0x0001;
    const CREATE_SUSPENDED: DWORD = 0x0000_0004;
    const THREAD_SUSPEND_RESUME: DWORD = 0x0002;
    const TH32CS_SNAPTHREAD: DWORD = 0x0000_0004;
    const INVALID_HANDLE_VALUE: Handle = -1;

    #[repr(C)]
    #[derive(Default)]
    struct IoCounters {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    #[derive(Default)]
    struct BasicLimitInformation {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: DWORD,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: DWORD,
        affinity: usize,
        priority_class: DWORD,
        scheduling_class: DWORD,
    }

    #[repr(C)]
    #[derive(Default)]
    struct ExtendedLimitInformation {
        basic_limit_information: BasicLimitInformation,
        io_info: IoCounters,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    #[repr(C)]
    #[derive(Default)]
    struct ThreadEntry32 {
        dwSize: DWORD,
        cntUsage: DWORD,
        th32ThreadID: DWORD,
        th32OwnerProcessID: DWORD,
        tpBasePri: i32,
        tpDeltaPri: i32,
        dwFlags: DWORD,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(attributes: *mut std::ffi::c_void, name: *const u16) -> Handle;
        fn SetInformationJobObject(
            job: Handle,
            info_class: i32,
            info: *const ExtendedLimitInformation,
            length: DWORD,
        ) -> Bool;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> Bool;
        fn TerminateJobObject(job: Handle, exit_code: DWORD) -> Bool;
        fn CloseHandle(object: Handle) -> Bool;
        fn OpenProcess(access: DWORD, inherit: Bool, process_id: DWORD) -> Handle;
        fn CreateToolhelp32Snapshot(flags: DWORD, process_id: DWORD) -> Handle;
        fn Thread32First(snapshot: Handle, entry: *mut ThreadEntry32) -> Bool;
        fn Thread32Next(snapshot: Handle, entry: *mut ThreadEntry32) -> Bool;
        fn OpenThread(access: DWORD, inherit: Bool, thread_id: DWORD) -> Handle;
        fn ResumeThread(thread: Handle) -> DWORD;
    }

    /// 创建带「关闭即杀」标志的作业对象。
    fn create_job() -> Option<Handle> {
        unsafe {
            let job = CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
            if job == 0 {
                return None;
            }
            let mut limits = ExtendedLimitInformation::default();
            limits.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                job,
                JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                &limits,
                std::mem::size_of::<ExtendedLimitInformation>() as DWORD,
            );
            if ok == 0 {
                CloseHandle(job);
                return None;
            }
            Some(job)
        }
    }

    /// 把进程挂进作业；成功返回 true。
    fn assign(job: Handle, pid: u32) -> bool {
        unsafe {
            let process = OpenProcess(PROCESS_TERMINATE | PROCESS_SET_QUOTA, 0, pid);
            if process == 0 {
                return false;
            }
            let ok = AssignProcessToJobObject(job, process);
            CloseHandle(process);
            ok != 0
        }
    }

    /// 找出进程的主线程（快照里第一个属于它的线程）。
    fn primary_thread(pid: u32) -> Option<DWORD> {
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
            if snapshot == 0 || snapshot == INVALID_HANDLE_VALUE {
                return None;
            }
            let mut entry = ThreadEntry32::default();
            entry.dwSize = std::mem::size_of::<ThreadEntry32>() as DWORD;
            let mut found = None;
            if Thread32First(snapshot, &mut entry) != 0 {
                loop {
                    if entry.th32OwnerProcessID == pid {
                        found = Some(entry.th32ThreadID);
                        break;
                    }
                    if Thread32Next(snapshot, &mut entry) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snapshot);
            found
        }
    }

    /// 恢复被挂起的主线程，让子进程真正开始跑。
    fn resume(pid: u32) -> bool {
        unsafe {
            let Some(thread_id) = primary_thread(pid) else {
                return false;
            };
            let thread = OpenThread(THREAD_SUSPEND_RESUME, 0, thread_id);
            if thread == 0 {
                return false;
            }
            let resumed = ResumeThread(thread);
            CloseHandle(thread);
            resumed != u32::MAX
        }
    }

    /// 启动并接管：挂起创建 → 分配作业 → 恢复主线程。
    pub fn spawn_managed(mut cmd: Command) -> Result<(Child, super::Group), String> {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_SUSPENDED);

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("无法启动进程: {e}"))?;

        let job = create_job();
        let assigned = job.map(|j| assign(j, child.id())).unwrap_or(false);

        // 无论是否分配成功，都必须恢复主线程——否则子进程永远挂起，
        // 命令看起来「启动了」却什么都没干。
        if !resume(child.id()) {
            let _ = child.kill();
            let _ = child.wait();
            if let Some(j) = job {
                close_handle(j);
            }
            return Err("无法恢复子进程主线程，命令未执行".into());
        }

        if assigned {
            let group = super::Group {
                inner: super::Inner::Job(job.expect("作业对象已创建")),
            };
            Ok((child, group))
        } else {
            // 分配失败：退回 taskkill 路线，命令照常执行
            if let Some(j) = job {
                close_handle(j);
            }
            let group = super::Group {
                inner: super::Inner::None,
            };
            Ok((child, group))
        }
    }

    /// 用 `taskkill /T /F` 按父子关系杀整棵树（作业分配失败时的兜底）。
    pub fn taskkill_tree(pid: u32) {
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    pub fn terminate_job(job: Handle) {
        unsafe {
            TerminateJobObject(job, PROCESS_TERMINATE_ALL);
        }
    }

    pub fn close_handle(handle: Handle) {
        unsafe {
            CloseHandle(handle);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 写一个「父进程 + 后台子孙」的脚本。
    ///
    /// 子孙不停往文件里追加内容——只要它还活着，文件就在长。
    /// 父进程自己则一直睡，方便我们观察「杀父之后子孙是否也死」。
    fn write_script(dir: &std::path::Path, marker: &std::path::Path) -> std::path::PathBuf {
        if cfg!(windows) {
            // 两个批处理：grand.bat 负责不停写文件，parent.bat 后台起它
            // 然后自己睡。路径放在临时目录（无空格）里，省掉 cmd 引号地狱。
            let grand = dir.join("grand.bat");
            std::fs::write(
                &grand,
                format!(
                    "@echo off\r\nfor /L %%i in (1,1,600) do @(echo x>>{} & ping -n 2 127.0.0.1 > nul)\r\n",
                    marker.display()
                ),
            )
            .unwrap();
            let parent = dir.join("parent.bat");
            std::fs::write(
                &parent,
                format!(
                    "@echo off\r\nstart \"\" /B {}\r\nping -n 60 127.0.0.1 > nul\r\n",
                    grand.display()
                ),
            )
            .unwrap();
            parent
        } else {
            let path = dir.join("parent.sh");
            let body = format!(
                "#!/bin/sh\n( while true; do echo x >> \"{}\"; sleep 0.2; done ) &\nwhile true; do sleep 0.2; done\n",
                marker.display()
            );
            std::fs::write(&path, body).unwrap();
            path
        }
    }

    fn script_command(script: &std::path::Path) -> Command {
        if cfg!(windows) {
            let mut c = Command::new("cmd");
            c.arg("/C").arg(script);
            c
        } else {
            let mut c = Command::new("sh");
            c.arg(script);
            c
        }
    }

    fn marker_size(path: &std::path::Path) -> u64 {
        std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
    }

    /// 终结必须连**子孙**一起带走。
    ///
    /// 只杀直接子进程时，安装类命令派生的 node/git 进程会继续在后台
    /// 写文件——用户以为已经停了，其实还在动。
    #[test]
    fn terminating_kills_grandchildren() {
        let dir = std::env::temp_dir().join(format!("aura-pg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let marker = dir.join("grand.txt");
        let script = write_script(&dir, &marker);

        let (mut child, group) = Group::spawn(script_command(&script)).expect("应能启动脚本");

        // 等子孙真正开始写文件
        std::thread::sleep(std::time::Duration::from_millis(2500));
        let before = marker_size(&marker);
        assert!(before > 0, "子孙进程应当已经在写文件（测试前提不成立）");

        group.terminate(&mut child);
        let _ = child.wait();

        // 再等一会儿：如果子孙还活着，文件会继续长
        std::thread::sleep(std::time::Duration::from_millis(3000));
        let after = marker_size(&marker);
        assert_eq!(
            before, after,
            "子孙进程仍在运行：文件还在增长（{before} -> {after}）"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 普通命令要能正常跑完：挂起创建 + 恢复主线程这条路径不能把命令搞坏。
    #[test]
    fn ordinary_command_still_runs() {
        let (mut child, _group) = Group::spawn(if cfg!(windows) {
            let mut c = Command::new("cmd");
            c.args(["/C", "echo", "hello"]);
            c
        } else {
            let mut c = Command::new("sh");
            c.args(["-c", "echo hello"]);
            c
        })
        .expect("应能启动");
        let status = child.wait().expect("应能等待退出");
        assert!(status.success(), "普通命令应当正常退出");
    }
}
