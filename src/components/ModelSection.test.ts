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
 * 实测反馈：模型列表能显示，但勾选后保存报「供应商不存在或未启用」。
 * 第一轮误判为「前置刷新多余」把它删了，结果目录里新勾选的模型
 * 永远收藏不上 —— 后端 set_pinned 只给已有条目打标记，必须先把远端
 * 模型合并进配置。现在改走 save_provider_catalog 一次完成合并+收藏，
 * 既不再联网、不依赖 executor_for，也不会漏掉新增模型。
 *
 * ModelSection 依赖大量 Tauri API，渲染成本高；这条链路的关键不变量
 * 用源码契约钉住即可（同 cssTokens.test.ts）。
 */
describe("模型收藏保存链路", () => {
  it("走原子目录保存，不再前置刷新远端、也不单独调 setPinnedModels", () => {
    const body = saveCatalogBody();
    expect(body).toContain("persistProviders(");
    expect(body).toContain("saveProviderCatalog(");
    expect(body).toContain("catalogList[p.id]");
    expect(body).not.toContain("refreshProviderModels(");
    expect(body).not.toContain("setPinnedModels(");
  });
});
