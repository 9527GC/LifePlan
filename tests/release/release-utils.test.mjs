import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertVersionConsistency,
  buildChangeSections,
  renderChangelogEntry,
  upsertChangelog,
  findReleaseAssets,
  renderReleaseBody,
} from "../../scripts/release/release-utils.mjs";

test("版本全部一致时返回版本对象", () => {
  assert.deepEqual(
    assertVersionConsistency("1.0.5", {
      packageJson: "1.0.5",
      cargoToml: "1.0.5",
      tauriConfig: "1.0.5",
    }),
    { packageJson: "1.0.5", cargoToml: "1.0.5", tauriConfig: "1.0.5" },
  );
});

test("版本不一致时列出所有实际版本", () => {
  assert.throws(
    () => assertVersionConsistency("1.0.5", {
      packageJson: "1.0.5",
      cargoToml: "1.0.4",
      tauriConfig: "1.0.5",
    }),
    /标签期望版本：1\.0\.5[\s\S]*Cargo\.toml：1\.0\.4/,
  );
});

test("按 Conventional Commit 前缀分类且过滤自动日志提交", () => {
  assert.deepEqual(buildChangeSections([
    "feat: 支持自动发布说明",
    "fix：修复版本号展示",
    "refactor: 整理发布流程",
    "docs: 自动更新 CHANGELOG v1.0.4 [skip changelog]",
    "构建：升级依赖",
  ]), [
    { title: "✨ 新增功能", items: ["支持自动发布说明"] },
    { title: "🐛 问题修复", items: ["修复版本号展示"] },
    { title: "⚡ 优化改进", items: ["整理发布流程"] },
    { title: "🔧 其他更新", items: ["构建：升级依赖"] },
  ]);
});

test("CHANGELOG 在标题后插入新版本且同标签重复运行不重复插入", () => {
  const entry = renderChangelogEntry("v1.0.5", "2026-09-16", [
    { title: "✨ 新增功能", items: ["自动生成日志"] },
  ]);
  const once = upsertChangelog("# 更新日志\n\n## v1.0.4（2026-09-15）\n\n- 旧内容\n", "v1.0.5", entry);
  assert.match(once, /^# 更新日志\n\n## v1\.0\.5（2026-09-16）[\s\S]*## v1\.0\.4/m);
  assert.equal(upsertChangelog(once, "v1.0.5", entry), once);
});

test("选择三种安装包和更新元数据", () => {
  const assets = findReleaseAssets([
    { name: "LifePlan_1.0.5_x64-setup.exe" },
    { name: "LifePlan_1.0.5_aarch64.dmg" },
    { name: "LifePlan_1.0.5_x86_64.dmg" },
    { name: "latest.json" },
    { name: "LifePlan_1.0.5_x64-setup.exe.sig" },
  ]);
  assert.equal(assets.windows.name, "LifePlan_1.0.5_x64-setup.exe");
  assert.equal(assets.macosArm64.name, "LifePlan_1.0.5_aarch64.dmg");
  assert.equal(assets.macosX64.name, "LifePlan_1.0.5_x86_64.dmg");
});

test("Release 正文使用实际资产文件名和 CHANGELOG 链接", () => {
  const body = renderReleaseBody({
    tag: "v1.0.5",
    sections: [{ title: "🐛 问题修复", items: ["修复升级失败"] }],
    repository: "9527GC/LifePlan",
    defaultBranch: "main",
    assets: {
      windows: { name: "LifePlan_1.0.5_x64-setup.exe" },
      macosArm64: { name: "LifePlan_1.0.5_aarch64.dmg" },
      macosX64: { name: "LifePlan_1.0.5_x86_64.dmg" },
    },
  });
  assert.match(body, /修复升级失败/);
  assert.match(body, /releases\/download\/v1\.0\.5\/LifePlan_1\.0\.5_x64-setup\.exe/);
  assert.match(body, /blob\/main\/CHANGELOG\.md/);
});

test("缺少 macOS Intel 安装包时拒绝发布", () => {
  assert.throws(
    () => findReleaseAssets([
      { name: "LifePlan_1.0.5_x64-setup.exe" },
      { name: "LifePlan_1.0.5_aarch64.dmg" },
      { name: "latest.json" },
    ]),
    /macOS Intel 安装包应存在且仅存在一个，实际找到 0 个/,
  );
});
test("重复安装包时拒绝发布", () => {
  assert.throws(
    () => findReleaseAssets([
      { name: "LifePlan_1.0.5_x64-setup.exe" },
      { name: "LifePlan_1.0.5_x64-copy-setup.exe" },
      { name: "LifePlan_1.0.5_aarch64.dmg" },
      { name: "LifePlan_1.0.5_x86_64.dmg" },
      { name: "latest.json" },
    ]),
    /Windows 安装包应存在且仅存在一个，实际找到 2 个/,
  );
});

test("汇总脚本生成 latest.json 并去重同名同内容签名", () => {
  const workspace = mkdtempSync(join(tmpdir(), "lifeplan-release-assets-"));
  const assetsDirectory = join(workspace, "assets");
  const outputDirectory = join(workspace, "release-upload");
  const contextFile = join(workspace, "release-context.json");
  const bodyFile = join(workspace, "release-body.md");
  const writeAsset = (relativePath, content) => {
    const filePath = join(assetsDirectory, relativePath);
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(filePath, content);
  };

  try {
    writeFileSync(contextFile, `${JSON.stringify({
      tag: "v1.0.5",
      version: "1.0.5",
      date: "2026-09-16",
      sections: [{ title: "✨ 新增功能", items: ["自动发布"] }],
      releaseNotesMarkdown: "### ✨ 新增功能\n- 自动发布",
      repository: "9527GC/LifePlan",
      defaultBranch: "main",
    })}\n`);
    writeAsset("metadata/latest.json", "{\"legacy\":true}");
    writeAsset("duplicate/latest.json", "{\"legacy\":true}");
    writeAsset("windows/LifePlan_1.0.5_x64-setup.exe", "windows-installer");
    writeAsset("windows/LifePlan_1.0.5_x64-setup.exe.sig", "windows-signature");
    writeAsset("duplicate/LifePlan_1.0.5_x64-setup.exe.sig", "windows-signature");
    writeAsset("mac-arm/LifePlan_1.0.5_aarch64-apple-darwin.dmg", "mac-arm-installer");
    writeAsset("mac-arm/LifePlan_1.0.5_aarch64-apple-darwin.app.tar.gz", "mac-arm-updater");
    writeAsset("mac-arm/LifePlan_1.0.5_aarch64-apple-darwin.app.tar.gz.sig", "mac-arm-signature");
    writeAsset("mac-x64/LifePlan_1.0.5_x86_64-apple-darwin.dmg", "mac-x64-installer");
    writeAsset("mac-x64/LifePlan_1.0.5_x86_64-apple-darwin.app.tar.gz", "mac-x64-updater");
    writeAsset("mac-x64/LifePlan_1.0.5_x86_64-apple-darwin.app.tar.gz.sig", "mac-x64-signature");

    execFileSync(process.execPath, [
      "scripts/release/validate-release-assets.mjs",
      "--context-file", contextFile,
      "--assets-dir", assetsDirectory,
      "--output-dir", outputDirectory,
      "--body-file", bodyFile,
    ], { encoding: "utf8" });

    const latest = JSON.parse(readFileSync(join(outputDirectory, "latest.json"), "utf8"));
    assert.equal(latest.version, "1.0.5");
    assert.equal(latest.platforms["windows-x86_64"].signature, "windows-signature");
    assert.equal(latest.platforms["darwin-aarch64"].signature, "mac-arm-signature");
    assert.equal(latest.platforms["darwin-x86_64"].signature, "mac-x64-signature");
    assert.match(readFileSync(bodyFile, "utf8"), /下载 Windows 安装包/);
    assert.equal(readFileSync(join(outputDirectory, "LifePlan_1.0.5_x64-setup.exe.sig"), "utf8"), "windows-signature");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
