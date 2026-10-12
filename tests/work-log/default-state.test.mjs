import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function createApi(invoke) {
  const cache = new Map();
  const exports = {};
  const source = ts.transpileModule(readFileSync("src/lib/api.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require: () => ({ invoke }),
    window: invoke ? { __TAURI_INTERNALS__: { invoke } } : {},
    localStorage: {
      getItem: (key) => cache.get(key) ?? null,
      setItem: (key, value) => cache.set(key, value),
    },
  });
  return exports.workLogApi;
}

test("浏览器未配置 AI 且无日志时正常返回空值", async () => {
  assert.equal(await createApi().get("2026-10-12"), null);
});

test("浏览器日志按日期保存且兼容导入不覆盖已有内容", async () => {
  const api = createApi();
  await api.save("2026-10-12", "已编辑日志");
  await api.save("2026-10-12", "旧日志", true);
  assert.equal(await api.get("2026-10-12"), "已编辑日志");
  assert.equal(await api.get("2026-10-11"), null);
  await api.save("2026-10-12", "");
  await api.save("2026-10-12", "旧日志", true);
  assert.equal(await api.get("2026-10-12"), "");
});

test("桌面端仍调用数据库命令", async () => {
  const calls = [];
  const api = createApi(async (command, args) => {
    calls.push([command, JSON.stringify(args)]);
    return command === "get_work_log" ? "数据库日志" : undefined;
  });
  assert.equal(await api.get("2026-10-12"), "数据库日志");
  await api.save("2026-10-12", "新内容", true);
  assert.deepEqual(calls, [
    ["get_work_log", JSON.stringify({ date: "2026-10-12" })],
    ["save_work_log", JSON.stringify({ date: "2026-10-12", content: "新内容", importOnly: true })],
  ]);
});

test("桌面数据库异常不会降级缓存而掩盖错误", async () => {
  const api = createApi(async () => { throw new Error("数据库读取失败"); });
  await assert.rejects(api.get("2026-10-12"), /数据库读取失败/);
});
