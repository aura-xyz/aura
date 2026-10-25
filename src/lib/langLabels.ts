/**
 * 代码块语言的显示名。
 *
 * 抽成共享模块是因为 `Markdown.tsx` 与 `CodeBlockShell.tsx` 都要用：
 * 各写一份的话，改了其中一份就会出现「同一语言两个标签」。
 */

const LANG_LABELS: Record<string, string> = {
  bash: "Bash",
  c: "C",
  cpp: "C++",
  cs: "C#",
  css: "CSS",
  diff: "Diff",
  go: "Go",
  graphql: "GraphQL",
  html: "HTML",
  ini: "INI",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  jsx: "JSX",
  kotlin: "Kotlin",
  lua: "Lua",
  markdown: "Markdown",
  php: "PHP",
  python: "Python",
  py: "Python",
  rb: "Ruby",
  rs: "Rust",
  rust: "Rust",
  scss: "SCSS",
  sh: "Shell",
  shell: "Shell",
  sql: "SQL",
  swift: "Swift",
  toml: "TOML",
  ts: "TypeScript",
  tsx: "TSX",
  typescript: "TypeScript",
  vue: "Vue",
  xml: "XML",
  yaml: "YAML",
  yml: "YAML",
  zig: "Zig",
};

export function langLabel(raw: string): string {
  const key = raw.toLowerCase();
  return LANG_LABELS[key] ?? raw;
}
