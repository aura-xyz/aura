import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/components/ModelSection.tsx", "utf8");

function saveCatalogBody(): string {
  const start = src.indexOf("async function saveCatalog");
  const end = src.indexOf("function startPull", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

/**
 * 实测反馈：模型列表能显示，但勾选后保存报「供应商不存在或未启用」，
 * 收藏一直写不进去。根因是 saveCatalog 在 setPinnedModels 之前无条件
 * 调了 refreshProviderModels —— 它走 router.executor_for，供应商未启用
 * 或未填 Key 就直接抛错，把整个 try 打断。
 *
 * ModelSection 依赖大量 Tauri API，渲染成本高；这条链路的关键不变量
 * 「保存收藏不依赖远端刷新」用源码契约钉住即可（同 cssTokens.test.ts）。
 */
describe("模型收藏保存链路", () => {
  it("只做持久化与收藏写入，不再前置刷新远端模型", () => {
    const body = saveCatalogBody();
    expect(body).toContain("persistProviders(");
    expect(body).toContain("setPinnedModels(");
    expect(body).not.toContain("refreshProviderModels(");
  });
});
