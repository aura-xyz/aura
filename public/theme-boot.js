// 首帧主题引导（v0.8.0 C34）。
//
// 原本是 index.html 里的一段内联 <script>：在 <head> 里同步执行，赶在
// 首次绘制前把 .dark 挂到 <html> 上，避免暗色用户看到一帧白底。
// 启用 CSP 后 `script-src 'self'` 会拦掉内联脚本（Tauri 的 nonce 只注入
// 带 http(s) src 的脚本与 <style>，不管我们自己写的内联块），
// 所以把它搬成外部文件——仍是 head 里的同步脚本，执行时机不变。
try {
  if (localStorage.getItem("aura-theme") === "dark") {
    document.documentElement.classList.add("dark");
  }
} catch (e) {
  // localStorage 被禁用时按浅色处理，与内联版行为一致
}
