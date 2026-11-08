/// <reference types="vite/client" />

/** 构建期注入的 `package.json` 版本号，见 `vite.config.ts` 的 `define`。 */
declare const __APP_VERSION__: string;

// highlight.js 无官方类型，@types/highlight.js 也不覆盖 lib/languages/*。
// 语言模块是「注册函数」：(hljs) => void，与 lowlight 的 LanguageFn 同形
// （lowlight 正是从 highlight.js 转出的这个类型）。
declare module "highlight.js/lib/languages/*" {
  import type { LanguageFn } from "lowlight";
  const language: LanguageFn;
  export default language;
}
