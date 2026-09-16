# 自动化 Release 正文与更新日志实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 推送版本标签后，自动校验应用版本、从 Git 提交生成分类更新内容、回写完整 CHANGELOG、构建三类桌面安装包，并发布带下载表格的 GitHub Release。

**Architecture:** 将可单元测试的版本校验、提交分类、CHANGELOG 渲染和 Release Markdown 生成逻辑集中到一个 Node ESM 脚本中。GitHub Actions 由准备 job 生成并回写 CHANGELOG，再并行构建三种 Tauri 目标，最后在单一汇总 job 中校验实际资产、上传资产并通过 GitHub CLI 创建或更新 Release，避免矩阵 job 并发修改同一个 Release。

**Tech Stack:** GitHub Actions、Node.js 22 ESM、Node 内置 `node:test` / `node:assert`、Git、GitHub CLI、Tauri v2、npm。

## Global Constraints

- 仅 `v*` 标签推送触发正式发布，且不自动修改应用版本号或创建标签。
- 标签去除 `v` 后的版本必须与 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 完全一致；不一致时必须在构建前失败。
- 更新内容仅依据上一个 `v*` 标签到当前标签的 Git 提交标题生成；首次发布使用当前标签可达的全部提交。
- `feat:` / `feat：` 归入“✨ 新增功能”，`fix:` / `fix：` 归入“🐛 问题修复”，`perf:`、`perf：`、`refactor:`、`refactor：`归入“⚡ 优化改进”，其他提交归入“🔧 其他更新”。
- 自动日志提交必须使用 `docs: 自动更新 CHANGELOG <tag> [skip changelog]` 格式，并从后续用户可见更新中排除。
- `CHANGELOG.md` 使用 `Asia/Shanghai` 的 `YYYY-MM-DD` 日期并保持版本倒序；每个 Release 仅链接完整 CHANGELOG，不展开旧版本。
- 发布目标固定为 Windows x64、macOS Apple Silicon、macOS Intel；任一构建或资产校验失败时不得创建或更新正式 Release。
- 代码注释、文档和 Git 提交信息使用中文。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `scripts/release/release-utils.mjs` | 纯函数：读取三处版本号、分类提交、渲染 CHANGELOG 条目、将条目插入日志、渲染 Release 正文、寻找实际安装资产。 |
| `scripts/release/prepare-release.mjs` | 工作流命令入口：读取 GitHub 环境变量和 Git 历史，执行版本校验、生成本次变更、更新 `CHANGELOG.md`，将 JSON / Markdown / 输出变量写入指定文件。 |
| `scripts/release/validate-release-assets.mjs` | 汇总发布入口：读取所有下载的 artifact，找出每个平台实际安装包，生成含准确下载 URL 的 Release 正文并校验 `latest.json` 与 updater 签名资产。 |
| `tests/release/release-utils.test.mjs` | Node 内置测试，覆盖版本校验输入、提交分类、日志幂等插入、正文和资产选择。 |
| `.github/workflows/release.yml` | 串行 prepare → 并行构建 → 单一 publish 的发布工作流。 |
| `CHANGELOG.md` | 自动生成、自动维护的完整版本历史。 |
| `docs/自动更新发布指南.md` | 面向维护者的发版前版本同步、自动日志、发布后校验和失败排查指南。 |
| `package.json` | 新增本地可重复运行的更新日志测试命令。 |

## Task 1: 实现可测试的发布说明生成模块

**Files:**
- Create: `E:/项目/LifePlanTodolist/scripts/release/release-utils.mjs`
- Create: `E:/项目/LifePlanTodolist/tests/release/release-utils.test.mjs`
- Modify: `E:/项目/LifePlanTodolist/package.json`

**Interfaces:**
- Consumes: 字符串版本号、Git 提交标题数组、日期、tag、仓库全名、默认分支、资产元数据数组。
- Produces: `assertVersionConsistency(expectedVersion, versions)`、`buildChangeSections(commitSubjects)`、`renderChangelogEntry(tag, date, sections)`、`upsertChangelog(changelog, tag, entry)`、`findReleaseAssets(files)`、`renderReleaseBody(input)` 纯函数；供两个工作流入口和单元测试调用。

- [ ] **Step 1: 写入失败测试，锁定版本校验与提交分类行为**

创建 `tests/release/release-utils.test.mjs`，先写入以下测试；此时导入会失败：

```js
import test from "node:test";
import assert from "node:assert/strict";
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
```

- [ ] **Step 2: 运行测试并确认失败原因是模块不存在**

Run:

```powershell
node --test tests/release/release-utils.test.mjs
```

Expected: FAIL，错误包含 `Cannot find module` 或 `ERR_MODULE_NOT_FOUND`，指向 `scripts/release/release-utils.mjs`。

- [ ] **Step 3: 实现版本、提交和 CHANGELOG 纯函数**

创建 `scripts/release/release-utils.mjs`，使用以下完整实现作为起点：

```js
const CATEGORY_RULES = [
  { pattern: /^feat(?:\([^)]*\))?\s*[:：]\s*/iu, title: "✨ 新增功能" },
  { pattern: /^fix(?:\([^)]*\))?\s*[:：]\s*/iu, title: "🐛 问题修复" },
  { pattern: /^(?:perf|refactor)(?:\([^)]*\))?\s*[:：]\s*/iu, title: "⚡ 优化改进" },
];

const CATEGORY_ORDER = ["✨ 新增功能", "🐛 问题修复", "⚡ 优化改进", "🔧 其他更新"];
const SKIP_CHANGELOG_MARKER = "[skip changelog]";

export function assertVersionConsistency(expectedVersion, versions) {
  const entries = Object.entries(versions);
  if (entries.some(([, value]) => value !== expectedVersion)) {
    const actual = entries.map(([name, value]) => `${name}：${value}`).join("\n");
    throw new Error(`版本号不一致。标签期望版本：${expectedVersion}\n${actual}`);
  }
  return versions;
}

export function buildChangeSections(commitSubjects) {
  const sections = new Map(CATEGORY_ORDER.map((title) => [title, []]));
  for (const rawSubject of commitSubjects) {
    const subject = rawSubject.trim();
    if (!subject || subject.includes(SKIP_CHANGELOG_MARKER)) continue;
    const rule = CATEGORY_RULES.find(({ pattern }) => pattern.test(subject));
    const title = rule?.title ?? "🔧 其他更新";
    const item = rule ? subject.replace(rule.pattern, "").trim() : subject;
    sections.get(title).push(item || subject);
  }
  const result = CATEGORY_ORDER
    .map((title) => ({ title, items: sections.get(title) }))
    .filter(({ items }) => items.length > 0);
  return result.length > 0
    ? result
    : [{ title: "🔧 其他更新", items: ["本版本包含构建与发布维护更新。"] }];
}

export function renderChangeSections(sections) {
  return sections.map(({ title, items }) => `### ${title}\n${items.map((item) => `- ${item}`).join("\n")}`).join("\n\n");
}

export function renderChangelogEntry(tag, date, sections) {
  return `## ${tag}（${date}）\n\n${renderChangeSections(sections)}\n`;
}

export function upsertChangelog(changelog, tag, entry) {
  const normalized = changelog.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trimEnd();
  if (new RegExp(`^## ${escapeRegExp(tag)}（`, "m").test(normalized)) return `${normalized}\n`;
  const header = "# 更新日志";
  if (!normalized) return `${header}\n\n${entry}`;
  if (!normalized.startsWith(header)) return `${header}\n\n${entry}\n${normalized}\n`;
  const rest = normalized.slice(header.length).replace(/^\n+/, "");
  return `${header}\n\n${entry}${rest ? `\n${rest}\n` : ""}`;
}

export function findReleaseAssets(files) {
  const choose = (pattern, description) => {
    const matches = files.filter(({ name }) => pattern.test(name));
    if (matches.length !== 1) throw new Error(`${description}应存在且仅存在一个，实际找到 ${matches.length} 个。`);
    return matches[0];
  };
  return {
    windows: choose(/\.exe$/iu, "Windows 安装包"),
    macosArm64: choose(/(?:aarch64|arm64).*(?:\.dmg|\.zip)$/iu, "macOS Apple Silicon 安装包"),
    macosX64: choose(/(?:x86_64|x64).*(?:\.dmg|\.zip)$/iu, "macOS Intel 安装包"),
    latestJson: choose(/^latest\.json$/iu, "latest.json"),
    signatures: files.filter(({ name }) => /\.sig$/iu.test(name)),
  };
}

export function renderReleaseBody({ tag, sections, repository, defaultBranch, assets }) {
  const assetUrl = (name) => `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(name)}`;
  return [
    `# LifePlan ${tag}`,
    "",
    "## ✨ 本次更新",
    "",
    renderChangeSections(sections),
    "",
    "## 📦 下载与安装",
    "",
    "| 操作系统 | 适用设备 | 下载 |",
    "| --- | --- | --- |",
    `| Windows | x64 | [下载 Windows 安装包](${assetUrl(assets.windows.name)}) |`,
    `| macOS | Apple Silicon（M 系列芯片） | [下载 ARM64 安装包](${assetUrl(assets.macosArm64.name)}) |`,
    `| macOS | Intel 芯片 | [下载 x64 安装包](${assetUrl(assets.macosX64.name)}) |`,
    "",
    "> Windows 请下载 `.exe` 安装包；macOS 请根据芯片类型下载对应的安装包。",
    "",
    "---",
    "",
    `📚 **历次版本更新记录：** [查看 CHANGELOG.md](https://github.com/${repository}/blob/${defaultBranch}/CHANGELOG.md)`,
    "",
  ].join("\n");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

- [ ] **Step 4: 补全 CHANGELOG 幂等、资产和 Release 正文测试**

在同一测试文件追加：

```js
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
```

- [ ] **Step 5: 增加测试命令并运行测试验证通过**

在 `package.json` 的 `scripts` 中加入：

```json
"test:release": "node --test tests/release/release-utils.test.mjs"
```

Run:

```powershell
npm run test:release
```

Expected: PASS，5 个子测试全部成功。

- [ ] **Step 6: 提交发布生成模块**

```powershell
git add package.json scripts/release/release-utils.mjs tests/release/release-utils.test.mjs
git commit -m "功能：增加自动发布说明生成模块"
```

Expected: 创建一个仅包含发布说明纯函数和测试的提交。

### Task 2: 实现准备阶段与 CHANGELOG 自动回写

**Files:**
- Create: `E:/项目/LifePlanTodolist/scripts/release/prepare-release.mjs`
- Modify: `E:/项目/LifePlanTodolist/.github/workflows/release.yml`
- Create: `E:/项目/LifePlanTodolist/CHANGELOG.md`

**Interfaces:**
- Consumes: Task 1 的纯函数、`GITHUB_REF_NAME`、`GITHUB_REPOSITORY`、Git 历史、三个版本配置文件、`GITHUB_OUTPUT`、`GITHUB_STEP_SUMMARY`。
- Produces: `release-context.json`（`tag`、`version`、`date`、`sections`、`releaseNotesMarkdown`、`repository`、`defaultBranch`）和更新后的 `CHANGELOG.md`；供后续 build / publish jobs 使用。

- [ ] **Step 1: 创建工作流入口脚本**

创建 `scripts/release/prepare-release.mjs`。脚本必须：

1. 从 `process.env.GITHUB_REF_NAME` 读取 tag；验证其匹配 `^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$`，提取版本号；
2. 读取 `package.json` 的 `version`、用正则 `/^version\s*=\s*"([^"]+)"/m` 读取 `src-tauri/Cargo.toml`、读取 `src-tauri/tauri.conf.json` 的 `version`，并调用 `assertVersionConsistency`；
3. 使用 `git tag --list "v*" --sort=-version:refname` 找到当前 tag 之外的最近版本 tag；若存在，使用 `git log --format=%s "<previous>..<current>"`，否则使用 `git log --format=%s <current>`；
4. 调用 `buildChangeSections`、`renderChangelogEntry`、`upsertChangelog`，以 `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" })` 生成日期；
5. 将 UTF-8、LF 换行的更新日志写回根目录 `CHANGELOG.md`；
6. 将以下 JSON 写入 CLI 参数 `--context-file` 指定路径：

```json
{
  "tag": "v1.0.5",
  "version": "1.0.5",
  "date": "2026-09-16",
  "sections": [{ "title": "✨ 新增功能", "items": ["示例"] }],
  "releaseNotesMarkdown": "### ✨ 新增功能\n- 示例",
  "repository": "9527GC/LifePlan",
  "defaultBranch": "main"
}
```

7. 当提供 `--github-output` 时，将 `tag`、`version`、`date` 与 `context_artifact_name=release-context` 写入该文件；当提供 `--summary-file` 时，写入版本号、上个标签和分类更新说明。

脚本只使用 Node 内置模块 `node:fs`、`node:path`、`node:child_process`，所有异常必须 `console.error(error.message)` 后以非零状态退出。

- [ ] **Step 2: 在本地执行准备脚本，验证当前标签的错误信息可读**

Run:

```powershell
node scripts/release/prepare-release.mjs --tag v9.9.9 --repository 9527GC/LifePlan --default-branch main --context-file "$env:TEMP\release-context.json"
```

Expected: FAIL，输出包含 `版本号不一致。标签期望版本：9.9.9` 和三个配置文件实际版本；不得创建或修改 `CHANGELOG.md`。

- [ ] **Step 3: 创建初始 CHANGELOG 文件**

创建根目录 `CHANGELOG.md`：

```md
# 更新日志

> 本文件由 GitHub Actions 在发布版本时自动维护。请勿手动编辑版本条目。
```

- [ ] **Step 4: 将现有发布工作流替换为准备、回写和构建骨架**

将 `.github/workflows/release.yml` 重构为以下骨架（后续 Task 3 补充 `publish` job）：

```yaml
name: 发布 LifePlan

on:
  push:
    tags:
      - "v*"

permissions:
  contents: write

concurrency:
  group: lifeplan-release-${{ github.ref_name }}
  cancel-in-progress: false

jobs:
  prepare:
    name: 校验版本并生成更新日志
    runs-on: ubuntu-latest
    outputs:
      tag: ${{ steps.context.outputs.tag }}
      version: ${{ steps.context.outputs.version }}
      date: ${{ steps.context.outputs.date }}
    steps:
      - name: 检出标签代码
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
          ref: ${{ github.ref }}

      - name: 设置 Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: 生成发布上下文
        id: context
        env:
          GITHUB_REF_NAME: ${{ github.ref_name }}
          GITHUB_REPOSITORY: ${{ github.repository }}
        run: |
          node scripts/release/prepare-release.mjs \
            --tag "$GITHUB_REF_NAME" \
            --repository "$GITHUB_REPOSITORY" \
            --default-branch "${{ github.event.repository.default_branch }}" \
            --context-file release-context.json \
            --github-output "$GITHUB_OUTPUT" \
            --summary-file "$GITHUB_STEP_SUMMARY"

      - name: 提交自动更新的 CHANGELOG
        env:
          DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}
          TAG: ${{ github.ref_name }}
        run: |
          if git diff --quiet -- CHANGELOG.md; then
            exit 0
          fi
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add CHANGELOG.md
          git commit -m "docs: 自动更新 CHANGELOG $TAG [skip changelog]"
          git push origin "HEAD:refs/heads/$DEFAULT_BRANCH"

      - name: 上传发布上下文
        uses: actions/upload-artifact@v4
        with:
          name: release-context
          path: release-context.json
          if-no-files-found: error

  build:
    name: 构建 ${{ matrix.platform }}
    needs: prepare
    runs-on: ${{ matrix.runner }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: Windows x64
            runner: windows-latest
            rust_target: x86_64-pc-windows-msvc
            args: ""
            artifact_name: release-windows-x64
          - platform: macOS Apple Silicon
            runner: macos-14
            rust_target: aarch64-apple-darwin
            args: "--target aarch64-apple-darwin"
            artifact_name: release-macos-arm64
          - platform: macOS Intel
            runner: macos-14
            rust_target: x86_64-apple-darwin
            args: "--target x86_64-apple-darwin"
            artifact_name: release-macos-x64
    steps:
      - name: 检出标签代码
        uses: actions/checkout@v4
        with:
          ref: ${{ github.ref }}

      - name: 设置 Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: 安装 Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.rust_target }}

      - name: 安装依赖
        run: npm ci --no-audit --no-fund

      - name: 构建 Tauri 产物
        env:
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        run: npm run tauri -- build ${{ matrix.args }}

      - name: 收集 Windows 发布资产
        if: runner.os == 'Windows'
        shell: pwsh
        run: |
          New-Item -ItemType Directory -Force -Path release-assets | Out-Null
          Get-ChildItem -Path src-tauri/target -Recurse -File |
            Where-Object { $_.Name -match '\.(exe|sig)$' -or $_.Name -eq 'latest.json' } |
            Copy-Item -Destination release-assets -Force

      - name: 收集 macOS 发布资产
        if: runner.os == 'macOS'
        shell: bash
        run: |
          set -euo pipefail
          mkdir -p release-assets
          find src-tauri/target -type f \( -name '*.dmg' -o -name '*.zip' -o -name '*.sig' -o -name 'latest.json' \) -exec cp {} release-assets/ \;

      - name: 上传构建资产
        uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.artifact_name }}
          path: release-assets
          if-no-files-found: error
```

- [ ] **Step 5: 静态检查 YAML 和脚本**

Run:

```powershell
node --check scripts/release/prepare-release.mjs
npm run test:release
git diff --check
```

Expected: 三个命令均成功；`CHANGELOG.md` 只包含初始化标题和自动维护说明。

- [ ] **Step 6: 提交准备与日志回写阶段**

```powershell
git add CHANGELOG.md .github/workflows/release.yml scripts/release/prepare-release.mjs
git commit -m "功能：自动生成并回写版本更新日志"
```

Expected: 该提交包含准备 job、构建骨架和根目录 CHANGELOG 初始文件。

### Task 3: 实现资产校验与单一 Release 汇总发布

**Files:**
- Create: `E:/项目/LifePlanTodolist/scripts/release/validate-release-assets.mjs`
- Modify: `E:/项目/LifePlanTodolist/.github/workflows/release.yml`
- Modify: `E:/项目/LifePlanTodolist/tests/release/release-utils.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `findReleaseAssets` / `renderReleaseBody`、Task 2 上传的 `release-context.json`、所有 build artifact 文件路径。
- Produces: `release-body.md` 和待上传的 `release-upload/` 目录；由 GitHub CLI 的 `gh release create` / `gh release edit` 消费。

- [ ] **Step 1: 为错误资产数量增加失败测试**

在 `tests/release/release-utils.test.mjs` 追加：

```js
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
```

- [ ] **Step 2: 运行测试确认新增用例通过已有资产选择实现**

Run:

```powershell
npm run test:release
```

Expected: PASS，新增的“缺少 macOS Intel 安装包时拒绝发布”用例成功。

- [ ] **Step 3: 实现资产汇总入口脚本**

创建 `scripts/release/validate-release-assets.mjs`。脚本必须接受以下参数：

```text
--context-file <release-context.json>
--assets-dir <下载的 artifact 根目录>
--output-dir <release-upload 目录>
--body-file <release-body.md>
```

实现以下步骤：

1. 递归读取 `--assets-dir` 下的所有普通文件；将其映射为 `{ name: path.basename(file), path: file }`；
2. 调用 `findReleaseAssets`；若 `signatures.length === 0` 则抛出 `未找到 updater 签名文件（.sig）。`；
3. 建立 `--output-dir`，复制三个安装包、唯一 `latest.json` 和全部 `.sig` 文件；如不同源文件同名，先比较字节内容，相同则保留一份，不同则抛出 `发布资产重名且内容不同：<name>`；
4. 调用 `renderReleaseBody({ ...context, assets })`，写入 UTF-8 / LF 的 `--body-file`；
5. 输出一行 `已校验 N 个待发布资产，并生成 Release 正文：<body-file>`。

使用 `node:fs/promises`、`node:path`、`node:crypto`，不引入依赖包。

- [ ] **Step 4: 在工作流追加汇总发布 job**

在 `.github/workflows/release.yml` 的 `build` job 后追加：

```yaml
  publish:
    name: 汇总并发布 GitHub Release
    needs: [prepare, build]
    runs-on: ubuntu-latest
    steps:
      - name: 下载发布上下文
        uses: actions/download-artifact@v4
        with:
          name: release-context
          path: release-context

      - name: 下载全部构建资产
        uses: actions/download-artifact@v4
        with:
          pattern: release-*
          path: downloaded-assets
          merge-multiple: false

      - name: 设置 Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: 检出发布脚本
        uses: actions/checkout@v4
        with:
          ref: ${{ github.ref }}

      - name: 校验资产并生成 Release 正文
        run: |
          node scripts/release/validate-release-assets.mjs \
            --context-file release-context/release-context.json \
            --assets-dir downloaded-assets \
            --output-dir release-upload \
            --body-file release-body.md

      - name: 创建或更新 Release 并上传资产
        env:
          GH_TOKEN: ${{ github.token }}
          TAG: ${{ needs.prepare.outputs.tag }}
        run: |
          if gh release view "$TAG" >/dev/null 2>&1; then
            gh release edit "$TAG" --title "LifePlan $TAG" --notes-file release-body.md --latest
          else
            gh release create "$TAG" --title "LifePlan $TAG" --notes-file release-body.md --latest
          fi
          gh release upload "$TAG" release-upload/* --clobber
```

- [ ] **Step 5: 对工作流关键参数做离线静态验证**

Run:

```powershell
node --check scripts/release/validate-release-assets.mjs
npm run test:release
Select-String -Path .github/workflows/release.yml -Pattern 'tauri-action|releaseBody|releaseName' -Quiet
```

Expected: 前两个命令成功；最后一个命令返回 `False`，确认不再使用会让矩阵 job 并发修改 Release 的 `tauri-apps/tauri-action` 发布参数。

- [ ] **Step 6: 提交汇总发布阶段**

```powershell
git add .github/workflows/release.yml scripts/release/validate-release-assets.mjs tests/release/release-utils.test.mjs
git commit -m "功能：汇总发布多平台安装包"
```

Expected: 工作流存在唯一 `publish` job，只有它调用 GitHub CLI 创建/编辑 Release。

### Task 4: 完善发布指南与本地验证

**Files:**
- Modify: `E:/项目/LifePlanTodolist/docs/自动更新发布指南.md`
- Modify: `E:/项目/LifePlanTodolist/package.json`（仅当需要增加验证命令时）

**Interfaces:**
- Consumes: Tasks 1–3 的工作流文件、脚本入口和测试命令。
- Produces: 可由维护者独立执行的发版清单、自动 CHANGELOG 说明、发布后核查和失败排查步骤。

- [ ] **Step 1: 更新“发布版本”章节，明确版本同步及标签操作**

将 `docs/自动更新发布指南.md` 的发布前说明改为：必须先把 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 同步为相同版本，例如 `1.0.5`。明确新手引导轮播读取 `package.json`，Tauri 安装包和客户端版本读取 Tauri 配置；工作流会在构建前强制验证三者和 `v1.0.5` 标签一致。

保留并使用以下命令：

```powershell
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run test:release
git diff --check
git status --short

git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
git commit -m "发布：LifePlan 1.0.5"
git push github main
git tag v1.0.5
git push github v1.0.5
```

- [ ] **Step 2: 添加“自动更新日志与 Release 正文”章节**

写明以下不可省略的行为：

```md
## 自动更新日志与 Release 正文

推送 `vX.Y.Z` 标签后，工作流会读取上一个 `v*` 标签至当前标签之间的 Git 提交标题：

- `feat:`：新增功能；
- `fix:`：问题修复；
- `perf:`、`refactor:`：优化改进；
- 其他标题：其他更新。

工作流自动在根目录 `CHANGELOG.md` 顶部插入 `## vX.Y.Z（YYYY-MM-DD）`，日期为北京时间，并自动提交 `docs: 自动更新 CHANGELOG vX.Y.Z [skip changelog]` 至默认分支。请不要手动编辑版本条目。

GitHub Release 正文会使用同一份更新内容，展示 Windows x64、macOS Apple Silicon 和 macOS Intel 的下载表格，底部仅链接完整 `CHANGELOG.md`。
```

- [ ] **Step 3: 添加失败排查和发布后核查清单**

补充以下明确检查：

```markdown
### 发布后核查

1. 确认 `校验版本并生成更新日志` job 成功，且默认分支新增自动 CHANGELOG 提交。
2. 确认 Windows x64、macOS Apple Silicon、macOS Intel 三个构建 job 均成功。
3. 打开 Release，确认正文按分类显示本次更新，且三个下载链接可下载对应资产。
4. 确认 Release Assets 包含三个安装包、`latest.json` 和至少一个 `.sig` 文件。
5. 确认 Release 底部的 `CHANGELOG.md` 链接可打开，且新版本位于历史记录顶部。
6. 使用旧版客户端检查自动更新；成功安装后，新手引导版本号、客户端版本和 Release tag 去掉 `v` 后的版本一致。

### 常见失败

- 版本校验失败：修正三个版本文件，使其与标签去掉 `v` 后完全一致；提交后删除错误标签并重新创建正确标签。
- CHANGELOG 推送失败：检查默认分支保护规则是否允许 `github-actions[bot]` 推送；未修复前不要手动创建同标签 Release。
- 缺少平台资产：查看对应矩阵 job 的 Tauri 构建日志；修复后重新运行同一标签工作流，汇总 job 会更新现有 Release。
```

- [ ] **Step 4: 运行全部本地可执行校验**

Run:

```powershell
npm run test:release
node --check scripts/release/release-utils.mjs
node --check scripts/release/prepare-release.mjs
node --check scripts/release/validate-release-assets.mjs
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
git diff --check
git status --short
```

Expected: 所有测试、Node 语法检查、前端构建、Rust 检查成功；`git diff --check` 无输出；状态仅包含本任务尚未提交的文档修改。

- [ ] **Step 5: 提交发布指南**

```powershell
git add -f docs/自动更新发布指南.md
git commit -m "文档：补充自动发布版本指南"
```

Expected: 提交只包含发布流程文档更新。

### Task 5: 创建一次安全的发布前演练与 GitHub 验证清单

**Files:**
- Modify: `E:/项目/LifePlanTodolist/docs/自动更新发布指南.md`

**Interfaces:**
- Consumes: 已实施的 `release.yml`、三个版本文件和 GitHub Actions Secret。
- Produces: 发布者执行真实 tag 前的可重复演练步骤；不在本地伪造 GitHub Release 或泄露签名 Secret。

- [ ] **Step 1: 加入真实发布前演练步骤**

在指南末尾新增以下章节：

```markdown
## 首次自动化发布演练

首次使用时，选择一个尚未使用的预发布版本，例如 `1.0.5-rc.1`，并确保三个版本文件均为该版本。提交后推送 `v1.0.5-rc.1`。确认工作流完成后：

1. 检查自动生成的 CHANGELOG 条目、Release 分类内容、三个下载链接和更新签名资产。
2. 若结果正确，按同样流程发布正式版本 `1.0.5`。
3. 若工作流在任一阶段失败，修复默认分支上的代码或工作流后删除远端失败标签，再从修复后的提交创建并推送新的未使用标签；不要将不同版本内容覆盖到已有正式 tag。
```

- [ ] **Step 2: 审阅指南中的密钥安全约束没有退化**

Run:

```powershell
Select-String -Path 'docs/自动更新发布指南.md' -Pattern 'BEGIN PRIVATE KEY|TAURI_SIGNING_PRIVATE_KEY=.*[A-Za-z0-9]{40}' -AllMatches
```

Expected: 无匹配结果；文档仅含 Secret 名称，不含任何私钥值。

- [ ] **Step 3: 最终提交与状态检查**

```powershell
git add -f docs/自动更新发布指南.md
git commit -m "文档：增加自动发布演练清单"
git status --short
git log --oneline -5
```

Expected: 工作区干净；最近提交清晰包含模块、日志、汇总发布和文档变更。

## 计划自检

- **需求覆盖：** Task 1 覆盖提交自动分类、Release Markdown 与资产选择；Task 2 覆盖三处版本号校验、北京时间 CHANGELOG 生成与自动回写；Task 3 覆盖三平台汇总、实际资产链接和唯一发布 job；Task 4–5 覆盖维护者发版、验证与排错流程。
- **失败安全：** 准备阶段在版本或 CHANGELOG 回写失败时阻断构建；`needs: [prepare, build]` 确保任一构建失败时不运行发布；资产函数要求完整的三个安装包、`latest.json` 与签名文件。
- **幂等性：** `upsertChangelog` 在已有 tag 条目时不重复插入；`gh release edit` 可用于重跑时更新正文，`gh release upload --clobber` 可补齐同名资产。
- **接口一致性：** `release-utils.mjs` 的导出函数由单元测试、`prepare-release.mjs` 和 `validate-release-assets.mjs` 共用；`release-context.json` 的字段在 Task 2 写入并在 Task 3 消费；`release-upload/*` 是唯一 GitHub CLI 上传来源。
- **无占位符：** 已检查计划中不存在 `待办占位词`、`待定占位词`、“延后处理”或“未明确细节”等不可执行表述。