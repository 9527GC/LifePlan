import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";

// 先运行 npm run build；验证真实产物，而不是只匹配源码中的 import 文本。
const manifest = JSON.parse(readFileSync(new URL("../../dist/.vite/manifest.json", import.meta.url), "utf8"));
const entry = Object.keys(manifest).find((key) => manifest[key].isEntry);
function closure(key, found = new Set()) {
  if (found.has(key)) return found;
  found.add(key);
  for (const dependency of manifest[key].imports ?? []) closure(dependency, found);
  return found;
}
const pages = ["DailyList", "Inbox", "Pomodoro", "FloatingPomodoro", "Rewards", "DailyReviewDemo"];
test("所有页面、主窗口布局和引导均为独立动态入口", () => {
  for (const name of [...pages, "Layout", "OnboardingCarousel", "FeedbackModal", "MarkdownEditorImpl"]) {
    const key = Object.keys(manifest).find((key) => key.endsWith(`/${name}.tsx`));
    assert.ok(key, `${name} 应有独立产物`);
    assert.equal(manifest[key].isDynamicEntry, true);
    assert.ok(!closure(entry).has(key), `${name} 不应进入静态入口依赖图`);
  }
});
test("今日事和悬浮窗口不会静态加载富文本编辑器及其他页面", () => {
  for (const name of ["DailyList", "FloatingPomodoro"]) {
    const loaded = closure(`src/pages/${name}.tsx`);
    for (const other of pages.filter((page) => page !== name)) assert.ok(!loaded.has(`src/pages/${other}.tsx`));
    assert.ok(!loaded.has("src/components/ui/MarkdownEditorImpl.tsx"));
    if (name === "FloatingPomodoro") assert.ok(!loaded.has("src/components/layout/Layout.tsx"));
  }
});
test("所有 JS 分包保持在原有 500 kB 警告阈值以内", () => {
  for (const chunk of Object.values(manifest)) {
    if (chunk.file.endsWith(".js")) assert.ok(statSync(new URL(`../../dist/${chunk.file}`, import.meta.url)).size < 500_000, chunk.file);
  }
});
test("主窗口和悬浮窗口都包含公共样式", () => {
  assert.ok([...closure(entry)].some((key) => (manifest[key].css ?? []).length > 0));
});
const initial = closure(entry);
const main = new Set([...initial, ...closure("src/components/layout/Layout.tsx"), ...closure("src/pages/DailyList.tsx")]);
const floating = new Set([...initial, ...closure("src/pages/FloatingPomodoro.tsx")]);
for (const [label, keys] of [["公共入口", initial], ["今日事首屏", main], ["悬浮番茄钟", floating]]) {
  const files = new Set([...keys].map((key) => manifest[key].file).filter((file) => file.endsWith(".js")));
  const buffers = [...files].map((file) => readFileSync(new URL(`../../dist/${file}`, import.meta.url)));
  console.log(`${label}：${buffers.reduce((n, b) => n + b.length, 0)} 字节，逐包 gzip ${buffers.reduce((n, b) => n + gzipSync(b).length, 0)} 字节`);
}
